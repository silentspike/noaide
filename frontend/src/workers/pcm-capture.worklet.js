/**
 * AudioWorklet processor for capturing microphone audio as PCM 16-bit LE mono 16kHz.
 *
 * The browser AudioContext may run at 44.1kHz or 48kHz. This processor:
 * 1. Receives Float32 samples from the mic
 * 2. Resamples to 16kHz if needed (simple linear interpolation)
 * 3. Converts to Int16
 * 4. Buffers ~100ms (1600 samples at 16kHz) before posting to main thread
 *
 * Messages to main thread: { type: "pcm", buffer: ArrayBuffer (Int16 LE) }
 * Messages from main thread: { type: "stop" } to gracefully end
 */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Target sample rate
    this.targetRate = 16000;
    // Source sample rate from AudioContext (passed via processorOptions)
    this.sourceRate = options.processorOptions?.sampleRate || sampleRate;
    // Resample ratio
    this.ratio = this.sourceRate / this.targetRate;
    // Buffer: accumulate 100ms of 16kHz audio = 1600 samples
    this.bufferSize = 1600;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferPos = 0;
    // Resampling state
    this.resampleFraction = 0;
    // Running flag
    this.running = true;
    // Stats
    this.flushCount = 0;
    this.processCount = 0;

    console.log("[pcm-worklet] init — source:", this.sourceRate, "Hz, target:", this.targetRate, "Hz, ratio:", this.ratio.toFixed(3), ", resample:", Math.abs(this.ratio - 1.0) >= 0.01);

    this.port.onmessage = (event) => {
      if (event.data?.type === "stop") {
        console.log("[pcm-worklet] stop — flushing remaining", this.bufferPos, "samples, total flushes:", this.flushCount, ", process calls:", this.processCount);
        // Flush remaining buffer
        if (this.bufferPos > 0) {
          this._flush();
        }
        this.running = false;
      }
    };
  }

  process(inputs) {
    if (!this.running) return false;
    this.processCount++;

    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    // Mono: take first channel
    const samples = input[0];

    if (Math.abs(this.ratio - 1.0) < 0.01) {
      // No resampling needed (source already ~16kHz)
      this._addSamples(samples);
    } else {
      // Resample from sourceRate to 16kHz
      this._resample(samples);
    }

    return true;
  }

  _resample(samples) {
    let srcIdx = this.resampleFraction;
    while (srcIdx < samples.length) {
      const intIdx = Math.floor(srcIdx);
      const frac = srcIdx - intIdx;

      // Linear interpolation between samples
      let value;
      if (intIdx + 1 < samples.length) {
        value = samples[intIdx] * (1 - frac) + samples[intIdx + 1] * frac;
      } else {
        value = samples[intIdx];
      }

      this.buffer[this.bufferPos++] = value;
      if (this.bufferPos >= this.bufferSize) {
        this._flush();
      }

      srcIdx += this.ratio;
    }
    // Save fractional position for next call
    this.resampleFraction = srcIdx - samples.length;
  }

  _addSamples(samples) {
    let i = 0;
    while (i < samples.length) {
      const remaining = this.bufferSize - this.bufferPos;
      const toCopy = Math.min(remaining, samples.length - i);
      this.buffer.set(samples.subarray(i, i + toCopy), this.bufferPos);
      this.bufferPos += toCopy;
      i += toCopy;
      if (this.bufferPos >= this.bufferSize) {
        this._flush();
      }
    }
  }

  _flush() {
    this.flushCount++;
    // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
    const int16 = new Int16Array(this.bufferPos);
    for (let i = 0; i < this.bufferPos; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Transfer the buffer (zero-copy)
    this.port.postMessage(
      { type: "pcm", buffer: int16.buffer },
      [int16.buffer],
    );

    this.bufferPos = 0;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
