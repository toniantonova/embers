/**
 * SER Worker — Speech Emotion Recognition in a Web Worker.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Runs wav2vec2-base Speech Emotion Recognition inference in a dedicated
 * Web Worker thread so it never blocks the main thread (inference takes
 * ~200–500ms per 2-second chunk).
 *
 * PROTOCOL:
 * ─────────
 * Main → Worker:
 *   { type: 'init' }             — Load the model
 *   { type: 'process', audioData, sampleRate } — Run inference on audio chunk
 *
 * Worker → Main:
 *   { type: 'ready' }            — Model loaded successfully
 *   { type: 'result', emotion }  — Inference result (EmotionState)
 *   { type: 'error', error }     — Something went wrong
 *
 * GRACEFUL DEGRADATION:
 * ─────────────────────
 * If the model fails to load (no WebGPU, ONNX runtime unavailable),
 * this worker reports a neutral EmotionState and logs a warning.
 * The animation system continues with neutral emotion values.
 *
 * USAGE:
 * ──────
 * On the main thread:
 *   const worker = new Worker(new URL('./ser-worker.ts', import.meta.url), { type: 'module' });
 *   worker.postMessage({ type: 'init' });
 *   worker.onmessage = (e) => {
 *     if (e.data.type === 'ready') { ... }
 *     if (e.data.type === 'result') { ... use e.data.emotion ... }
 *   };
 *   // Every 2 seconds:
 *   worker.postMessage({ type: 'process', audioData: chunk, sampleRate: 44100 });
 */

import type { SERWorkerRequest, SERWorkerResponse, EmotionState } from './types';

// Model ID for wav2vec2-base SER
const SER_MODEL_ID = 'onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX';

// Emotion label → VAD (Valence, Arousal, Dominance) mapping
// Maps discrete emotion categories to continuous dimensional space.
// Based on Russell's circumplex model of affect.
const EMOTION_VAD: Record<string, { valence: number; arousal: number; dominance: number }> = {
    angry: { valence: -0.6, arousal: 0.8, dominance: 0.7 },
    disgust: { valence: -0.7, arousal: 0.4, dominance: 0.5 },
    fear: { valence: -0.7, arousal: 0.7, dominance: 0.2 },
    happy: { valence: 0.8, arousal: 0.7, dominance: 0.6 },
    neutral: { valence: 0.0, arousal: 0.2, dominance: 0.5 },
    sad: { valence: -0.6, arousal: 0.2, dominance: 0.2 },
    surprise: { valence: 0.3, arousal: 0.8, dominance: 0.4 },
};

let classifier: any = null; // HF pipeline() return type
let isReady = false;

/**
 * Load the SER model.
 */
async function initModel(): Promise<void> {
    try {
        const { pipeline } = await import('@huggingface/transformers');

        // Try WebGPU first (fast: ~200ms inference), fall back to WASM (universal: ~1-2s)
        let device: 'webgpu' | 'wasm' = 'webgpu';
        try {
            classifier = await pipeline(
                'audio-classification',
                SER_MODEL_ID,
                {
                    device: 'webgpu',
                    dtype: 'fp32' as const,
                }
            );
            console.log('[SER Worker] ✅ Model loaded (WebGPU backend)');
        } catch (gpuErr) {
            console.warn('[SER Worker] WebGPU unavailable, falling back to WASM:', gpuErr);
            device = 'wasm';
            classifier = await pipeline(
                'audio-classification',
                SER_MODEL_ID,
                {
                    device: 'wasm',
                    dtype: 'fp32' as const,
                }
            );
            console.log('[SER Worker] ✅ Model loaded (WASM fallback — inference will be slower but works everywhere)');
        }

        isReady = true;
        postResponse({ type: 'ready' });
        console.log(`[SER Worker] Backend: ${device}`);
    } catch (err) {
        console.warn('[SER Worker] ❌ Model load failed completely (both WebGPU and WASM):', err);
        postResponse({
            type: 'error',
            error: `SER model load failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}

/**
 * Run inference on a 2-second audio chunk.
 */
async function processAudio(audioData: Float32Array, sampleRate: number): Promise<void> {
    if (!isReady || !classifier) {
        // Not ready yet — send neutral emotion
        postResponse({
            type: 'result',
            emotion: {
                valence: 0,
                arousal: 0,
                dominance: 0,
                confidence: 0,
                timestamp: Date.now(),
            },
        });
        return;
    }

    try {
        const result = await classifier(audioData, {
            sampling_rate: sampleRate,
            top_k: 3, // Get top 3 predictions for weighted averaging
        });

        if (!result || result.length === 0) {
            postResponse({
                type: 'result',
                emotion: {
                    valence: 0, arousal: 0, dominance: 0,
                    confidence: 0, timestamp: Date.now(),
                },
            });
            return;
        }

        // Weighted average of top predictions' VAD values
        let totalWeight = 0;
        let valence = 0;
        let arousal = 0;
        let dominance = 0;

        for (const pred of result) {
            const label = pred.label?.toLowerCase() ?? 'neutral';
            const score = pred.score ?? 0;
            const vad = EMOTION_VAD[label] ?? EMOTION_VAD['neutral'];

            valence += vad.valence * score;
            arousal += vad.arousal * score;
            dominance += vad.dominance * score;
            totalWeight += score;
        }

        if (totalWeight > 0) {
            valence /= totalWeight;
            arousal /= totalWeight;
            dominance /= totalWeight;
        }

        const emotion: EmotionState = {
            valence: Math.max(-1, Math.min(1, valence)),
            arousal: Math.max(0, Math.min(1, arousal)),
            dominance: Math.max(0, Math.min(1, dominance)),
            confidence: result[0]?.score ?? 0,
            timestamp: Date.now(),
        };

        postResponse({ type: 'result', emotion });
    } catch (err) {
        console.warn('[SER Worker] Inference error:', err);
        postResponse({
            type: 'error',
            error: `SER inference failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}

/**
 * Send a typed response to the main thread.
 */
function postResponse(response: SERWorkerResponse): void {
    postMessage(response);
}

// ── MESSAGE HANDLER ──────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<SERWorkerRequest>) => {
    const { type, audioData, sampleRate } = event.data;

    switch (type) {
        case 'init':
            await initModel();
            break;

        case 'process':
            if (audioData && sampleRate) {
                await processAudio(audioData, sampleRate);
            }
            break;

        default:
            console.warn('[SER Worker] Unknown message type:', type);
    }
};
