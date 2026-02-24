/**
 * AdverbResolver.test.ts — Tests for adverb → speed/amplitude resolution.
 */

import { describe, it, expect } from 'vitest';
import { resolveAdverb, isKnownAdverb } from '../lookup/adverb-resolver';
import type { TemplateJSON } from '../templates/template-types';


// ── MOCK TEMPLATE ────────────────────────────────────────────────────

const MOCK_TEMPLATE: TemplateJSON = {
    template_id: 'locomotion_quadruped',
    anchor_verbs: ['run', 'gallop'],
    verbnet_class: 'run-51.3.2',
    thematic_roles: { agent: 'subject' },
    description: 'Test template',
    whole_body: { primitive: 'oscillate_translate', params: { amplitude: 0.03 } },
    part_rules: [],
    defaults: {
        speed: 1.0,
        adverb_map: {
            slowly: { speed: 0.3, amplitude_scale: 0.7 },
            quickly: { speed: 2.0 },
            furiously: { speed: 2.5, amplitude_scale: 1.8 },
        },
    },
};


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: TEMPLATE-SPECIFIC RESOLUTION
// ══════════════════════════════════════════════════════════════════════

describe('AdverbResolver — Template-Specific', () => {
    it('resolves "slowly" from template adverb_map', () => {
        const overrides = resolveAdverb('slowly', MOCK_TEMPLATE);
        expect(overrides.speed).toBe(0.3);
        expect(overrides.amplitudeScale).toBe(0.7);
    });

    it('resolves "quickly" with speed only', () => {
        const overrides = resolveAdverb('quickly', MOCK_TEMPLATE);
        expect(overrides.speed).toBe(2.0);
        expect(overrides.amplitudeScale).toBeUndefined();
    });

    it('resolves "furiously" with both speed and amplitude', () => {
        const overrides = resolveAdverb('furiously', MOCK_TEMPLATE);
        expect(overrides.speed).toBe(2.5);
        expect(overrides.amplitudeScale).toBe(1.8);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: GENERIC FALLBACK
// ══════════════════════════════════════════════════════════════════════

describe('AdverbResolver — Generic Fallback', () => {
    it('falls back to generic map for unknown adverb', () => {
        const overrides = resolveAdverb('gracefully', MOCK_TEMPLATE);
        expect(overrides.speed).toBe(0.7);
    });

    it('returns empty overrides for completely unknown adverb', () => {
        const overrides = resolveAdverb('xyzzy', MOCK_TEMPLATE);
        expect(overrides.speed).toBeUndefined();
        expect(overrides.amplitudeScale).toBeUndefined();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: EDGE CASES
// ══════════════════════════════════════════════════════════════════════

describe('AdverbResolver — Edge Cases', () => {
    it('returns empty overrides for null adverb', () => {
        const overrides = resolveAdverb(null, MOCK_TEMPLATE);
        expect(Object.keys(overrides)).toHaveLength(0);
    });

    it('returns empty overrides for empty string', () => {
        const overrides = resolveAdverb('', MOCK_TEMPLATE);
        expect(Object.keys(overrides)).toHaveLength(0);
    });

    it('normalizes case', () => {
        const overrides = resolveAdverb('SLOWLY', MOCK_TEMPLATE);
        expect(overrides.speed).toBe(0.3);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: isKnownAdverb
// ══════════════════════════════════════════════════════════════════════

describe('isKnownAdverb', () => {
    it('returns true for known adverb', () => {
        expect(isKnownAdverb('quickly')).toBe(true);
        expect(isKnownAdverb('slowly')).toBe(true);
        expect(isKnownAdverb('gracefully')).toBe(true);
    });

    it('returns false for unknown adverb', () => {
        expect(isKnownAdverb('xyzzy')).toBe(false);
    });
});
