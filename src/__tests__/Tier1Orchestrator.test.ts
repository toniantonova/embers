/**
 * Tier1Orchestrator.test.ts — Tests for Tier 1 verb→template resolution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tier1Orchestrator } from '../lookup/tier1-orchestrator';
import { TemplateLibrary } from '../templates/template-library';
import type { TemplateJSON } from '../templates/template-types';
import type { VerbHashData } from '../lookup/verb-hash-table';


// ── MOCK DATA ────────────────────────────────────────────────────────

const MOCK_TEMPLATES: TemplateJSON[] = [
    {
        template_id: 'locomotion_quadruped',
        anchor_verbs: ['run', 'gallop', 'trot'],
        verbnet_class: 'run-51.3.2',
        thematic_roles: { agent: 'subject' },
        description: 'Four-legged running',
        whole_body: { primitive: 'oscillate_translate', params: { amplitude: 0.03 } },
        part_rules: [],
        defaults: {
            speed: 1.0,
            adverb_map: {
                slowly: { speed: 0.3 },
                quickly: { speed: 2.0 },
                furiously: { speed: 2.5, amplitude_scale: 1.8 },
                gracefully: { speed: 0.7, amplitude_scale: 0.6 },
                gently: { speed: 0.5, amplitude_scale: 0.5 },
                wildly: { speed: 2.2, amplitude_scale: 2.0 },
            },
        },
    },
    {
        template_id: 'action_jump',
        anchor_verbs: ['jump', 'leap'],
        verbnet_class: 'run-51.3.2',
        thematic_roles: { agent: 'subject' },
        description: 'Vertical jump',
        whole_body: { primitive: 'arc_translate', params: { apex_height: 1.5 } },
        part_rules: [],
        defaults: {
            speed: 1.0,
            adverb_map: {
                slowly: { speed: 0.4 },
                quickly: { speed: 2.0 },
            },
        },
    },
];

const MOCK_HASH_TABLE: VerbHashData = {
    run: 'locomotion_quadruped',
    runs: 'locomotion_quadruped',
    running: 'locomotion_quadruped',
    ran: 'locomotion_quadruped',
    gallop: 'locomotion_quadruped',
    trot: 'locomotion_quadruped',
    jump: 'action_jump',
    jumps: 'action_jump',
    jumping: 'action_jump',
    leap: 'action_jump',
};


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: BASIC RESOLUTION
// ══════════════════════════════════════════════════════════════════════

describe('Tier1Orchestrator — Basic Resolution', () => {
    let orchestrator: Tier1Orchestrator;
    let library: TemplateLibrary;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
        library = new TemplateLibrary();
        library.loadTemplates(MOCK_TEMPLATES);
        orchestrator = new Tier1Orchestrator(MOCK_HASH_TABLE, library);
    });

    it('resolves "run" to locomotion_quadruped', async () => {
        const result = await orchestrator.resolve('run');
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe('locomotion_quadruped');
        expect(result!.source).toBe('hash');
    });

    it('resolves "jump" to action_jump', async () => {
        const result = await orchestrator.resolve('jump');
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe('action_jump');
    });

    it('returns null for unknown verb (no embedding fallback without real anchors)', async () => {
        const result = await orchestrator.resolve('xyzzy');
        expect(result).toBeNull();
    });

    it('returns null for empty input', async () => {
        const result = await orchestrator.resolve('');
        expect(result).toBeNull();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: ADVERB RESOLUTION
// ══════════════════════════════════════════════════════════════════════

describe('Tier1Orchestrator — Adverb Resolution', () => {
    let orchestrator: Tier1Orchestrator;
    let library: TemplateLibrary;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
        library = new TemplateLibrary();
        library.loadTemplates(MOCK_TEMPLATES);
        orchestrator = new Tier1Orchestrator(MOCK_HASH_TABLE, library);
    });

    it('resolves "run quickly" with speed override', async () => {
        const result = await orchestrator.resolve('run quickly');
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe('locomotion_quadruped');
        expect(result!.overrides.speed).toBe(2.0);
    });

    it('resolves "run slowly" with speed override', async () => {
        const result = await orchestrator.resolve('run slowly');
        expect(result).not.toBeNull();
        expect(result!.overrides.speed).toBe(0.3);
    });

    it('includes parsed sentence data', async () => {
        const result = await orchestrator.resolve('run quickly');
        expect(result).not.toBeNull();
        expect(result!.parsed.rawText).toBe('run quickly');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: SYNC RESOLUTION
// ══════════════════════════════════════════════════════════════════════

describe('Tier1Orchestrator — Sync Resolution', () => {
    let orchestrator: Tier1Orchestrator;
    let library: TemplateLibrary;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
        library = new TemplateLibrary();
        library.loadTemplates(MOCK_TEMPLATES);
        orchestrator = new Tier1Orchestrator(MOCK_HASH_TABLE, library);
    });

    it('resolves "run" synchronously', () => {
        const result = orchestrator.resolveSync('run');
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe('locomotion_quadruped');
        expect(result!.source).toBe('hash');
    });

    it('returns null for unknown verb synchronously', () => {
        const result = orchestrator.resolveSync('xyzzy');
        expect(result).toBeNull();
    });

    it('reports latency', () => {
        const result = orchestrator.resolveSync('run');
        expect(result).not.toBeNull();
        expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result!.latencyMs).toBeLessThan(100);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: METADATA & SAFETY
// ══════════════════════════════════════════════════════════════════════

describe('Tier1Orchestrator — Metadata', () => {
    let orchestrator: Tier1Orchestrator;
    let library: TemplateLibrary;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
        library = new TemplateLibrary();
        library.loadTemplates(MOCK_TEMPLATES);
        orchestrator = new Tier1Orchestrator(MOCK_HASH_TABLE, library);
    });

    it('hashTableSize matches input data', () => {
        expect(orchestrator.hashTableSize).toBe(Object.keys(MOCK_HASH_TABLE).length);
    });

    it('isEmbeddingReady is false before init', () => {
        expect(orchestrator.isEmbeddingReady).toBe(false);
    });

    it('embedding fallback returns null without real anchors (no garbage matches)', async () => {
        // No anchorEmbeddings passed to constructor → fallback should return null
        const result = await orchestrator.resolve('somethingUnknown');
        expect(result).toBeNull();
    });
});
