/**
 * KeywordShadowing.test.ts — Verifies no ACTION_MODIFIERS are shadowed by
 * CONCRETE_NOUNS or ABSTRACT_CONCEPTS.
 *
 * WHY THIS MATTERS:
 * ─────────────────
 * The KeywordClassifier uses an if/else-if chain:
 *   1. Check CONCRETE_NOUNS (priority 2)
 *   2. Check ABSTRACT_CONCEPTS (priority 1)
 *   3. Check ACTION_MODIFIERS (intensity adjustment)
 *
 * If a word exists in both ABSTRACT_CONCEPTS and ACTION_MODIFIERS, the
 * modifier entry is dead code — it can never be reached. This test ensures
 * no such shadowing exists (it was a real bug with "quiet" and "still").
 */

import { describe, it, expect } from 'vitest';
import { CONCRETE_NOUNS, ABSTRACT_CONCEPTS, ACTION_MODIFIERS } from '../data/keywords';

describe('Keyword Dictionaries — No Shadowing', () => {
    it('no ACTION_MODIFIERS words exist in CONCRETE_NOUNS', () => {
        const shadowed: string[] = [];
        for (const word of Object.keys(ACTION_MODIFIERS)) {
            if (CONCRETE_NOUNS[word]) {
                shadowed.push(word);
            }
        }
        expect(shadowed, `Shadowed modifiers: ${shadowed.join(', ')}`).toHaveLength(0);
    });

    it('no ACTION_MODIFIERS words exist in ABSTRACT_CONCEPTS', () => {
        const shadowed: string[] = [];
        for (const word of Object.keys(ACTION_MODIFIERS)) {
            if (ABSTRACT_CONCEPTS[word]) {
                shadowed.push(word);
            }
        }
        expect(shadowed, `Shadowed modifiers: ${shadowed.join(', ')}`).toHaveLength(0);
    });

    it('no ABSTRACT_CONCEPTS words exist in CONCRETE_NOUNS', () => {
        const shadowed: string[] = [];
        for (const word of Object.keys(ABSTRACT_CONCEPTS)) {
            if (CONCRETE_NOUNS[word]) {
                shadowed.push(word);
            }
        }
        expect(shadowed, `Shadowed concepts: ${shadowed.join(', ')}`).toHaveLength(0);
    });
});
