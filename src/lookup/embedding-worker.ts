/**
 * embedding-worker.ts — Web Worker for MiniLM embedding computation.
 *
 * LIFECYCLE:
 * ──────────
 * 1. PRELOAD: Triggered by 'preload' message at app startup (during page load).
 *    Model loading takes ~2-3s. This hides the latency before any hash miss.
 * 2. WARM: After preload, subsequent 'embed' requests take <20ms.
 * 3. STAYS ALIVE: One instance per session — no repeated loading.
 *
 * LATENCY PROFILE:
 * ────────────────
 * - Model load (first call or preload): ~2-3s (downloads ~80MB ONNX model)
 * - Warm inference: <20ms per embedding
 * - The orchestrator should call initEmbeddingWorker() at app startup
 *   to trigger preloading. If a hash-miss verb arrives before the model
 *   is loaded, the request will either wait or be rejected by the timeout
 *   set by the caller (EmbeddingFallback sets a 10s timeout per request).
 *
 * MESSAGES:
 * ─────────
 * Input:  { type: 'embed', id: number, text: string }
 * Output: { type: 'result', id: number, embedding: number[] }
 * Error:  { type: 'error', id: number, error: string }
 * Ready:  { type: 'ready' }
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

let pipeline: any = null;
let isLoading = false;

/**
 * Load the MiniLM pipeline on first use.
 */
async function ensurePipeline() {
    if (pipeline) return;
    if (isLoading) {
        // Wait for the existing load to complete
        while (isLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        return;
    }

    isLoading = true;
    try {
        const { pipeline: createPipeline } = await import('@huggingface/transformers');
        pipeline = await createPipeline(
            'feature-extraction',
            'Xenova/all-MiniLM-L6-v2',
            { dtype: 'fp32' }
        );
        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error('[EmbeddingWorker] Failed to load MiniLM:', err);
        throw err;
    } finally {
        isLoading = false;
    }
}


/**
 * Compute embedding for a text string.
 */
async function computeEmbedding(text: string): Promise<number[]> {
    await ensurePipeline();

    const output = await pipeline(text, {
        pooling: 'mean',
        normalize: true,
    });

    return Array.from(output.data as Float32Array);
}


// ── MESSAGE HANDLER ─────────────────────────────────────────────────

self.addEventListener('message', async (event) => {
    const { type, id, text } = event.data;

    if (type === 'embed') {
        try {
            const embedding = await computeEmbedding(text);
            self.postMessage({ type: 'result', id, embedding });
        } catch (err: any) {
            self.postMessage({ type: 'error', id, error: err.message || String(err) });
        }
    } else if (type === 'preload') {
        try {
            await ensurePipeline();
        } catch (err: any) {
            self.postMessage({ type: 'error', id: 0, error: err.message || String(err) });
        }
    }
});
