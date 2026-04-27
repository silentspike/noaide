# Voice Input Setup (Whisper Sidecar)

The microphone button in the chat input field streams audio to a
local Whisper transcription sidecar. The sidecar is **optional** —
nothing else in noaide depends on it. If you do not need voice input,
skip this page and set `ENABLE_WHISPER=false` to silence the
"sidecar failed to start" warning in the backend log.

> **Status**: voice-to-text is wired end-to-end (AudioWorklet PCM
> capture → WebSocket proxy → faster-whisper → partial+final text
> back into the input field). The sidecar runs as a separate Python
> process the Rust backend supervises.

## What it does

| Stage | Component |
|-------|-----------|
| Capture | `frontend/src/workers/pcm-capture.worklet.js` — 16 kHz mono int16 PCM via AudioWorklet |
| Transport | `/api/ws/transcribe` — Rust WebSocket proxy in the backend |
| Transcribe | `server/whisper/server.py` — FastAPI WebSocket server, faster-whisper model |
| Render | `frontend/src/hooks/useVoiceInput.ts` — partials live in the textarea, final text appended |

## Prerequisites

| Dependency | Notes |
|------------|-------|
| Python | 3.10 – 3.12 |
| `faster-whisper` | 1.1+ (pulls in `ctranslate2` 4.5+) |
| `fastapi` + `uvicorn` | WebSocket server |
| `numpy` | PCM buffer handling |
| Optional: NVIDIA GPU | `cuDNN 9` + `cuBLAS` for `WHISPER_DEVICE=cuda` (CTranslate2 4.5+ requires cuDNN 9) |

CPU-only is supported (`WHISPER_DEVICE=cpu`). On a recent x86 box,
the `small` model transcribes a 2-second utterance in ~1 s on CPU
or ~130 ms on a CUDA GPU (warm).

## Install

The backend looks for a Python interpreter at `WHISPER_PYTHON`
(default: `/venv/bin/python`). Point it at a venv with the deps
installed:

```bash
# Option A — dedicated project venv
python3 -m venv /work/noaide/.venv-whisper
source /work/noaide/.venv-whisper/bin/activate
pip install --upgrade pip
pip install faster-whisper fastapi uvicorn numpy
# For CUDA: also install the matching cuDNN/cuBLAS pip wheels
pip install nvidia-cudnn-cu12 nvidia-cublas-cu12

# Then point the backend at it
export WHISPER_PYTHON=/work/noaide/.venv-whisper/bin/python

# Option B — system-wide venv (if you already have one)
export WHISPER_PYTHON=/path/to/venv/bin/python
```

## Configure

All variables are optional; defaults shown.

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENABLE_WHISPER` | `true` | Set to `false` to skip spawning the sidecar |
| `WHISPER_PYTHON` | `/venv/bin/python` | Path to the Python interpreter with the deps installed |
| `WHISPER_PORT` | `8082` | Port the FastAPI server listens on |
| `WHISPER_MODEL_SIZE` | `small` | `tiny` / `base` / `small` / `medium` / `large-v3` |
| `WHISPER_LANGUAGE` | `de` | ISO 639-1 language code (`en`, `fr`, …) |
| `WHISPER_DEVICE` | `cuda` | `cuda` or `cpu` — falls back to CPU if CUDA fails |
| `WHISPER_COMPUTE_TYPE` | `float16` (cuda) / `int8` (cpu) | CTranslate2 compute precision |

The sidecar caches model files in `~/.cache/huggingface/`. The
first run downloads the model (~150 MB for `small`).

## Verify it works

```bash
# 1. Backend log shows the sidecar spawned
grep "spawning whisper sidecar" /tmp/noaide-server.log
#  → spawning whisper sidecar port=8082

# 2. The sidecar answers
ss -ltnp | grep 8082
#  → LISTEN  0  2048  0.0.0.0:8082

# 3. In the browser at /noaide/, click the mic button in the chat
#    input. You should see a red "recording" indicator and partial
#    text appearing in the input field as you speak.
```

If the backend log shows
`failed to spawn whisper sidecar … No such file or directory`,
`WHISPER_PYTHON` is wrong — the path must be a working
Python interpreter, not the venv directory itself.

If the sidecar starts but exits with `SIGABRT` immediately, you are
on `WHISPER_DEVICE=cuda` without cuDNN 9 — either install the
`nvidia-cudnn-cu12` wheel into the venv, or set
`WHISPER_DEVICE=cpu`.

## Disabling voice input

Two options:

```bash
# Skip spawning the sidecar entirely
ENABLE_WHISPER=false ./target/release/noaide-server

# Or hide the mic button in the UI
ENABLE_AUDIO=false ./target/release/noaide-server
# (this also silences UI sound cues)
```

The chat input keeps working without the mic; voice is purely
additive.

## See also

- [README — Quick Start](../README.md#quick-start) — base setup
- [docs/component-reference.md](component-reference.md) — sidecar lifecycle and supervision
