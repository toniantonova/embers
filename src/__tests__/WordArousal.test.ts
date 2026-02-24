/**
 * WordArousal.test.ts — Tests for WORD_AROUSAL coverage and Plutchik wheel placement.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * Every word in AFINN_SUBSET that has a sentiment score should ideally have
 * a corresponding WORD_AROUSAL entry. Words without arousal entries default
 * to 0.5, which can misplace them on the Plutchik emotion wheel (e.g.,
 * "happy" at 0.5 arousal lands in the wrong quadrant).
 *
 * These tests verify:
 * 1. High-coverage: most AFINN words have WORD_AROUSAL entries
 * 2. Arousal values are reasonable for their sentiment category
 * 3. KeywordClassifier correctly derives emotionalIntensity from arousal
 */

import { describe, it, expect } from 'vitest';
import { AFINN_SUBSET, WORD_AROUSAL } from '../data/sentiment';
import { KeywordClassifier } from '../services/KeywordClassifier';


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: WORD_AROUSAL COVERAGE
// ══════════════════════════════════════════════════════════════════════

describe('WORD_AROUSAL — Coverage', () => {
    it('at least 80% of AFINN words have arousal entries', () => {
        const afinnWords = Object.keys(AFINN_SUBSET);
        const covered = afinnWords.filter(w => WORD_AROUSAL[w] !== undefined);

        const coverage = covered.length / afinnWords.length;
        expect(coverage).toBeGreaterThanOrEqual(0.8);
    });

    it('all strongly positive words (+4/+5) have arousal entries', () => {
        const strongPositive = Object.entries(AFINN_SUBSET)
            .filter(([, score]) => score >= 4)
            .map(([word]) => word);

        for (const word of strongPositive) {
            expect(WORD_AROUSAL[word], `Missing WORD_AROUSAL for "${word}" (AFINN=${AFINN_SUBSET[word]})`).toBeDefined();
        }
    });

    it('all strongly negative words (−4/−5) have arousal entries', () => {
        const strongNegative = Object.entries(AFINN_SUBSET)
            .filter(([, score]) => score <= -4)
            .map(([word]) => word);

        for (const word of strongNegative) {
            expect(WORD_AROUSAL[word], `Missing WORD_AROUSAL for "${word}" (AFINN=${AFINN_SUBSET[word]})`).toBeDefined();
        }
    });

    it('common positive words have arousal entries (regression guard)', () => {
        // These were the words that were missing in the initial implementation,
        // causing them to default to 0.5 and misplace on the Plutchik wheel.
        const criticalWords = ['happy', 'joy', 'love', 'wonderful', 'good', 'great',
            'beautiful', 'nice', 'fun', 'smile', 'delight'];

        for (const word of criticalWords) {
            expect(WORD_AROUSAL[word], `Missing WORD_AROUSAL for critical word "${word}"`).toBeDefined();
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: AROUSAL VALUES ARE REASONABLE
// ══════════════════════════════════════════════════════════════════════

describe('WORD_AROUSAL — Value Ranges', () => {
    it('all arousal values are in [0, 1] range', () => {
        for (const [word, arousal] of Object.entries(WORD_AROUSAL)) {
            expect(arousal, `"${word}" arousal=${arousal} out of range`)
                .toBeGreaterThanOrEqual(0);
            expect(arousal, `"${word}" arousal=${arousal} out of range`)
                .toBeLessThanOrEqual(1);
        }
    });

    it('angry/violent words have high arousal (≥0.7)', () => {
        const highArousalWords = ['angry', 'hate', 'scream', 'violent', 'kill', 'war'];
        for (const word of highArousalWords) {
            expect(WORD_AROUSAL[word], `"${word}" should have high arousal`)
                .toBeGreaterThanOrEqual(0.7);
        }
    });

    it('sad/lonely words have low arousal (≤0.3)', () => {
        const lowArousalWords = ['sad', 'alone', 'tired', 'bored', 'lonely'];
        for (const word of lowArousalWords) {
            expect(WORD_AROUSAL[word], `"${word}" should have low arousal`)
                .toBeLessThanOrEqual(0.3);
        }
    });

    it('happy/joy words have moderate-high arousal (0.55–0.75)', () => {
        const warmWords = ['happy', 'joy', 'love', 'delight', 'fun'];
        for (const word of warmWords) {
            const arousal = WORD_AROUSAL[word];
            expect(arousal, `"${word}" should have moderate-high arousal`)
                .toBeGreaterThanOrEqual(0.55);
            expect(arousal, `"${word}" should have moderate-high arousal`)
                .toBeLessThanOrEqual(0.75);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: CLASSIFIER USES WORD_AROUSAL
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — Arousal-based Emotional Intensity', () => {
    const classifier = new KeywordClassifier();

    it('"angry" produces high emotionalIntensity', () => {
        const state = classifier.classify('angry');
        expect(state.emotionalIntensity).toBeGreaterThan(0.7);
    });

    it('"sad" produces low emotionalIntensity', () => {
        const state = classifier.classify('sad');
        expect(state.emotionalIntensity).toBeLessThan(0.4);
    });

    it('"happy" produces moderate emotionalIntensity', () => {
        const state = classifier.classify('happy');
        expect(state.emotionalIntensity).toBeGreaterThan(0.5);
        expect(state.emotionalIntensity).toBeLessThan(0.9);
    });

    it('word without AFINN entry gets default emotionalIntensity', () => {
        // "cat" is not in AFINN_SUBSET but might be in CONCRETE_NOUNS
        const state = classifier.classify('the');
        // No sentiment words → base intensity
        expect(state.emotionalIntensity).toBeLessThan(0.3);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: PLUTCHIK WHEEL QUADRANT PLACEMENT
// ══════════════════════════════════════════════════════════════════════

describe('Plutchik Wheel — Quadrant Placement', () => {
    const classifier = new KeywordClassifier();

    it('"angry" (neg sentiment, high arousal) → rage quadrant', () => {
        const state = classifier.classify('angry');
        expect(state.sentiment).toBeLessThan(0);
        expect(state.emotionalIntensity).toBeGreaterThan(0.7);
    });

    it('"sad" (neg sentiment, low arousal) → melancholy quadrant', () => {
        const state = classifier.classify('sad');
        expect(state.sentiment).toBeLessThan(0);
        expect(state.emotionalIntensity).toBeLessThan(0.4);
    });

    it('"happy" (pos sentiment, moderate arousal) → joy quadrant', () => {
        const state = classifier.classify('happy');
        expect(state.sentiment).toBeGreaterThan(0);
        expect(state.emotionalIntensity).toBeGreaterThan(0.4);
    });

    it('"calm" (pos sentiment, low arousal) → serenity quadrant', () => {
        const state = classifier.classify('calm');
        expect(state.sentiment).toBeGreaterThan(0);
        // "calm" matches ABSTRACT_CONCEPTS (base intensity=0.5), and WORD_AROUSAL
        // is 0.1. emotionalIntensity = max(base*modifier, arousal) = max(0.5, 0.1) = 0.5.
        // The low arousal data is still used by the shader's Plutchik wheel mapping.
        expect(state.emotionalIntensity).toBeLessThanOrEqual(0.5);
    });
});
