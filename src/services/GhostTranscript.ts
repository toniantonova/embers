/**
 * GhostTranscript — Pure utility functions for ghost transcript word management.
 *
 * Extracted from TuningPanel React hooks so the accumulation, keyword detection,
 * and cleanup logic can be unit-tested without a DOM or React rendering context.
 */

import type { SemanticEvent } from './SemanticBackend';
import type { TranscriptEvent } from './SpeechEngine';

// ── Configuration ────────────────────────────────────────────────────
export const GHOST_LIFESPAN_MS = 6000;     // Words disappear after 6s
export const GHOST_MAX_WORDS = 40;         // Cap to prevent memory growth

// ── Types ────────────────────────────────────────────────────────────
export interface GhostWord {
    id: number;
    text: string;
    timestamp: number;
    isKeyword: boolean;
}

/**
 * Accumulate new ghost words from a final transcript event.
 *
 * - Splits the transcript text into individual words
 * - Marks the keyword that triggered a morph (if any)
 * - Appends to existing words, capping at GHOST_MAX_WORDS
 *
 * @param prev     Existing ghost words array
 * @param transcript  The transcript event (must be final)
 * @param semanticEvent  Latest semantic event (for keyword detection)
 * @param nextId   Next unique ID to assign (counter start)
 * @param now      Current timestamp (injectable for testing)
 * @returns        { words: new ghost words array, nextId: updated counter }
 */
export function accumulateGhostWords(
    prev: GhostWord[],
    transcript: TranscriptEvent,
    semanticEvent: SemanticEvent | null | undefined,
    nextId: number,
    now: number = Date.now(),
): { words: GhostWord[]; nextId: number } {
    // Only process final transcripts
    if (!transcript.isFinal) {
        return { words: prev, nextId };
    }

    // Determine keyword from the latest morph action
    const keywordWord = semanticEvent?.action === 'morph'
        ? semanticEvent.classification.dominantWord.toLowerCase()
        : '';

    // Split text into individual words
    const rawWords = transcript.text
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 0);

    let id = nextId;
    const newGhosts: GhostWord[] = rawWords.map(w => ({
        id: id++,
        text: w,
        timestamp: now,
        isKeyword: keywordWord !== '' && w.toLowerCase().replace(/[^a-z]/g, '') === keywordWord,
    }));

    const combined = [...prev, ...newGhosts];
    const words = combined.length > GHOST_MAX_WORDS
        ? combined.slice(combined.length - GHOST_MAX_WORDS)
        : combined;

    return { words, nextId: id };
}

/**
 * Remove ghost words older than GHOST_LIFESPAN_MS.
 *
 * Returns the same array reference if nothing was removed (React optimization).
 *
 * @param words  Current ghost words array
 * @param now    Current timestamp (injectable for testing)
 */
export function cleanupExpiredWords(
    words: GhostWord[],
    now: number = Date.now(),
): GhostWord[] {
    const cutoff = now - GHOST_LIFESPAN_MS;
    const filtered = words.filter(w => w.timestamp > cutoff);
    return filtered.length === words.length ? words : filtered;
}

/**
 * Compute the display opacity for a ghost word based on its age.
 *
 * @param word  The ghost word
 * @param now   Current timestamp
 * @returns     Opacity value between 0.1 and 1.0
 */
export function ghostWordOpacity(word: GhostWord, now: number = Date.now()): number {
    const age = now - word.timestamp;
    return Math.max(0.1, 1 - age / GHOST_LIFESPAN_MS);
}
