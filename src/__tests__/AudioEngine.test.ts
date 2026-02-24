/**
 * AudioEngine.test.ts — Unit tests for audio feature extraction and
 * EMA smoothing logic.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * AudioEngine takes raw Meyda features and normalizes, smooths, and
 * calibrates them into the 0–1 AudioFeatures interface. We test the
 * pure computation (processFeatures and smooth) without needing a real
 * microphone or Web Audio context.
 *
 * MOCK STRATEGY:
 * ──────────────
 * - Meyda and getUserMedia are NOT used — we call processFeatures()
 *   directly with synthetic raw feature objects.
 * - We access private methods via (engine as any) — acceptable in tests
 *   since we're verifying internal correctness, not API surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../services/AudioEngine';

let engine: AudioEngine;

beforeEach(() => {
    engine = new AudioEngine();
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: EMA SMOOTH FUNCTION
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — smooth()', () => {
    it('alpha=0 returns 100% new value', () => {
        const result = (engine as any).smooth(0.8, 0.2, 0);
        expect(result).toBeCloseTo(0.2, 5);
    });

    it('alpha=1 returns 100% old value', () => {
        const result = (engine as any).smooth(0.8, 0.2, 1);
        expect(result).toBeCloseTo(0.8, 5);
    });

    it('alpha=0.5 returns average of old and new', () => {
        const result = (engine as any).smooth(0.8, 0.2, 0.5);
        expect(result).toBeCloseTo(0.5, 5);
    });

    it('smoothing formula is: alpha * prev + (1 - alpha) * curr', () => {
        const prev = 0.6;
        const curr = 0.9;
        const alpha = 0.7;
        const expected = alpha * prev + (1 - alpha) * curr;
        const result = (engine as any).smooth(prev, curr, alpha);
        expect(result).toBeCloseTo(expected, 10);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: DEFAULT FEATURES
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Default State', () => {
    it('getFeatures() returns all zeros before start()', () => {
        const f = engine.getFeatures();
        expect(f.energy).toBe(0);
        expect(f.tension).toBe(0);
        expect(f.urgency).toBe(0);
        expect(f.breathiness).toBe(0);
        expect(f.flatness).toBe(0);
        expect(f.textureComplexity).toBe(0);
        expect(f.rolloff).toBe(0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: processFeatures — ENERGY (RMS)
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Energy (RMS)', () => {
    it('non-zero RMS produces non-zero energy', () => {
        (engine as any).processFeatures({ rms: 0.5 });
        expect(engine.getFeatures().energy).toBeGreaterThan(0);
    });

    it('energy is normalized relative to maxRms', () => {
        // First call sets maxRms to 0.5
        (engine as any).processFeatures({ rms: 0.5 });
        // Second call with rms=0.5 means normRms ≈ 1.0 (same as max)
        (engine as any).processFeatures({ rms: 0.5 });
        const energy = engine.getFeatures().energy;
        // With smoothing, won't be exactly 1.0 but should be high
        expect(energy).toBeGreaterThan(0.3);
    });

    it('zero RMS produces energy trending toward zero', () => {
        // Warm up with non-zero
        (engine as any).processFeatures({ rms: 0.5 });
        // Now send zeros — energy should decay
        for (let i = 0; i < 50; i++) {
            (engine as any).processFeatures({ rms: 0 });
        }
        expect(engine.getFeatures().energy).toBeLessThan(0.01);
    });

    it('maxRms auto-calibrates to the loudest RMS seen', () => {
        (engine as any).processFeatures({ rms: 0.1 });
        expect((engine as any).maxRms).toBeCloseTo(0.1, 2);

        (engine as any).processFeatures({ rms: 0.8 });
        expect((engine as any).maxRms).toBeCloseTo(0.8, 2);
    });

    it('maxRms decays slowly when RMS decreases', () => {
        (engine as any).processFeatures({ rms: 1.0 });
        const maxAfterPeak = (engine as any).maxRms;

        (engine as any).processFeatures({ rms: 0.1 });
        const maxAfterDrop = (engine as any).maxRms;

        // maxRms should have decayed slightly (×0.998)
        expect(maxAfterDrop).toBeLessThan(maxAfterPeak);
        expect(maxAfterDrop).toBeGreaterThan(maxAfterPeak * 0.99);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: processFeatures — TENSION (Spectral Centroid)
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Tension (Spectral Centroid)', () => {
    it('high spectral centroid produces high tension', () => {
        for (let i = 0; i < 20; i++) {
            (engine as any).processFeatures({ rms: 0.5, spectralCentroid: 70 });
        }
        const tension = engine.getFeatures().tension;
        expect(tension).toBeGreaterThan(0.5);
    });

    it('zero spectral centroid produces tension near zero', () => {
        (engine as any).processFeatures({ rms: 0.5, spectralCentroid: 0 });
        expect(engine.getFeatures().tension).toBeLessThan(0.1);
    });

    it('centroid is normalized by dividing by 80', () => {
        // centroid=80 → normCentroid=1.0 (clamped)
        for (let i = 0; i < 50; i++) {
            (engine as any).processFeatures({ rms: 0.5, spectralCentroid: 80 });
        }
        const tension = engine.getFeatures().tension;
        expect(tension).toBeGreaterThan(0.8);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: processFeatures — URGENCY (RMS Delta)
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Urgency (RMS Delta)', () => {
    it('sudden RMS change produces urgency', () => {
        // Steady state
        (engine as any).processFeatures({ rms: 0.1 });
        // Sudden jump
        (engine as any).processFeatures({ rms: 0.8 });
        const urgency = engine.getFeatures().urgency;
        expect(urgency).toBeGreaterThan(0);
    });

    it('steady RMS produces low urgency', () => {
        for (let i = 0; i < 30; i++) {
            (engine as any).processFeatures({ rms: 0.5 });
        }
        const urgency = engine.getFeatures().urgency;
        expect(urgency).toBeLessThan(0.1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: processFeatures — BREATHINESS (ZCR + Flatness)
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Breathiness (ZCR + Flatness)', () => {
    it('high ZCR and flatness produce breathiness', () => {
        for (let i = 0; i < 30; i++) {
            (engine as any).processFeatures({
                rms: 0.5,
                zcr: 80,
                spectralFlatness: 0.25,
            });
        }
        const breathiness = engine.getFeatures().breathiness;
        expect(breathiness).toBeGreaterThan(0.3);
    });

    it('breathiness blends 40% ZCR + 60% flatness', () => {
        // This is verified by the formula, but we can check
        // that pure ZCR contributes less than pure flatness
        const engineA = new AudioEngine();
        const engineB = new AudioEngine();

        // Engine A: high ZCR, zero flatness
        for (let i = 0; i < 30; i++) {
            (engineA as any).processFeatures({ rms: 0.5, zcr: 80, spectralFlatness: 0 });
        }
        // Engine B: zero ZCR, high flatness
        for (let i = 0; i < 30; i++) {
            (engineB as any).processFeatures({ rms: 0.5, zcr: 0, spectralFlatness: 0.25 });
        }

        const breathA = engineA.getFeatures().breathiness;
        const breathB = engineB.getFeatures().breathiness;

        // Flatness-only should contribute more (60% weight) than ZCR-only (40%)
        expect(breathB).toBeGreaterThan(breathA);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 7: processFeatures — TEXTURE COMPLEXITY (MFCC Variance)
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Texture Complexity (MFCC)', () => {
    it('high MFCC variance produces textureComplexity > 0', () => {
        // Create MFCCs with high variance
        const highVarianceMFCC = [100, -50, 80, -30, 60, -20, 40, -10, 30, -5, 20, 0, 10];
        for (let i = 0; i < 20; i++) {
            (engine as any).processFeatures({ rms: 0.5, mfcc: highVarianceMFCC });
        }
        expect(engine.getFeatures().textureComplexity).toBeGreaterThan(0);
    });

    it('uniform MFCCs (zero variance) produce low textureComplexity', () => {
        const uniformMFCC = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
        for (let i = 0; i < 30; i++) {
            (engine as any).processFeatures({ rms: 0.5, mfcc: uniformMFCC });
        }
        expect(engine.getFeatures().textureComplexity).toBeLessThan(0.05);
    });

    it('missing MFCC data does not crash', () => {
        expect(() => {
            (engine as any).processFeatures({ rms: 0.5 });
        }).not.toThrow();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 8: processFeatures — ROLLOFF
// ══════════════════════════════════════════════════════════════════════

describe('AudioEngine — Rolloff', () => {
    it('high spectral rolloff produces rolloff near 1', () => {
        for (let i = 0; i < 30; i++) {
            (engine as any).processFeatures({ rms: 0.5, spectralRolloff: 8000 });
        }
        expect(engine.getFeatures().rolloff).toBeGreaterThan(0.8);
    });

    it('low spectral rolloff produces rolloff near 0', () => {
        for (let i = 0; i < 30; i++) {
            (engine as any).processFeatures({ rms: 0.5, spectralRolloff: 1000 });
        }
        expect(engine.getFeatures().rolloff).toBeLessThan(0.1);
    });

    it('rolloff below 1000Hz floor maps to 0', () => {
        for (let i = 0; i < 30; i++) {
            (engine as any).processFeatures({ rms: 0.5, spectralRolloff: 500 });
        }
        expect(engine.getFeatures().rolloff).toBeLessThan(0.01);
    });
});
