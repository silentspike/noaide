"""
Streaming Whisper transcription sidecar.

Receives raw PCM 16-bit LE mono 16 kHz audio over WebSocket,
accumulates a buffer, and periodically transcribes with faster-whisper.
Sends back partial/final JSON text frames.

Env vars:
  WHISPER_PORT         (default 8081)
  WHISPER_MODEL_SIZE   (default small)
  WHISPER_LANGUAGE     (default en)
  WHISPER_DEVICE       (default cuda, falls back to cpu)
  WHISPER_COMPUTE_TYPE (default float16 for cuda, int8 for cpu)
"""

from __future__ import annotations

import asyncio
import faulthandler
import glob
import logging
import os
import signal
import struct
import sys
import time
from contextlib import asynccontextmanager

# Enable faulthandler to dump traceback on SIGSEGV/SIGABRT
faulthandler.enable(file=sys.stderr)

# ---------------------------------------------------------------------------
# Ensure nvidia pip-installed libraries (cuDNN 9, cuBLAS, etc.) are discoverable.
# CTranslate2/faster-whisper load .so via dlopen which searches LD_LIBRARY_PATH.
# The Rust spawner should set LD_LIBRARY_PATH before starting this process.
# As a fallback, we also set it here and re-exec if it was missing.
# ---------------------------------------------------------------------------
_nvidia_base = os.path.join(sys.prefix, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages", "nvidia")
if os.path.isdir(_nvidia_base):
    _nvidia_lib_dirs = sorted(glob.glob(os.path.join(_nvidia_base, "*", "lib")))
    if _nvidia_lib_dirs:
        _needed = os.pathsep.join(_nvidia_lib_dirs)
        _current = os.environ.get("LD_LIBRARY_PATH", "")
        if _nvidia_lib_dirs[0] not in _current:
            # LD_LIBRARY_PATH was not set — set it and re-exec so dlopen sees it
            os.environ["LD_LIBRARY_PATH"] = f"{_needed}{os.pathsep}{_current}" if _current else _needed
            os.execv(sys.executable, [sys.executable] + sys.argv)

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger("whisper-sidecar")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stderr,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("WHISPER_PORT", "8082"))
MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "small")
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "de")
# NOTE: CUDA requires cuDNN 9 for CTranslate2 >=4.5. If cuDNN 9 is not installed,
# the encoder will SIGABRT. Use "cpu" as safe default, set WHISPER_DEVICE=cuda
# only when cuDNN 9 is confirmed available.
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "")

# Transcription triggers
SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # int16
TRANSCRIBE_INTERVAL_BYTES = int(SAMPLE_RATE * BYTES_PER_SAMPLE * 1.5)  # 1.5s
SILENCE_TIMEOUT_S = 2.0  # auto-stop after 2s silence

# ---------------------------------------------------------------------------
# Model singleton
# ---------------------------------------------------------------------------
_model = None
_actual_device = None


def get_model():
    """Load model on first call, with GPU→CPU fallback."""
    global _model, _actual_device
    if _model is not None:
        return _model

    from faster_whisper import WhisperModel

    device = DEVICE
    compute = COMPUTE_TYPE or ("float16" if device == "cuda" else "int8")

    try:
        logger.info("Loading model=%s device=%s compute=%s", MODEL_SIZE, device, compute)
        _model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute)
        _actual_device = device
        logger.info("Model loaded on %s", device)
    except Exception as exc:
        if device == "cuda":
            logger.warning("CUDA failed (%s), falling back to CPU", exc)
            device = "cpu"
            compute = COMPUTE_TYPE or "int8"
            _model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute)
            _actual_device = device
            logger.info("Model loaded on CPU (fallback)")
        else:
            raise

    return _model


# ---------------------------------------------------------------------------
# Silero VAD (standalone, for silence detection on raw PCM)
# ---------------------------------------------------------------------------
_vad_model = None
_vad_utils = None


def get_vad():
    """Load Silero VAD model (lazy)."""
    global _vad_model, _vad_utils
    if _vad_model is not None:
        return _vad_model, _vad_utils

    import torch

    torch.set_num_threads(1)
    model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        trust_repo=True,
    )
    _vad_model = model
    _vad_utils = utils
    logger.info("Silero VAD loaded")
    return _vad_model, _vad_utils


def check_speech(pcm_int16: bytes) -> bool:
    """Return True if speech detected in the last chunk."""
    import torch

    try:
        model, _ = get_vad()
        audio = np.frombuffer(pcm_int16, dtype=np.int16).astype(np.float32) / 32768.0
        # Silero expects 16kHz, 512-sample windows
        tensor = torch.from_numpy(audio)
        # Process in 512-sample windows, return True if ANY window has speech
        window = 512
        for i in range(0, len(tensor) - window + 1, window):
            chunk = tensor[i : i + window]
            prob = model(chunk, SAMPLE_RATE).item()
            if prob > 0.5:
                return True
        return False
    except Exception as exc:
        logger.debug("VAD check failed: %s", exc)
        return True  # assume speech on error


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Eagerly load model at startup
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, get_model)
    await loop.run_in_executor(None, get_vad)
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    model = get_model()
    return JSONResponse(
        {
            "status": "ready",
            "model": MODEL_SIZE,
            "device": _actual_device or "unknown",
            "language": LANGUAGE,
        }
    )


@app.websocket("/ws/transcribe")
async def ws_transcribe(ws: WebSocket):
    await ws.accept()
    logger.info("Client connected")

    audio_buffer = bytearray()
    last_speech_time = time.monotonic()
    last_transcribe_pos = 0
    accumulated_text = ""
    running = True

    try:
        while running:
            try:
                data = await asyncio.wait_for(ws.receive(), timeout=0.5)
            except asyncio.TimeoutError:
                # Check silence timeout
                if time.monotonic() - last_speech_time > SILENCE_TIMEOUT_S and len(audio_buffer) > 0:
                    # Final transcription
                    final_text = await _transcribe_buffer(audio_buffer)
                    if final_text:
                        await ws.send_json({"type": "final", "text": final_text})
                    else:
                        await ws.send_json({"type": "final", "text": accumulated_text})
                    await ws.send_json({"type": "silence_detected"})
                    running = False
                continue

            if "bytes" in data and data["bytes"]:
                pcm_data = data["bytes"]
                audio_buffer.extend(pcm_data)
                if len(audio_buffer) <= 6400 or len(audio_buffer) % 32000 == 0:
                    logger.info("Buffer: %d bytes (%.2fs)", len(audio_buffer), len(audio_buffer) / (SAMPLE_RATE * BYTES_PER_SAMPLE))

                # VAD check on incoming chunk
                has_speech = await asyncio.get_event_loop().run_in_executor(
                    None, check_speech, pcm_data
                )
                if has_speech:
                    last_speech_time = time.monotonic()

                # Transcribe periodically
                new_bytes = len(audio_buffer) - last_transcribe_pos
                if new_bytes >= TRANSCRIBE_INTERVAL_BYTES:
                    logger.info("Triggering transcription at %d bytes", len(audio_buffer))
                    text = await _transcribe_buffer(audio_buffer)
                    logger.info("Transcription done, sending partial: %r", (text or "")[:80])
                    if text and text != accumulated_text:
                        accumulated_text = text
                        await ws.send_json({"type": "partial", "text": text})
                    last_transcribe_pos = len(audio_buffer)

            elif "text" in data and data["text"]:
                import json

                try:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "stop":
                        # Client requested stop — do final transcription
                        final_text = await _transcribe_buffer(audio_buffer)
                        await ws.send_json(
                            {"type": "final", "text": final_text or accumulated_text}
                        )
                        running = False
                except (json.JSONDecodeError, TypeError):
                    pass

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as exc:
        logger.error("WebSocket error: %s", exc, exc_info=True)
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        logger.info("Session ended, buffer=%d bytes, text=%r", len(audio_buffer), accumulated_text)


async def _transcribe_buffer(buffer: bytearray) -> str:
    """Run faster-whisper on accumulated PCM buffer."""
    if len(buffer) < SAMPLE_RATE * BYTES_PER_SAMPLE * 0.3:
        return ""  # too short (<0.3s)

    audio = np.frombuffer(bytes(buffer), dtype=np.int16).astype(np.float32) / 32768.0

    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, _sync_transcribe, audio)
    return text


def _sync_transcribe(audio: np.ndarray) -> str:
    """Synchronous transcription (runs in thread pool)."""
    try:
        model = get_model()
        logger.info("Transcribing %d samples (%.2fs)", len(audio), len(audio) / SAMPLE_RATE)
        segments, info = model.transcribe(
            audio,
            language=LANGUAGE,
            beam_size=1,  # fastest
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            # CRITICAL: vad_filter=True causes SIGABRT via ONNX Runtime GPU discovery
            # bug on systems with virtual DRM devices missing /sys/class/drm/cardN/device/vendor.
            # We use our own Silero VAD for silence detection instead.
            vad_filter=False,
            without_timestamps=True,
        )
        # CRITICAL: consume generator immediately to release GPU resources
        parts = [seg.text.strip() for seg in segments]
        result = " ".join(p for p in parts if p)
        logger.info("Transcription result: %r", result[:120] if result else "(empty)")
        return result
    except Exception as exc:
        logger.error("Transcription CRASHED: %s", exc, exc_info=True)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return ""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    # Handle SIGTERM gracefully (from Rust parent)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    logger.info("Starting whisper sidecar on port %d", PORT)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="warning",
        access_log=False,
    )
