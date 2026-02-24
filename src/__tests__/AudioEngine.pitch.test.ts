/**
 * AudioEngine.pitch.test.ts — Tests for the Pitchy F0 pitch extraction
 * added in A1 Audio Pipeline Upgrades.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * The three new pitch fields on AudioFeatures (pitch, pitchDeviation,
 * pitchConfidence) and the processPitch() private method. We verify:
 *   1. New fields default to 0 before any audio processing
 *   2. Existing features still work when pitch hardware isn't set up
 *   3. The processPitch() method is a no-op when pitchAnalyser is null
 *      (which is the case in unit tests without a real AudioContext)
 *
 * MOCK STRATEGY:
 * ──────────────
 * Since Pitchy requires a real AnalyserNode + AudioContext, and those
 * aren't available in jsdom, we test the integration indirectly:
 *   - Verify pitch fields exist and default to 0
 *   - Verify processFeatures() doesn't crash without pitch hardware
 *   - Verify existing features are unaffected by the pitch additions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../services/AudioEngine';

let engine: AudioEngine;

beforeEach(() => {
    engine = new AudioEngine();
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: DEFAULT PITCH STATE
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Pitch Defaults', () => {
    it('pitch defaults to 0 before start()', () => {
        const f = engine.getFeatures();
        expect(f.pitch).toBe(0);
    });

    it('pitchDeviation defaults to 0 before start()', () => {
        const f = engine.getFeatures();
        expect(f.pitchDeviation).toBe(0);
    });

    it('pitchConfidence defaults to 0 before start()', () => {
        const f = engine.getFeatures();
        expect(f.pitchConfidence).toBe(0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: BACKWARDS COMPATIBILITY
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Pitch Backwards Compatibility', () => {
    it('processFeatures() does not crash without pitch hardware', () => {
        // In unit tests, pitchAnalyser/pitchBuffer/pitchDetector are all null.
        // processFeatures() should still work — processPitch() should be a no-op.
        expect(() => {
            (engine as any).processFeatures({ rms: 0.5, spectralCentroid: 40 });
        }).not.toThrow();
    });

    it('existing features still produce correct values with pitch fields present', () => {
        // Warm up with several frames
        for (let i = 0; i < 20; i++) {
            (engine as any).processFeatures({ rms: 0.5, spectralCentroid: 40 });
        }

        const f = engine.getFeatures();
        // Existing features should still work
        expect(f.energy).toBeGreaterThan(0);
        expect(f.tension).toBeGreaterThan(0);

        // Pitch should still be 0 since no pitch hardware is available
        expect(f.pitch).toBe(0);
        expect(f.pitchDeviation).toBe(0);
        expect(f.pitchConfidence).toBe(0);
    });

    it('AudioFeatures interface has all 10 fields', () => {
        const f = engine.getFeatures();
        const keys = Object.keys(f);

        // Original 7 + 3 new pitch fields
        expect(keys).toContain('energy');
        expect(keys).toContain('tension');
        expect(keys).toContain('urgency');
        expect(keys).toContain('breathiness');
        expect(keys).toContain('flatness');
        expect(keys).toContain('textureComplexity');
        expect(keys).toContain('rolloff');
        expect(keys).toContain('pitch');
        expect(keys).toContain('pitchDeviation');
        expect(keys).toContain('pitchConfidence');
        expect(keys.length).toBe(10);
    });
});
