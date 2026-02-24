/**
 * KeywordClassifier.sentimentOnly.test.ts — Tests for classifySentimentOnly()
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * classifySentimentOnly() extracts AFINN sentiment and action modifier
 * intensity WITHOUT performing keyword/dictionary lookup. Used in Complex
 * mode where the classifier is bypassed for shape routing but we still
 * need sentiment data for driving color + movement.
 *
 * COVERAGE:
 * - Positive/negative/neutral AFINN scoring
 * - Action modifier intensity multipliers
 * - Empty input and edge cases
 * - Multi-word sentiment averaging
 * - Word arousal override behavior
 */

import { describe, it, expect } from 'vitest';
import { KeywordClassifier } from '../services/KeywordClassifier';

const classifier = new KeywordClassifier();

// ══════════════════════════════════════════════════════════════════════
// SUITE 1: SENTIMENT SCORING
// ══════════════════════════════════════════════════════════════════════

describe('classifySentimentOnly — Sentiment', () => {
    it('returns positive sentiment for happy words', () => {
        const result = classifier.classifySentimentOnly('happy wonderful great');
        expect(result.sentiment).toBeGreaterThan(0);
    });

    it('returns negative sentiment for sad words', () => {
        const result = classifier.classifySentimentOnly('terrible awful horrible');
        expect(result.sentiment).toBeLessThan(0);
    });

    it('returns zero sentiment for neutral/unknown words', () => {
        const result = classifier.classifySentimentOnly('table chair window');
        expect(result.sentiment).toBe(0);
    });

    it('returns zero sentiment for empty string', () => {
        const result = classifier.classifySentimentOnly('');
        expect(result.sentiment).toBe(0);
        expect(result.emotionalIntensity).toBe(0.3);
    });

    it('returns zero sentiment for whitespace-only', () => {
        const result = classifier.classifySentimentOnly('   ');
        expect(result.sentiment).toBe(0);
    });

    it('averages sentiment across multiple AFINN words', () => {
        // 'happy' is positive, 'sad' is negative — should partially cancel
        const mixed = classifier.classifySentimentOnly('happy sad');
        const purePositive = classifier.classifySentimentOnly('happy');
        expect(Math.abs(mixed.sentiment)).toBeLessThan(Math.abs(purePositive.sentiment));
    });

    it('clamps sentiment to [-1, 1]', () => {
        // Use many extreme positive words
        const result = classifier.classifySentimentOnly(
            'outstanding outstanding outstanding outstanding outstanding'
        );
        expect(result.sentiment).toBeLessThanOrEqual(1);
        expect(result.sentiment).toBeGreaterThanOrEqual(-1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: EMOTIONAL INTENSITY
// ══════════════════════════════════════════════════════════════════════

describe('classifySentimentOnly — Emotional Intensity', () => {
    it('returns base intensity (0.3) when no modifiers present', () => {
        // No AFINN words, no action modifiers → base 0.3
        const result = classifier.classifySentimentOnly('table chair');
        expect(result.emotionalIntensity).toBeCloseTo(0.3, 1);
    });

    it('intensity is clamped to [0, 1]', () => {
        const result = classifier.classifySentimentOnly('extremely violently furiously');
        expect(result.emotionalIntensity).toBeLessThanOrEqual(1);
        expect(result.emotionalIntensity).toBeGreaterThanOrEqual(0);
    });

    it('handles mixed sentiment + modifier words', () => {
        // Words that have both sentiment and modifier effects
        const result = classifier.classifySentimentOnly('happy violently');
        expect(result.sentiment).toBeGreaterThan(0);
        // Should have some intensity (base 0.3 * modifier or arousal)
        expect(result.emotionalIntensity).toBeGreaterThan(0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: RETURN TYPE
// ══════════════════════════════════════════════════════════════════════

describe('classifySentimentOnly — Return Type', () => {
    it('returns only sentiment and emotionalIntensity (no morphTarget)', () => {
        const result = classifier.classifySentimentOnly('beautiful horse');
        expect(result).toHaveProperty('sentiment');
        expect(result).toHaveProperty('emotionalIntensity');
        // Should NOT have morphTarget — that's the whole point
        expect(result).not.toHaveProperty('morphTarget');
        expect(result).not.toHaveProperty('dominantWord');
        expect(result).not.toHaveProperty('confidence');
    });

    it('strips punctuation and normalizes case', () => {
        // 'HAPPY!' should still trigger positive sentiment
        const result = classifier.classifySentimentOnly('HAPPY! WONDERFUL!');
        expect(result.sentiment).toBeGreaterThan(0);
    });
});
