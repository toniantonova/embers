/**
 * VerbHashTable.test.ts — Tests for O(1) verb → templateId lookup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerbHashTable } from '../lookup/verb-hash-table';


// ── MOCK DATA ────────────────────────────────────────────────────────

const MOCK_HASH_DATA = {
    'run': 'locomotion_quadruped',
    'runs': 'locomotion_quadruped',
    'running': 'locomotion_quadruped',
    'ran': 'locomotion_quadruped',
    'gallop': 'locomotion_quadruped',
    'gallops': 'locomotion_quadruped',
    'galloping': 'locomotion_quadruped',
    'jump': 'action_jump',
    'jumps': 'action_jump',
    'jumping': 'action_jump',
    'leap': 'action_jump',
    'leaps': 'action_jump',
    'eat': 'action_eat',
    'eats': 'action_eat',
    'eating': 'action_eat',
    'fly': 'locomotion_fly',
    'flies': 'locomotion_fly',
    'flying': 'locomotion_fly',
};


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: BASIC LOOKUP
// ══════════════════════════════════════════════════════════════════════

describe('VerbHashTable — Basic Lookup', () => {
    let table: VerbHashTable;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        table = new VerbHashTable(MOCK_HASH_DATA);
    });

    it('looks up base form verb', () => {
        expect(table.lookup('run')).toBe('locomotion_quadruped');
    });

    it('looks up conjugated form', () => {
        expect(table.lookup('runs')).toBe('locomotion_quadruped');
        expect(table.lookup('running')).toBe('locomotion_quadruped');
        expect(table.lookup('ran')).toBe('locomotion_quadruped');
    });

    it('returns null for unknown verb', () => {
        expect(table.lookup('xyzzy')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(table.lookup('')).toBeNull();
    });

    it('is case insensitive', () => {
        expect(table.lookup('RUN')).toBe('locomotion_quadruped');
        expect(table.lookup('Jump')).toBe('action_jump');
    });

    it('trims whitespace', () => {
        expect(table.lookup('  run  ')).toBe('locomotion_quadruped');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: HAS
// ══════════════════════════════════════════════════════════════════════

describe('VerbHashTable — has', () => {
    let table: VerbHashTable;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        table = new VerbHashTable(MOCK_HASH_DATA);
    });

    it('returns true for known verb', () => {
        expect(table.has('run')).toBe(true);
    });

    it('returns false for unknown verb', () => {
        expect(table.has('xyzzy')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(table.has('')).toBe(false);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: SIZE & TEMPLATE VERBS
// ══════════════════════════════════════════════════════════════════════

describe('VerbHashTable — Size and Reverse Lookup', () => {
    let table: VerbHashTable;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        table = new VerbHashTable(MOCK_HASH_DATA);
    });

    it('reports correct size', () => {
        expect(table.size).toBe(Object.keys(MOCK_HASH_DATA).length);
    });

    it('getVerbsForTemplate returns matching verbs', () => {
        const verbs = table.getVerbsForTemplate('action_jump');
        expect(verbs).toContain('jump');
        expect(verbs).toContain('jumps');
        expect(verbs).toContain('jumping');
        expect(verbs).toContain('leap');
        expect(verbs).toContain('leaps');
        expect(verbs.length).toBe(5);
    });

    it('getVerbsForTemplate returns empty for unknown template', () => {
        expect(table.getVerbsForTemplate('unknown_template')).toHaveLength(0);
    });
});
