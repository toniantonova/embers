/**
 * keywords.test.ts — Structural integrity tests for word dictionaries
 * and sentiment lexicon.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * The data files are the foundation of the KeywordClassifier. If a word
 * maps to a non-existent morph target or has an out-of-range value, the
 * system fails silently. These tests are guardrails that catch:
 *   1. Typos in morph target names (e.g., "quadrupped")
 *   2. Abstraction values outside [0, 1]
 *   3. Invalid AFINN scores
 *   4. Accidental duplicate keys across dictionaries
 */

import { describe, it, expect } from 'vitest';
import { CONCRETE_NOUNS, ABSTRACT_CONCEPTS, ACTION_MODIFIERS } from '../data/keywords';
import { AFINN_SUBSET, AFINN_MAX_SCORE } from '../data/sentiment';
import { MORPH_TARGET_NAMES } from '../engine/MorphTargets';

// Convert to a Set for O(1) lookup
const validTargets = new Set(MORPH_TARGET_NAMES);


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: CONCRETE NOUNS
// ══════════════════════════════════════════════════════════════════════

describe('Data — CONCRETE_NOUNS', () => {
    it('has at least 50 entries', () => {
        expect(Object.keys(CONCRETE_NOUNS).length).toBeGreaterThanOrEqual(50);
    });

    it('all entries map to valid morph target names', () => {
        for (const [, mapping] of Object.entries(CONCRETE_NOUNS)) {
            expect(validTargets.has(mapping.target as typeof MORPH_TARGET_NAMES[number])).toBe(true);
        }
    });

    it('all abstraction values are in [0, 1]', () => {
        for (const [, mapping] of Object.entries(CONCRETE_NOUNS)) {
            expect(mapping.abstraction).toBeGreaterThanOrEqual(0);
            expect(mapping.abstraction).toBeLessThanOrEqual(1);
        }
    });

    it('all keys are lowercase', () => {
        for (const key of Object.keys(CONCRETE_NOUNS)) {
            expect(key).toBe(key.toLowerCase());
        }
    });

    it('concrete nouns have low abstraction (≤ 0.35)', () => {
        for (const [, mapping] of Object.entries(CONCRETE_NOUNS)) {
            expect(mapping.abstraction).toBeLessThanOrEqual(0.35);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: ABSTRACT CONCEPTS
// ══════════════════════════════════════════════════════════════════════

describe('Data — ABSTRACT_CONCEPTS', () => {
    it('has at least 30 entries', () => {
        expect(Object.keys(ABSTRACT_CONCEPTS).length).toBeGreaterThanOrEqual(30);
    });

    it('all entries map to valid morph target names', () => {
        for (const [, mapping] of Object.entries(ABSTRACT_CONCEPTS)) {
            expect(validTargets.has(mapping.target as typeof MORPH_TARGET_NAMES[number])).toBe(true);
        }
    });

    it('all abstraction values are in [0, 1]', () => {
        for (const [, mapping] of Object.entries(ABSTRACT_CONCEPTS)) {
            expect(mapping.abstraction).toBeGreaterThanOrEqual(0);
            expect(mapping.abstraction).toBeLessThanOrEqual(1);
        }
    });

    it('abstract concepts have high abstraction (≥ 0.5)', () => {
        for (const [, mapping] of Object.entries(ABSTRACT_CONCEPTS)) {
            expect(mapping.abstraction).toBeGreaterThanOrEqual(0.5);
        }
    });

    it('all keys are lowercase', () => {
        for (const key of Object.keys(ABSTRACT_CONCEPTS)) {
            expect(key).toBe(key.toLowerCase());
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: NO DUPLICATE KEYS
// ══════════════════════════════════════════════════════════════════════

describe('Data — No Duplicates', () => {
    it('no word appears in both CONCRETE_NOUNS and ABSTRACT_CONCEPTS', () => {
        const concreteKeys = new Set(Object.keys(CONCRETE_NOUNS));
        const abstractKeys = Object.keys(ABSTRACT_CONCEPTS);

        const duplicates = abstractKeys.filter(k => concreteKeys.has(k));
        expect(duplicates).toEqual([]);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: ACTION MODIFIERS
// ══════════════════════════════════════════════════════════════════════

describe('Data — ACTION_MODIFIERS', () => {
    it('has at least 20 entries', () => {
        expect(Object.keys(ACTION_MODIFIERS).length).toBeGreaterThanOrEqual(20);
    });

    it('all values are positive numbers', () => {
        for (const [, value] of Object.entries(ACTION_MODIFIERS)) {
            expect(value).toBeGreaterThan(0);
            expect(typeof value).toBe('number');
        }
    });

    it('all keys are lowercase', () => {
        for (const key of Object.keys(ACTION_MODIFIERS)) {
            expect(key).toBe(key.toLowerCase());
        }
    });

    it('has both high-energy (>1) and low-energy (<1) modifiers', () => {
        const values = Object.values(ACTION_MODIFIERS);
        expect(values.some(v => v > 1)).toBe(true);
        expect(values.some(v => v < 1)).toBe(true);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: AFINN SENTIMENT LEXICON
// ══════════════════════════════════════════════════════════════════════

describe('Data — AFINN_SUBSET', () => {
    it('has at least 100 entries', () => {
        expect(Object.keys(AFINN_SUBSET).length).toBeGreaterThanOrEqual(100);
    });

    it('all scores are integers in [-5, +5]', () => {
        for (const [, score] of Object.entries(AFINN_SUBSET)) {
            expect(Number.isInteger(score)).toBe(true);
            expect(score).toBeGreaterThanOrEqual(-5);
            expect(score).toBeLessThanOrEqual(5);
        }
    });

    it('no scores are zero (zero-scoring words are excluded by design)', () => {
        for (const [, score] of Object.entries(AFINN_SUBSET)) {
            expect(score).not.toBe(0);
        }
    });

    it('AFINN_MAX_SCORE is 5', () => {
        expect(AFINN_MAX_SCORE).toBe(5);
    });

    it('all keys are lowercase', () => {
        for (const key of Object.keys(AFINN_SUBSET)) {
            expect(key).toBe(key.toLowerCase());
        }
    });

    it('has both positive and negative words', () => {
        const scores = Object.values(AFINN_SUBSET);
        expect(scores.some(s => s > 0)).toBe(true);
        expect(scores.some(s => s < 0)).toBe(true);
    });
});
