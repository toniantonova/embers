/**
 * STT Capture AudioWorklet — Resamples mic audio to 16kHz PCM Int16 for streaming STT.
 *
 * WHY A SEPARATE WORKLET:
 * ───────────────────────
 * The existing audio-worklet.ts captures at native sample rate (44.1kHz) for
 * pitch detection and SER inference. STT streaming services (Deepgram, AssemblyAI)
 * expect 16kHz mono audio in linear16 PCM format. Resampling in a separate worklet
 * keeps concerns cleanly separated and avoids affecting the SER pipeline.
 *
 * WHAT THIS DOES:
 * ───────────────
 * 1. Receives raw audio frames from the AudioContext (128 samples each at native rate)
 * 2. Accumulates samples into a ring buffer
 * 3. Every ~100ms worth of samples, resamples to 16kHz and converts to Int16
 * 4. Sends the Int16 PCM chunk to the main thread via port.postMessage()
 *
 * The main thread (WebSocketSTTClient) then forwards these directly to Deepgram
 * as binary WebSocket frames.
 *
 * WHY 100ms CHUNKS:
 * ─────────────────
 * - 100ms × 16kHz × 2 bytes = 3.2KB per chunk — tiny overhead
 * - Adds only 100ms to the latency budget (vs 250ms for larger chunks)
 * - Deepgram handles this interval well without throttling
 */

// Target sample rate for STT services
const TARGET_SAMPLE_RATE = 16000;

// Chunk interval in seconds (100ms)
const CHUNK_INTERVAL_SEC = 0.1;

class STTCaptureProcessor extends AudioWorkletProcessor {
    /** Accumulation buffer at native sample rate. */
    private buffer: Float32Array;
    private bufferOffset = 0;

    /** How many native-rate samples equal one 100ms chunk. */
    private chunkSizeNative: number;

    /** Native sample rate (from AudioContext). */
    private nativeSampleRate: number;

    constructor() {
        super();

        // sampleRate is a global in AudioWorklet scope
        this.nativeSampleRate = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
        this.chunkSizeNative = Math.floor(this.nativeSampleRate * CHUNK_INTERVAL_SEC);
        this.buffer = new Float32Array(this.chunkSizeNative);
    }

    process(
        inputs: Float32Array[][],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by AudioWorkletProcessor
        _outputs: Float32Array[][],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by AudioWorkletProcessor
        _parameters: Record<string, Float32Array>
    ): boolean {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const channelData = input[0];
        if (!channelData || channelData.length === 0) return true;

        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferOffset++] = channelData[i];

            if (this.bufferOffset >= this.chunkSizeNative) {
                // Resample to 16kHz and convert to Int16
                const int16Chunk = this.resampleAndConvert(this.buffer);

                // Transfer the underlying ArrayBuffer for zero-copy
                this.port.postMessage(
                    { type: 'stt-chunk', samples: int16Chunk },
                    [int16Chunk.buffer]
                );

                // Allocate a new buffer (old one was transferred)
                this.buffer = new Float32Array(this.chunkSizeNative);
                this.bufferOffset = 0;
            }
        }

        return true;
    }

    /**
     * Resample from native sample rate to 16kHz and convert Float32 → Int16.
     *
     * Uses simple linear interpolation for resampling. This is adequate for
     * speech recognition — we don't need the quality of a sinc resampler here.
     */
    private resampleAndConvert(input: Float32Array): Int16Array {
        const ratio = this.nativeSampleRate / TARGET_SAMPLE_RATE;
        const outputLength = Math.floor(input.length / ratio);
        const output = new Int16Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            // Linear interpolation between two nearest source samples
            const srcIndex = i * ratio;
            const srcFloor = Math.floor(srcIndex);
            const srcCeil = Math.min(srcFloor + 1, input.length - 1);
            const frac = srcIndex - srcFloor;

            const sample = input[srcFloor] * (1 - frac) + input[srcCeil] * frac;

            // Clamp and scale Float32 [-1, 1] → Int16 [-32768, 32767]
            output[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
        }

        return output;
    }
}

registerProcessor('stt-capture-processor', STTCaptureProcessor);
