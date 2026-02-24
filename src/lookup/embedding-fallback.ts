/**
 * embedding-fallback.ts — MiniLM cosine similarity fallback.
 *
 * WHEN THIS FIRES:
 * ────────────────
 * When a verb isn't in the 393-entry hash table, the orchestrator calls
 * findMatch() to try semantic similarity against anchor verb embeddings.
 *
 * SAFETY:
 * ───────
 * This module REQUIRES real pre-computed MiniLM embeddings to function.
 * If no anchor embeddings are loaded (or the anchor list is empty),
 * findMatch() explicitly returns null — it will NEVER return a garbage
 * match from placeholder/random vectors. The `anchorsLoaded` flag
 * tracks whether real embeddings have been provided.
 *
 * LATENCY (see embedding-worker.ts for details):
 * ───────
 * - First call after page load: ~2-3s if model isn't preloaded
 * - Warm calls: <20ms (worker + cosine search)
 * - Cached results: <0.1ms
 * - Per-request timeout: 10s (prevents blocking the animation pipeline)
 *
 * TO GENERATE REAL EMBEDDINGS:
 * ────────────────────────────
 * Run: npx tsx src/lookup/generate-anchor-embeddings.ts
 * This produces data/anchor-embeddings.json with real MiniLM-L6-v2 vectors.
 */


// ── TYPES ───────────────────────────────────────────────────────────

/** Pre-computed anchor embeddings format. */
export interface AnchorEmbeddings {
    /** Dimensionality of embeddings (384 for MiniLM) */
    dimension: number;
    /** Map of template_id → { verb → embedding } */
    templates: Record<string, Record<string, number[]>>;
}

/** Result from an embedding lookup. */
export interface EmbeddingMatch {
    templateId: string;
    verb: string;
    similarity: number;
}


// ── COSINE SIMILARITY ───────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Both vectors should be pre-normalized (unit vectors) for speed.
 */
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}


// ── EMBEDDING FALLBACK ──────────────────────────────────────────────

export class EmbeddingFallback {
    /** Flattened list of anchor embeddings for fast search. */
    private anchors: Array<{ templateId: string; verb: string; embedding: number[] }> = [];

    /** Cached results to avoid re-computing. */
    private cache = new Map<string, EmbeddingMatch | null>();

    /** Web Worker for embedding computation. */
    private worker: Worker | null = null;

    /** Pending requests waiting for worker response. */
    private pendingRequests = new Map<number, {
        resolve: (embedding: number[]) => void;
        reject: (error: Error) => void;
    }>();

    /** Request ID counter. */
    private nextId = 1;

    /** Whether the model is loaded and ready. */
    private _isReady = false;

    /** Whether real anchor embeddings have been loaded. */
    private _anchorsLoaded = false;

    /** Minimum similarity threshold for a match. */
    private threshold: number;

    constructor(threshold = 0.6) {
        this.threshold = threshold;
    }

    /**
     * Load pre-computed anchor embeddings.
     * Only sets _anchorsLoaded = true if embeddings are non-empty.
     *
     * @param data - Anchor embeddings JSON (must contain real MiniLM vectors)
     */
    loadAnchors(data: AnchorEmbeddings): void {
        this.anchors = [];
        for (const [templateId, verbs] of Object.entries(data.templates)) {
            for (const [verb, embedding] of Object.entries(verbs)) {
                this.anchors.push({ templateId, verb, embedding });
            }
        }
        this._anchorsLoaded = this.anchors.length > 0;
        console.log(
            `[EmbeddingFallback] Loaded ${this.anchors.length} anchor embeddings ` +
            `across ${Object.keys(data.templates).length} templates`
        );
    }

    /**
     * Initialize the Web Worker for embedding computation.
     * Call this at app startup to preload the MiniLM model and hide
     * the ~2-3s model download latency.
     */
    initWorker(): void {
        if (this.worker) return;

        try {
            this.worker = new Worker(
                new URL('./embedding-worker.ts', import.meta.url),
                { type: 'module' }
            );

            this.worker.addEventListener('message', (event) => {
                const { type, id, embedding, error } = event.data;

                if (type === 'ready') {
                    this._isReady = true;
                    console.log('[EmbeddingFallback] MiniLM model loaded');
                } else if (type === 'result') {
                    const pending = this.pendingRequests.get(id);
                    if (pending) {
                        pending.resolve(embedding);
                        this.pendingRequests.delete(id);
                    }
                } else if (type === 'error') {
                    const pending = this.pendingRequests.get(id);
                    if (pending) {
                        pending.reject(new Error(error));
                        this.pendingRequests.delete(id);
                    }
                }
            });

            // Preload the model immediately — hide latency during page load
            this.worker.postMessage({ type: 'preload' });
        } catch (err) {
            console.warn('[EmbeddingFallback] Web Worker not available:', err);
        }
    }

    /**
     * Find the best matching template for a verb using embedding similarity.
     *
     * SAFETY: Returns null if no real anchor embeddings are loaded. This
     * prevents garbage matches from placeholder vectors.
     *
     * @param verb - The verb to match
     * @returns Best match above threshold, or null
     */
    async findMatch(verb: string): Promise<EmbeddingMatch | null> {
        if (!verb) return null;

        // SAFETY: refuse to match without real anchor embeddings
        if (!this._anchorsLoaded || this.anchors.length === 0) {
            return null;
        }

        const normalized = verb.toLowerCase().trim();

        // Check cache first
        if (this.cache.has(normalized)) {
            return this.cache.get(normalized)!;
        }

        // If no worker, can't compute embeddings
        if (!this.worker) {
            return null;
        }

        try {
            // Get embedding from worker (10s timeout per request)
            const embedding = await this.requestEmbedding(normalized);

            // Find best cosine match
            let bestMatch: EmbeddingMatch | null = null;
            let bestSim = -1;

            for (const anchor of this.anchors) {
                const sim = cosineSimilarity(embedding, anchor.embedding);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestMatch = {
                        templateId: anchor.templateId,
                        verb: anchor.verb,
                        similarity: sim,
                    };
                }
            }

            // Apply threshold
            const result = bestMatch && bestMatch.similarity >= this.threshold
                ? bestMatch
                : null;

            // Cache the result
            this.cache.set(normalized, result);
            return result;
        } catch (err) {
            console.warn(`[EmbeddingFallback] Failed for "${normalized}":`, err);
            return null;
        }
    }

    /**
     * Send a text to the worker for embedding computation.
     * Times out after 10 seconds to prevent blocking the animation pipeline.
     */
    private requestEmbedding(text: string): Promise<number[]> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const id = this.nextId++;
            this.pendingRequests.set(id, { resolve, reject });
            this.worker.postMessage({ type: 'embed', id, text });

            // 10s timeout — falls back to "no template" rather than blocking
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Embedding timeout for "${text}" (10s)`));
                }
            }, 10_000);
        });
    }

    /** Whether the MiniLM model is loaded. */
    get isReady(): boolean {
        return this._isReady;
    }

    /** Whether real anchor embeddings are loaded (not placeholders). */
    get anchorsLoaded(): boolean {
        return this._anchorsLoaded;
    }

    /** Clean up the worker. */
    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        this.pendingRequests.clear();
        this.cache.clear();
    }
}
