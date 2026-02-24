/**
 * KeywordClassifier.test.ts — Unit tests for the dictionary-based
 * semantic classifier that maps speech text to visual states.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * KeywordClassifier is the bridge between spoken words and particle shapes.
 * It's pure synchronous logic with no side effects, making it ideal for
 * unit testing. We verify:
 *   1. Concrete nouns → correct morph targets + low abstraction
 *   2. Abstract concepts → correct morph targets + high abstraction
 *   3. Concrete nouns take priority over abstract concepts
 *   4. Sentiment is computed correctly from AFINN lexicon
 *   5. Action modifiers adjust emotional intensity
 *   6. Edge cases: punctuation, casing, empty input
 */

import { describe, it, expect } from 'vitest';
import { KeywordClassifier } from '../services/KeywordClassifier';
import type { SemanticState } from '../services/KeywordClassifier';

// ── SHARED INSTANCE ──────────────────────────────────────────────────
// KeywordClassifier is stateless, so a single instance is safe to reuse.
const classifier = new KeywordClassifier();

// ══════════════════════════════════════════════════════════════════════
// SUITE 1: CONCRETE NOUN CLASSIFICATION
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — Concrete Nouns', () => {
    it('maps "horse" to quadruped morph target', () => {
        const result = classifier.classify('horse');
        expect(result.morphTarget).toBe('quadruped');
        expect(result.abstractionLevel).toBeLessThanOrEqual(0.2);
        expect(result.confidence).toBe(0.9);
        expect(result.dominantWord).toBe('horse');
    });

    it('maps "ocean" to wave morph target', () => {
        const result = classifier.classify('ocean');
        expect(result.morphTarget).toBe('wave');
        expect(result.confidence).toBe(0.9);
    });

    it('maps "star" to starburst morph target', () => {
        const result = classifier.classify('the star is bright');
        expect(result.morphTarget).toBe('starburst');
        expect(result.dominantWord).toBe('star');
    });

    it('maps "building" to building morph target', () => {
        const result = classifier.classify('a tall building');
        expect(result.morphTarget).toBe('building');
    });

    it('maps "eagle" to bird morph target', () => {
        const result = classifier.classify('eagle');
        expect(result.morphTarget).toBe('bird');
        expect(result.confidence).toBe(0.9);
    });

    it('maps "tree" to tree morph target', () => {
        const result = classifier.classify('a big tree');
        expect(result.morphTarget).toBe('tree');
    });

    it('maps "mountain" to mountain morph target', () => {
        const result = classifier.classify('mountain');
        expect(result.morphTarget).toBe('mountain');
    });

    it('returns first concrete noun found when multiple present', () => {
        const result = classifier.classify('the horse and the bird');
        // "horse" comes first, both are concrete (priority 2) so first wins
        expect(result.morphTarget).toBe('quadruped');
        expect(result.dominantWord).toBe('horse');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: ABSTRACT CONCEPT CLASSIFICATION
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — Abstract Concepts', () => {
    it('maps "love" to dual-attract morph target', () => {
        const result = classifier.classify('love');
        expect(result.morphTarget).toBe('dual-attract');
        expect(result.abstractionLevel).toBeGreaterThanOrEqual(0.5);
        expect(result.confidence).toBe(0.7);
    });

    it('maps "peace" to sphere morph target', () => {
        const result = classifier.classify('peace');
        expect(result.morphTarget).toBe('sphere');
    });

    it('maps "joy" to starburst morph target', () => {
        const result = classifier.classify('joy');
        expect(result.morphTarget).toBe('starburst');
        expect(result.confidence).toBe(0.7);
    });

    it('maps "beauty" to ring morph target', () => {
        const result = classifier.classify('beauty');
        expect(result.morphTarget).toBe('ring');
    });

    it('maps "strength" to mountain morph target', () => {
        const result = classifier.classify('strength');
        expect(result.morphTarget).toBe('mountain');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: PRIORITY — CONCRETE > ABSTRACT
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — Priority', () => {
    it('concrete noun wins over abstract concept in same sentence', () => {
        // "horse" is concrete (priority 2), "love" is abstract (priority 1)
        const result = classifier.classify('I love my horse');
        expect(result.morphTarget).toBe('quadruped');
        expect(result.dominantWord).toBe('horse');
        expect(result.confidence).toBe(0.9);
    });

    it('concrete noun wins even when abstract appears first', () => {
        const result = classifier.classify('peace on the mountain');
        // "mountain" is concrete, "peace" is abstract
        expect(result.morphTarget).toBe('mountain');
        expect(result.confidence).toBe(0.9);
    });

    it('abstract concept used when no concrete noun present', () => {
        const result = classifier.classify('there is so much love');
        expect(result.morphTarget).toBe('dual-attract');
        expect(result.confidence).toBe(0.7);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: SENTIMENT
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — Sentiment', () => {
    it('positive words produce positive sentiment', () => {
        const result = classifier.classify('happy beautiful day');
        expect(result.sentiment).toBeGreaterThan(0);
    });

    it('negative words produce negative sentiment', () => {
        const result = classifier.classify('terrible horrible thing');
        expect(result.sentiment).toBeLessThan(0);
    });

    it('no sentiment words produce neutral sentiment (0)', () => {
        const result = classifier.classify('the horse is there');
        expect(result.sentiment).toBe(0);
    });

    it('mixed sentiment averages toward zero', () => {
        // "happy" (+3) and "sad" (-2) → average ~0.1
        const result = classifier.classify('happy and sad');
        expect(result.sentiment).toBeGreaterThan(-0.5);
        expect(result.sentiment).toBeLessThan(0.5);
    });

    it('sentiment is clamped to [-1, +1]', () => {
        // Even with extreme words, sentiment should not exceed bounds
        const result = classifier.classify('superb outstanding breathtaking');
        expect(result.sentiment).toBeLessThanOrEqual(1);
        expect(result.sentiment).toBeGreaterThanOrEqual(-1);
    });

    it('sentiment is normalized by AFINN_MAX_SCORE', () => {
        // "superb" has AFINN score 5, so sentiment = 5/5 = 1.0
        const result = classifier.classify('superb');
        expect(result.sentiment).toBe(1.0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: ACTION MODIFIERS
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — Action Modifiers', () => {
    it('high-energy modifier boosts emotional intensity', () => {
        const base = classifier.classify('horse');
        const boosted = classifier.classify('galloping horse');
        expect(boosted.emotionalIntensity).toBeGreaterThan(base.emotionalIntensity);
    });

    it('low-energy modifier reduces emotional intensity', () => {
        const base = classifier.classify('horse');
        const calmed = classifier.classify('sleeping horse');
        expect(calmed.emotionalIntensity).toBeLessThan(base.emotionalIntensity);
    });

    it('most extreme modifier wins over milder ones', () => {
        // "exploding" (1.8) is more extreme than "running" (1.3)
        const result = classifier.classify('running exploding horse');
        // 0.5 base * 1.8 = 0.9 — "exploding" should win
        expect(result.emotionalIntensity).toBeCloseTo(0.5 * 1.8, 1);
    });

    it('emotional intensity is clamped to [0, 1]', () => {
        const result = classifier.classify('exploding screaming violent horse');
        expect(result.emotionalIntensity).toBeGreaterThanOrEqual(0);
        expect(result.emotionalIntensity).toBeLessThanOrEqual(1);
    });

    it('modifier without keyword uses base intensity of 0.1', () => {
        const result = classifier.classify('galloping fast today');
        // No keyword → base 0.1, × 1.5 = 0.15
        expect(result.emotionalIntensity).toBeCloseTo(0.1 * 1.5, 2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: EDGE CASES
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — Edge Cases', () => {
    it('handles uppercase input (case insensitive)', () => {
        const result = classifier.classify('HORSE');
        expect(result.morphTarget).toBe('quadruped');
    });

    it('handles mixed case', () => {
        const result = classifier.classify('The Beautiful Ocean');
        expect(result.morphTarget).toBe('wave');
    });

    it('strips punctuation before matching', () => {
        const result = classifier.classify('horse!');
        expect(result.morphTarget).toBe('quadruped');
    });

    it('strips commas and periods', () => {
        const result = classifier.classify('I see a horse, and a bird.');
        expect(result.morphTarget).toBe('quadruped');
    });

    it('returns default state for empty string', () => {
        const result = classifier.classify('');
        expect(result.morphTarget).toBe('');
        expect(result.confidence).toBe(0.1);
        expect(result.abstractionLevel).toBe(0.9);
    });

    it('returns default state for whitespace-only input', () => {
        const result = classifier.classify('   ');
        expect(result.morphTarget).toBe('');
        expect(result.confidence).toBe(0.1);
    });

    it('returns default state for unrecognized words (extractProbableNoun disabled)', () => {
        // extractProbableNoun fallback is disabled — unknown words return
        // default low-confidence state instead of routing to server.
        const result = classifier.classify('xylophone quantum paradigm');
        expect(result.morphTarget).toBe('');
        expect(result.confidence).toBe(0.1);
        expect(result.dominantWord).toBe('');
    });

    it('returns default state for pure stopwords', () => {
        const result = classifier.classify('the and but');
        expect(result.morphTarget).toBe('');
        expect(result.confidence).toBe(0.1);
        expect(result.dominantWord).toBe('');
    });

    it('does NOT extract AFINN sentiment words as probable nouns', () => {
        // 'happy' is in the AFINN lexicon — it has emotional meaning
        // but makes a terrible shape prompt for the 3D backend
        const result = classifier.classify('happy');
        expect(result.morphTarget).toBe('');
        expect(result.confidence).toBe(0.1);
    });

    it('skips discourse words (hello, okay, actually)', () => {
        const result = classifier.classify('hello okay actually');
        expect(result.morphTarget).toBe('');
        expect(result.confidence).toBe(0.1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 7: INTERFACE CONFORMANCE
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — SemanticBackend Interface', () => {
    it('has name property set to "KeywordClassifier"', () => {
        expect(classifier.name).toBe('KeywordClassifier');
    });

    it('classify() returns all required SemanticState fields', () => {
        const result: SemanticState = classifier.classify('horse');
        expect(result).toHaveProperty('morphTarget');
        expect(result).toHaveProperty('abstractionLevel');
        expect(result).toHaveProperty('sentiment');
        expect(result).toHaveProperty('emotionalIntensity');
        expect(result).toHaveProperty('dominantWord');
        expect(result).toHaveProperty('confidence');
    });

    it('all numeric fields are finite numbers', () => {
        const result = classifier.classify('galloping horse in the beautiful storm');
        expect(Number.isFinite(result.abstractionLevel)).toBe(true);
        expect(Number.isFinite(result.sentiment)).toBe(true);
        expect(Number.isFinite(result.emotionalIntensity)).toBe(true);
        expect(Number.isFinite(result.confidence)).toBe(true);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 8: extractProbableNoun (unit tests)
// ══════════════════════════════════════════════════════════════════════

describe('KeywordClassifier — extractProbableNoun', () => {
    it('picks the longest word as the probable noun', () => {
        // 'politician' (10) > 'cream' (5) > 'eats' (stopword)
        expect(KeywordClassifier.extractProbableNoun(
            ['politician', 'eats', 'cream']
        )).toBe('politician');
    });

    it('returns null for empty word list', () => {
        expect(KeywordClassifier.extractProbableNoun([])).toBeNull();
    });

    it('returns null when all words are ≤ 3 chars', () => {
        expect(KeywordClassifier.extractProbableNoun(
            ['the', 'and', 'but', 'or', 'is', 'it']
        )).toBeNull();
    });

    it('returns null when all words are stopwords', () => {
        expect(KeywordClassifier.extractProbableNoun(
            ['because', 'between', 'through', 'should']
        )).toBeNull();
    });

    it('skips words in CONCRETE_NOUNS dictionary', () => {
        // 'horse' is 5 chars but in the dictionary
        expect(KeywordClassifier.extractProbableNoun(
            ['horse']
        )).toBeNull();
    });

    it('skips words in ABSTRACT_CONCEPTS dictionary', () => {
        expect(KeywordClassifier.extractProbableNoun(
            ['freedom']
        )).toBeNull();
    });

    it('skips ACTION_MODIFIER words', () => {
        expect(KeywordClassifier.extractProbableNoun(
            ['galloping']
        )).toBeNull();
    });

    it('skips AFINN sentiment words', () => {
        // 'happy', 'terrible', 'beautiful' have emotional meaning
        // but make poor 3D shape prompts
        expect(KeywordClassifier.extractProbableNoun(
            ['happy', 'terrible', 'beautiful']
        )).toBeNull();
    });

    it('extracts noun even when mixed with stopwords and sentiment', () => {
        // 'spaceship' is the only true content noun
        expect(KeywordClassifier.extractProbableNoun(
            ['the', 'happy', 'spaceship', 'goes', 'through']
        )).toBe('spaceship');
    });

    it('picks longest when multiple valid nouns present', () => {
        // 'helicopter' (10) > 'tank' (4)
        expect(KeywordClassifier.extractProbableNoun(
            ['tank', 'helicopter']
        )).toBe('helicopter');
    });
});
