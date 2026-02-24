/**
 * GhostTranscript.test.ts — Unit tests for the ghost transcript utility.
 *
 * Tests the pure accumulation, cleanup, and opacity logic extracted from
 * the TuningPanel React component into GhostTranscript.ts.
 */
import { describe, it, expect } from 'vitest';
import {
    accumulateGhostWords,
    cleanupExpiredWords,
    ghostWordOpacity,
    GHOST_LIFESPAN_MS,
    GHOST_MAX_WORDS,
} from '../services/GhostTranscript';
import type { GhostWord } from '../services/GhostTranscript';
import type { SemanticEvent } from '../services/SemanticBackend';
import type { TranscriptEvent } from '../services/SpeechEngine';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a minimal final transcript event */
function finalTranscript(text: string): TranscriptEvent {
    return { text, isFinal: true, timestamp: Date.now() };
}

/** Create an interim (non-final) transcript event */
function interimTranscript(text: string): TranscriptEvent {
    return { text, isFinal: false, timestamp: Date.now() };
}

/** Create a morph semantic event with a given dominant word */
function morphEvent(dominantWord: string): SemanticEvent {
    return {
        timestamp: Date.now(),
        text: `I see a ${dominantWord}`,
        classification: {
            morphTarget: 'quadruped',
            abstractionLevel: 0.3,
            sentiment: 0.5,
            emotionalIntensity: 0.5,
            confidence: 0.9,
            dominantWord,
        },
        action: 'morph',
    };
}

/** Create a hold semantic event (no keyword matched) */
function holdEvent(): SemanticEvent {
    return {
        timestamp: Date.now(),
        text: 'the and but',
        classification: {
            morphTarget: 'ring',
            abstractionLevel: 0.8,
            sentiment: 0,
            emotionalIntensity: 0.1,
            confidence: 0.1,
            dominantWord: '',
        },
        action: 'hold',
    };
}


// ═══════════════════════════════════════════════════════════════════════
// accumulateGhostWords
// ═══════════════════════════════════════════════════════════════════════

describe('accumulateGhostWords', () => {

    it('splits a transcript into individual words', () => {
        const result = accumulateGhostWords([], finalTranscript('hello world'), null, 0, 1000);
        expect(result.words).toHaveLength(2);
        expect(result.words[0].text).toBe('hello');
        expect(result.words[1].text).toBe('world');
    });

    it('assigns incrementing IDs', () => {
        const result = accumulateGhostWords([], finalTranscript('a b c'), null, 10, 1000);
        expect(result.words.map(w => w.id)).toEqual([10, 11, 12]);
        expect(result.nextId).toBe(13);
    });

    it('uses the provided timestamp', () => {
        const result = accumulateGhostWords([], finalTranscript('test'), null, 0, 5000);
        expect(result.words[0].timestamp).toBe(5000);
    });

    it('appends to existing words', () => {
        const existing: GhostWord[] = [
            { id: 0, text: 'old', timestamp: 500, isKeyword: false },
        ];
        const result = accumulateGhostWords(existing, finalTranscript('new'), null, 1, 1000);
        expect(result.words).toHaveLength(2);
        expect(result.words[0].text).toBe('old');
        expect(result.words[1].text).toBe('new');
    });

    it('ignores interim (non-final) transcripts', () => {
        const result = accumulateGhostWords([], interimTranscript('partial'), null, 0, 1000);
        expect(result.words).toHaveLength(0);
        expect(result.nextId).toBe(0);
    });

    it('handles extra whitespace and trims', () => {
        const result = accumulateGhostWords([], finalTranscript('  hello   world  '), null, 0, 1000);
        expect(result.words).toHaveLength(2);
        expect(result.words[0].text).toBe('hello');
        expect(result.words[1].text).toBe('world');
    });

    it('handles empty text gracefully', () => {
        const result = accumulateGhostWords([], finalTranscript(''), null, 0, 1000);
        expect(result.words).toHaveLength(0);
    });

    it('handles whitespace-only text gracefully', () => {
        const result = accumulateGhostWords([], finalTranscript('   '), null, 0, 1000);
        expect(result.words).toHaveLength(0);
    });

    // ── Keyword detection ────────────────────────────────────────

    it('marks the keyword when a morph event is present', () => {
        const event = morphEvent('horse');
        const result = accumulateGhostWords(
            [], finalTranscript('I see a horse running'), event, 0, 1000
        );
        const keywords = result.words.filter(w => w.isKeyword);
        expect(keywords).toHaveLength(1);
        expect(keywords[0].text).toBe('horse');
    });

    it('keyword matching is case-insensitive', () => {
        const event = morphEvent('horse');
        const result = accumulateGhostWords(
            [], finalTranscript('HORSE'), event, 0, 1000
        );
        expect(result.words[0].isKeyword).toBe(true);
    });

    it('keyword matching strips punctuation from text', () => {
        const event = morphEvent('horse');
        const result = accumulateGhostWords(
            [], finalTranscript('horse!'), event, 0, 1000
        );
        expect(result.words[0].isKeyword).toBe(true);
    });

    it('does not mark keywords for hold events', () => {
        const event = holdEvent();
        const result = accumulateGhostWords(
            [], finalTranscript('horse running'), event, 0, 1000
        );
        const keywords = result.words.filter(w => w.isKeyword);
        expect(keywords).toHaveLength(0);
    });

    it('does not mark keywords when semantic event is null', () => {
        const result = accumulateGhostWords(
            [], finalTranscript('horse'), null, 0, 1000
        );
        expect(result.words[0].isKeyword).toBe(false);
    });

    it('does not mark keywords when semantic event is undefined', () => {
        const result = accumulateGhostWords(
            [], finalTranscript('horse'), undefined, 0, 1000
        );
        expect(result.words[0].isKeyword).toBe(false);
    });

    // ── Capacity cap ─────────────────────────────────────────────

    it('caps total words at GHOST_MAX_WORDS', () => {
        // Start with GHOST_MAX_WORDS - 5 words
        const existing: GhostWord[] = Array.from({ length: GHOST_MAX_WORDS - 5 }, (_, i) => ({
            id: i, text: `word${i}`, timestamp: 0, isKeyword: false,
        }));
        // Add 10 more (should be capped)
        const tenWords = Array.from({ length: 10 }, (_, i) => `w${i}`).join(' ');
        const result = accumulateGhostWords(
            existing, finalTranscript(tenWords), null, existing.length, 1000
        );
        expect(result.words.length).toBe(GHOST_MAX_WORDS);
    });

    it('keeps the most recent words when capped', () => {
        const existing: GhostWord[] = Array.from({ length: GHOST_MAX_WORDS }, (_, i) => ({
            id: i, text: `old${i}`, timestamp: 0, isKeyword: false,
        }));
        const result = accumulateGhostWords(
            existing, finalTranscript('brand new'), null, GHOST_MAX_WORDS, 1000
        );
        // Last two words should be the new ones
        const lastTwo = result.words.slice(-2);
        expect(lastTwo[0].text).toBe('brand');
        expect(lastTwo[1].text).toBe('new');
        expect(result.words.length).toBe(GHOST_MAX_WORDS);
    });
});


// ═══════════════════════════════════════════════════════════════════════
// cleanupExpiredWords
// ═══════════════════════════════════════════════════════════════════════

describe('cleanupExpiredWords', () => {

    it('removes words older than GHOST_LIFESPAN_MS', () => {
        const now = 10000;
        const words: GhostWord[] = [
            { id: 0, text: 'old', timestamp: now - GHOST_LIFESPAN_MS - 1, isKeyword: false },
            { id: 1, text: 'recent', timestamp: now - 1000, isKeyword: false },
        ];
        const result = cleanupExpiredWords(words, now);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('recent');
    });

    it('keeps words that are exactly at the lifespan boundary', () => {
        const now = 10000;
        const words: GhostWord[] = [
            { id: 0, text: 'boundary', timestamp: now - GHOST_LIFESPAN_MS, isKeyword: false },
        ];
        // timestamp === cutoff → NOT > cutoff → removed
        const result = cleanupExpiredWords(words, now);
        expect(result).toHaveLength(0);
    });

    it('returns the same array reference when nothing changed', () => {
        const now = 10000;
        const words: GhostWord[] = [
            { id: 0, text: 'fresh', timestamp: now, isKeyword: false },
        ];
        const result = cleanupExpiredWords(words, now);
        expect(result).toBe(words); // same reference
    });

    it('handles empty array', () => {
        const result = cleanupExpiredWords([], 10000);
        expect(result).toEqual([]);
    });

    it('removes all words when all are expired', () => {
        const now = 100000;
        const words: GhostWord[] = [
            { id: 0, text: 'a', timestamp: 0, isKeyword: false },
            { id: 1, text: 'b', timestamp: 1000, isKeyword: false },
        ];
        const result = cleanupExpiredWords(words, now);
        expect(result).toHaveLength(0);
    });
});


// ═══════════════════════════════════════════════════════════════════════
// ghostWordOpacity
// ═══════════════════════════════════════════════════════════════════════

describe('ghostWordOpacity', () => {

    it('returns 1.0 for a brand-new word', () => {
        const now = 5000;
        const word: GhostWord = { id: 0, text: 'new', timestamp: now, isKeyword: false };
        expect(ghostWordOpacity(word, now)).toBeCloseTo(1.0);
    });

    it('returns 0.5 at half the lifespan', () => {
        const now = 5000 + GHOST_LIFESPAN_MS / 2;
        const word: GhostWord = { id: 0, text: 'mid', timestamp: 5000, isKeyword: false };
        expect(ghostWordOpacity(word, now)).toBeCloseTo(0.5);
    });

    it('returns 0.1 minimum for fully-expired words', () => {
        const now = 5000 + GHOST_LIFESPAN_MS + 1000;
        const word: GhostWord = { id: 0, text: 'old', timestamp: 5000, isKeyword: false };
        expect(ghostWordOpacity(word, now)).toBe(0.1);
    });

    it('returns exactly 0.1 at the lifespan boundary', () => {
        const now = 5000 + GHOST_LIFESPAN_MS;
        const word: GhostWord = { id: 0, text: 'edge', timestamp: 5000, isKeyword: false };
        // age / GHOST_LIFESPAN_MS = 1.0 → 1 - 1 = 0 → clamped to 0.1
        expect(ghostWordOpacity(word, now)).toBe(0.1);
    });

    it('returns correct value at 75% of lifespan', () => {
        const now = 5000 + GHOST_LIFESPAN_MS * 0.75;
        const word: GhostWord = { id: 0, text: 'fading', timestamp: 5000, isKeyword: false };
        expect(ghostWordOpacity(word, now)).toBeCloseTo(0.25);
    });
});
