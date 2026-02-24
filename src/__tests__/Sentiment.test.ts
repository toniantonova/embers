/**
 * Sentiment.test.ts — Tests for NLP sentiment scoring.
 *
 * Tests that computeSentiment() produces the right values for the
 * textSentiment uniform slot [7] in AudioUniforms.
 */

import { describe, it, expect } from 'vitest';
import { computeSentiment, sentimentLabel } from '../nlp/sentiment';


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: BASIC SCORING
// ══════════════════════════════════════════════════════════════════════

describe('Sentiment — Basic Scoring', () => {
    it('returns 0 for empty string', () => {
        expect(computeSentiment('')).toBe(0);
    });

    it('returns 0 for neutral/unknown words', () => {
        expect(computeSentiment('the')).toBe(0);
        expect(computeSentiment('and but or if')).toBe(0);
    });

    it('returns positive for positive words', () => {
        expect(computeSentiment('happy')).toBeGreaterThan(0);
        expect(computeSentiment('amazing')).toBeGreaterThan(0);
    });

    it('returns negative for negative words', () => {
        expect(computeSentiment('terrible')).toBeLessThan(0);
        expect(computeSentiment('hate')).toBeLessThan(0);
    });

    it('scores are in −1..+1 range', () => {
        expect(computeSentiment('superb outstanding thrilling')).toBeLessThanOrEqual(1.0);
        expect(computeSentiment('devastating horrific atrocious')).toBeGreaterThanOrEqual(-1.0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: NEGATION
// ══════════════════════════════════════════════════════════════════════

describe('Sentiment — Negation', () => {
    it('"not happy" is less positive than "happy"', () => {
        const happy = computeSentiment('happy');
        const notHappy = computeSentiment('not happy');
        expect(notHappy).toBeLessThan(happy);
    });

    it('"not terrible" is more positive than "terrible"', () => {
        const terrible = computeSentiment('terrible');
        const notTerrible = computeSentiment('not terrible');
        expect(notTerrible).toBeGreaterThan(terrible);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: INTENSITY MODIFIERS
// ══════════════════════════════════════════════════════════════════════

describe('Sentiment — Intensity', () => {
    it('"very happy" is more positive than "happy"', () => {
        const happy = computeSentiment('happy');
        const veryHappy = computeSentiment('very happy');
        expect(veryHappy).toBeGreaterThan(happy);
    });

    it('"slightly happy" is less positive than "happy"', () => {
        const happy = computeSentiment('happy');
        const slightlyHappy = computeSentiment('slightly happy');
        expect(slightlyHappy).toBeLessThan(happy);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: LABEL CLASSIFICATION
// ══════════════════════════════════════════════════════════════════════

describe('sentimentLabel', () => {
    it('classifies "happy" as positive', () => {
        expect(sentimentLabel('happy')).toBe('positive');
    });

    it('classifies "terrible" as negative', () => {
        expect(sentimentLabel('terrible')).toBe('negative');
    });

    it('classifies neutral text as neutral', () => {
        expect(sentimentLabel('the')).toBe('neutral');
    });

    it('classifies empty string as neutral', () => {
        expect(sentimentLabel('')).toBe('neutral');
    });
});
