/**
 * AudioWorklet processor — captures raw PCM audio on the audio thread.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Runs on the dedicated audio rendering thread (not the main thread).
 * Captures raw microphone samples in a ring buffer and periodically
 * sends them to the main thread for pitch detection and SER inference.
 *
 * TWO CHANNELS:
 * ─────────────
 * 1. 'audio-frame' — Every 2048 samples (~46ms at 44.1kHz). Used for
 *    real-time pitch tracking via Pitchy.
 * 2. 'ser-chunk'   — Every 2 seconds (~88,200 samples at 44.1kHz). Used
 *    for Speech Emotion Recognition inference in a Web Worker.
 *
 * WHY AN AUDIOWORKLET:
 * ────────────────────
 * ScriptProcessorNode (used by Meyda) is deprecated and runs on the main
 * thread, which causes jank at high frame rates. The AudioWorklet runs on
 * a real-time audio thread with guaranteed low latency.
 *
 * USAGE:
 * ──────
 * On the main thread:
 *   const ctx = new AudioContext();
 *   await ctx.audioWorklet.addModule(new URL('./audio-worklet.ts', import.meta.url));
 *   const workletNode = new AudioWorkletNode(ctx, 'audio-capture-processor');
 *   source.connect(workletNode);
 *   workletNode.port.onmessage = (e) => { ... handle AudioWorkletMessage ... };
 *
 * NOTE: This file supplements (does NOT replace) the existing Meyda
 * ScriptProcessorNode in AudioEngine.ts. Both run in parallel for now.
 * Full migration to AudioWorklet happens in a future task.
 */

// Frame size for real-time pitch extraction (~46ms at 44.1kHz)
const FRAME_SIZE = 2048;

// SER chunk duration in seconds
const SER_CHUNK_DURATION = 2.0;

class AudioCaptureProcessor extends AudioWorkletProcessor {
    /** Ring buffer for accumulating samples toward a pitch frame. */
    private frameBuffer: Float32Array;
    private frameOffset = 0;

    /** Ring buffer for accumulating samples toward a SER chunk. */
    private serBuffer: Float32Array;
    private serOffset = 0;
    private serBufferSize: number;

    constructor() {
        super();

        this.frameBuffer = new Float32Array(FRAME_SIZE);

        // SER buffer size depends on sample rate. sampleRate is a global
        // in AudioWorklet scope (exposed by the spec). Default to 44100
        // if not available for some reason.
        const sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
        this.serBufferSize = Math.floor(sr * SER_CHUNK_DURATION);
        this.serBuffer = new Float32Array(this.serBufferSize);
    }

    process(
        inputs: Float32Array[][],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by AudioWorkletProcessor.process() signature
        _outputs: Float32Array[][],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by AudioWorkletProcessor.process() signature
        _parameters: Record<string, Float32Array>
    ): boolean {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        // Use the first channel (mono)
        const channelData = input[0];
        if (!channelData || channelData.length === 0) return true;

        // Accumulate samples into both buffers
        for (let i = 0; i < channelData.length; i++) {
            const sample = channelData[i];

            // ── Pitch frame buffer ──────────────────────────────────
            this.frameBuffer[this.frameOffset++] = sample;
            if (this.frameOffset >= FRAME_SIZE) {
                // Send a copy to the main thread for pitch detection
                this.port.postMessage({
                    type: 'audio-frame',
                    samples: this.frameBuffer.slice(),
                    sampleRate: typeof sampleRate !== 'undefined' ? sampleRate : 44100,
                });
                this.frameOffset = 0;
            }

            // ── SER chunk buffer ────────────────────────────────────
            this.serBuffer[this.serOffset++] = sample;
            if (this.serOffset >= this.serBufferSize) {
                // Send 2-second chunk for SER inference
                this.port.postMessage({
                    type: 'ser-chunk',
                    samples: this.serBuffer.slice(),
                    sampleRate: typeof sampleRate !== 'undefined' ? sampleRate : 44100,
                });
                this.serOffset = 0;
            }
        }

        // Return true to keep the processor alive
        return true;
    }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
