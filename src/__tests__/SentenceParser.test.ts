/**
 * SentenceParser.test.ts — Tests for compromise.js sentence parsing.
 */

import { describe, it, expect } from 'vitest';
import { parseSentence, extractVerb } from '../nlp/sentence-parser';


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: VERB EXTRACTION
// ══════════════════════════════════════════════════════════════════════

describe('SentenceParser — Verb Extraction', () => {
    it('extracts verb from imperative sentence', () => {
        const result = parseSentence('run quickly');
        expect(result.verb).toBeTruthy();
        expect(result.verb).toBe('run');
    });

    it('extracts verb from bare verb', () => {
        const result = parseSentence('jump');
        expect(result.verb).toBe('jump');
    });

    it('extracts verb from declarative sentence', () => {
        const result = parseSentence('the horse runs fast');
        expect(result.verb).toBeTruthy();
    });

    it('returns null verb for empty string', () => {
        const result = parseSentence('');
        expect(result.verb).toBeNull();
    });

    it('returns null verb for whitespace only', () => {
        const result = parseSentence('   ');
        expect(result.verb).toBeNull();
    });

    it('handles single-word verb input', () => {
        const result = parseSentence('eat');
        expect(result.verb).toBe('eat');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: ADVERB EXTRACTION
// ══════════════════════════════════════════════════════════════════════

describe('SentenceParser — Adverb Extraction', () => {
    it('extracts adverb from "run quickly"', () => {
        const result = parseSentence('run quickly');
        expect(result.adverb).toBe('quickly');
    });

    it('extracts adverb from "slowly walk"', () => {
        const result = parseSentence('slowly walk');
        expect(result.adverb).toBe('slowly');
    });

    it('returns null adverb when none present', () => {
        const result = parseSentence('run');
        expect(result.adverb).toBeNull();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: TARGET PART DETECTION (forward-looking for A5)
// ══════════════════════════════════════════════════════════════════════

describe('SentenceParser — Target Part Detection', () => {
    it('detects "head" as target part', () => {
        const result = parseSentence('shake the head');
        expect(result.targetPart).toBe('head');
    });

    it('detects "tail" as target part', () => {
        const result = parseSentence('wag the tail');
        expect(result.targetPart).toBe('tail');
    });

    it('detects "legs" as target part', () => {
        const result = parseSentence('move the legs');
        expect(result.targetPart).toBe('legs');
    });

    it('returns null when no body part mentioned', () => {
        const result = parseSentence('run quickly');
        expect(result.targetPart).toBeNull();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: CONFIDENCE
// ══════════════════════════════════════════════════════════════════════

describe('SentenceParser — Confidence', () => {
    it('empty input gives 0 confidence', () => {
        expect(parseSentence('').confidence).toBe(0);
    });

    it('single verb gives moderate confidence', () => {
        const result = parseSentence('jump');
        expect(result.confidence).toBeGreaterThan(0);
    });

    it('full sentence gives higher confidence', () => {
        const simple = parseSentence('jump');
        const complex = parseSentence('quickly jump over the fence');
        expect(complex.confidence).toBeGreaterThanOrEqual(simple.confidence);
    });

    it('rawText is preserved', () => {
        const result = parseSentence('run quickly');
        expect(result.rawText).toBe('run quickly');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: extractVerb shorthand
// ══════════════════════════════════════════════════════════════════════

describe('extractVerb', () => {
    it('extracts verb from simple sentence', () => {
        const verb = extractVerb('jump');
        expect(verb).toBe('jump');
    });

    it('returns null for empty string', () => {
        expect(extractVerb('')).toBeNull();
    });

    it('returns first word as fallback', () => {
        const verb = extractVerb('xyzzy');
        expect(verb).toBe('xyzzy');
    });
});
