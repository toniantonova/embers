/**
 * tier1-orchestrator.ts — Ties verb lookup + sentence parsing + template resolution.
 *
 * WHAT THIS DOES:
 * ───────────────
 * The main entry point for Tier 1 verb→animation resolution.
 * Given spoken/typed text, it:
 *   1. Parses the sentence (verb, subject, adverb, etc.)
 *   2. Looks up the verb in the hash table (O(1), <0.1ms)
 *   3. If hash miss → tries embedding fallback (async, <20ms warm)
 *   4. Resolves any adverb overrides from the template
 *   5. Returns a Tier1Result with templateId + overrides + parsed sentence
 *
 * NOTE ON targetPart:
 * ───────────────────
 * The parsed sentence includes targetPart (body part mentions like "tail",
 * "head", "legs") but the Tier 1 orchestrator does NOT use it. It passes
 * through in ParsedSentence for A5/Tier 2 consumers who will use it to
 * override template part_rules with per-part primitive targeting.
 *
 * LATENCY TARGETS:
 * ────────────────
 * - Hash hit: <5ms total (parse + lookup + adverb resolve)
 * - Embedding fallback (warm): <20ms total
 * - Embedding fallback (cold — model loading): ~2-3s on first hash miss
 *   → call initEmbeddingWorker() at app startup to preload the model
 * - Embedding fallback (no real embeddings loaded): returns null immediately
 */

import { parseSentence } from '../nlp/sentence-parser';
import type { ParsedSentence } from '../nlp/sentence-parser';
import { VerbHashTable } from './verb-hash-table';
import type { VerbHashData } from './verb-hash-table';
import { EmbeddingFallback } from './embedding-fallback';
import type { AnchorEmbeddings, EmbeddingMatch } from './embedding-fallback';
import { resolveAdverb } from './adverb-resolver';
import type { TemplateJSON, ParseOverrides } from '../templates/template-types';
import { TemplateLibrary } from '../templates/template-library';


// ── TYPES ───────────────────────────────────────────────────────────

/** Result from Tier 1 resolution. */
export interface Tier1Result {
    /** Template ID to use for animation */
    templateId: string;
    /** Template JSON (if found in library) */
    template: TemplateJSON | null;
    /** Override parameters (from adverb resolution) */
    overrides: ParseOverrides;
    /** Parsed sentence (includes forward-looking targetPart for A5) */
    parsed: ParsedSentence;
    /** How this result was resolved */
    source: 'hash' | 'embedding' | 'none';
    /** Resolution latency in milliseconds */
    latencyMs: number;
    /** Embedding match details (if source is 'embedding') */
    embeddingMatch?: EmbeddingMatch;
}


// ── ORCHESTRATOR ────────────────────────────────────────────────────

export class Tier1Orchestrator {
    private hashTable: VerbHashTable;
    private embeddingFallback: EmbeddingFallback;
    private templateLibrary: TemplateLibrary;

    constructor(
        hashData: VerbHashData,
        templateLibrary: TemplateLibrary,
        anchorEmbeddings?: AnchorEmbeddings,
    ) {
        this.hashTable = new VerbHashTable(hashData);
        this.templateLibrary = templateLibrary;
        this.embeddingFallback = new EmbeddingFallback(0.6);

        // Only load anchor embeddings if provided — fallback returns null otherwise
        if (anchorEmbeddings) {
            this.embeddingFallback.loadAnchors(anchorEmbeddings);
        }
    }

    /**
     * Initialize the embedding worker for fallback lookups.
     * Call this at app startup to preload the MiniLM model in the
     * background, hiding the ~2-3s model download latency.
     * No-op if embeddings aren't loaded (safety — see embedding-fallback.ts).
     */
    initEmbeddingWorker(): void {
        this.embeddingFallback.initWorker();
    }

    /**
     * Resolve text to an animation template.
     *
     * Pipeline:
     * 1. Parse sentence → extract verb, adverb, etc.
     * 2. Hash lookup verb → templateId (instant)
     * 3. If miss → embedding fallback → templateId (async, <20ms warm)
     *    NOTE: embedding fallback returns null if no real anchors loaded
     * 4. Resolve adverb → ParseOverrides
     * 5. Return full result
     *
     * @param text - Raw spoken/typed text
     * @returns Tier1Result or null if no verb/template found
     */
    async resolve(text: string): Promise<Tier1Result | null> {
        const start = performance.now();

        // Step 1: Parse the sentence
        const parsed = parseSentence(text);
        const verb = parsed.verb;

        if (!verb) {
            return null;
        }

        // Step 2: Hash table lookup (O(1))
        let templateId = this.hashTable.lookup(verb);
        let source: Tier1Result['source'] = 'hash';
        let embeddingMatch: EmbeddingMatch | undefined;

        // Step 3: Embedding fallback (if hash miss)
        // Returns null safely if no real anchor embeddings are loaded
        if (!templateId) {
            const match = await this.embeddingFallback.findMatch(verb);
            if (match) {
                templateId = match.templateId;
                source = 'embedding';
                embeddingMatch = match;
            }
        }

        // No match at all
        if (!templateId) {
            return null;
        }

        // Step 4: Look up the template
        const template = this.templateLibrary.getTemplate(templateId) ?? null;

        // Step 5: Resolve adverb overrides
        let overrides: ParseOverrides = {};
        if (template && parsed.adverb) {
            overrides = resolveAdverb(parsed.adverb, template);
        }

        const latencyMs = performance.now() - start;

        return {
            templateId,
            template,
            overrides,
            parsed,
            source,
            latencyMs,
            embeddingMatch,
        };
    }

    /**
     * Fast synchronous resolve — hash table only, no embedding fallback.
     * Use when you need guaranteed <1ms latency.
     *
     * @param text - Raw text (only the verb will be extracted)
     * @returns Tier1Result or null
     */
    resolveSync(text: string): Tier1Result | null {
        const start = performance.now();

        const parsed = parseSentence(text);
        const verb = parsed.verb;

        if (!verb) return null;

        const templateId = this.hashTable.lookup(verb);
        if (!templateId) return null;

        const template = this.templateLibrary.getTemplate(templateId) ?? null;
        let overrides: ParseOverrides = {};
        if (template && parsed.adverb) {
            overrides = resolveAdverb(parsed.adverb, template);
        }

        return {
            templateId,
            template,
            overrides,
            parsed,
            source: 'hash',
            latencyMs: performance.now() - start,
        };
    }

    /** Whether the embedding model is loaded and ready for fallback. */
    get isEmbeddingReady(): boolean {
        return this.embeddingFallback.isReady;
    }

    /** Number of verbs in the hash table. */
    get hashTableSize(): number {
        return this.hashTable.size;
    }

    /** Clean up resources (worker, caches). */
    dispose(): void {
        this.embeddingFallback.dispose();
    }
}
