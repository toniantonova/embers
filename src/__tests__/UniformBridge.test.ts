/**
 * UniformBridge.test.ts — Unit tests for the audio-to-shader pipeline.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * UniformBridge is the translator between AudioEngine and the particle
 * shaders. It reads audio features, applies influence multipliers from
 * TuningConfig, clamps to safe ranges, and writes to shader uniforms.
 * We verify:
 *   1. Features are correctly mapped to uniforms
 *   2. Influence multipliers scale features
 *   3. Idle mode zeros out everything
 *   4. All values are clamped to [0, 1]
 *   5. Color mode changes are reflected
 *
 * MOCK STRATEGY:
 * ──────────────
 * We mock AudioEngine (returns controlled feature values),
 * ParticleSystem (exposes stub uniform objects), and use a real
 * TuningConfig instance for authentic multiplier behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniformBridge } from '../engine/UniformBridge';
import { TuningConfig } from '../services/TuningConfig';
import { KeywordClassifier } from '../services/KeywordClassifier';

// ── MOCK FACTORIES ───────────────────────────────────────────────────

/** Create a mock AudioEngine that returns controllable features. */
function createMockAudioEngine(features = {
    energy: 0.5,
    tension: 0.3,
    urgency: 0.4,
    breathiness: 0.2,
    flatness: 0.1,
    textureComplexity: 0.6,
    rolloff: 0.7,
}) {
    return {
        getFeatures: vi.fn().mockReturnValue(features),
        start: vi.fn(),
        stop: vi.fn(),
        setConfig: vi.fn(),
    } as any;
}

/** Create a mock ParticleSystem with stubbed uniform objects. */
function createMockParticleSystem() {
    // Velocity shader uniforms
    const velocityUniforms = {
        uEnergy: { value: 0 },
        uTension: { value: 0 },
        uUrgency: { value: 0 },
        uBreathiness: { value: 0 },
        uTextureComplexity: { value: 0 },
        uEnergyCurveMode: { value: 0 },
        uUrgencyCurveMode: { value: 0 },
        uUrgencyThresholdLow: { value: 0 },
        uUrgencyThresholdHigh: { value: 0 },
        uDelta: { value: 0.016 },  // ~60fps timestep for sentiment smoothing
        uSentimentMovement: { value: 0 },
        uSentimentMovementIntensity: { value: 0 },
        uAbstraction: { value: 0 },
        uNoiseAmplitude: { value: 0.25 },
        uSpringK: { value: 1.5 },
        uRepulsionStrength: { value: 5.0 },
    };

    // Render shader uniforms
    const renderUniforms = {
        uRolloff: { value: 0 },
        uColorMode: { value: 0 },
        uTension: { value: 0 },
        uEnergy: { value: 0 },
        uColor: {
            value: {
                copy: vi.fn(),
                set: vi.fn(),
            }
        },
        uSentiment: { value: 0 },
        uEmotionalIntensity: { value: 0 },
        uEmotionArousal: { value: 0 },
        uEmotionDominance: { value: 0 },
    };

    return {
        velocityVariable: {
            material: { uniforms: velocityUniforms }
        },
        particles: {
            material: { uniforms: renderUniforms }
        },
    } as any;
}


// ── SETUP ────────────────────────────────────────────────────────────
let config: TuningConfig;
let mockAudio: ReturnType<typeof createMockAudioEngine>;
let mockParticles: ReturnType<typeof createMockParticleSystem>;
let bridge: UniformBridge;

beforeEach(() => {
    localStorage.clear();
    config = new TuningConfig();
    mockAudio = createMockAudioEngine();
    mockParticles = createMockParticleSystem();
    bridge = new UniformBridge(mockAudio, mockParticles, config);
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: FEATURE → UNIFORM MAPPING
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Feature Mapping', () => {
    it('maps audio features to velocity shader uniforms', () => {
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // Default influence is 1.0, so values should pass through
        expect(u.uEnergy.value).toBeCloseTo(0.5, 2);
        expect(u.uTension.value).toBeCloseTo(0.3, 2);
        expect(u.uUrgency.value).toBeCloseTo(0.4, 2);
        expect(u.uBreathiness.value).toBeCloseTo(0.2, 2);
        expect(u.uTextureComplexity.value).toBeCloseTo(0.6, 2);
    });

    it('maps rolloff to render shader uniform', () => {
        bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        expect(r.uRolloff.value).toBeCloseTo(0.7, 2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: INFLUENCE MULTIPLIERS
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Influence Multipliers', () => {
    it('zeroed influence mutes feature', () => {
        config.set('audioInfluence.energy', 0);
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uEnergy.value).toBe(0);
    });

    it('doubled influence doubles feature', () => {
        config.set('audioInfluence.energy', 2);
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // 0.5 * 2 = 1.0 (clamped to max 1.0)
        expect(u.uEnergy.value).toBe(1.0);
    });

    it('influence multiplier affects textureComplexity', () => {
        config.set('audioInfluence.textureComplexity', 0.5);
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // 0.6 * 0.5 = 0.3
        expect(u.uTextureComplexity.value).toBeCloseTo(0.3, 2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: IDLE MODE
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Idle Mode', () => {
    it('resetToIdle() zeros all audio-driven uniforms', () => {
        bridge.resetToIdle();
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uEnergy.value).toBe(0);
        expect(u.uTension.value).toBe(0);
        expect(u.uUrgency.value).toBe(0);
        expect(u.uBreathiness.value).toBe(0);
        expect(u.uTextureComplexity.value).toBe(0);
    });

    it('resetToIdle() sets rolloff to neutral 0.5', () => {
        bridge.resetToIdle();
        bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        expect(r.uRolloff.value).toBe(0.5);
    });

    it('exitIdle() restores live feature pass-through', () => {
        bridge.resetToIdle();
        bridge.update();
        bridge.exitIdle();
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uEnergy.value).toBeCloseTo(0.5, 2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: CLAMPING
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Clamping', () => {
    it('clamps values above 1 to 1', () => {
        // Boost influence beyond 1 to force values > 1
        const highAudio = createMockAudioEngine({
            energy: 0.8, tension: 0.9, urgency: 0.9,
            breathiness: 0.7, flatness: 0.5,
            textureComplexity: 0.9, rolloff: 0.9,
        });
        const bridgeHigh = new UniformBridge(highAudio, mockParticles, config);
        config.set('audioInfluence.energy', 2.0);
        bridgeHigh.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // 0.8 * 2.0 = 1.6 → clamped to 1.0
        expect(u.uEnergy.value).toBeLessThanOrEqual(1.0);
    });

    it('values cannot go below 0', () => {
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uEnergy.value).toBeGreaterThanOrEqual(0);
        expect(u.uTension.value).toBeGreaterThanOrEqual(0);
        expect(u.uUrgency.value).toBeGreaterThanOrEqual(0);
        expect(u.uBreathiness.value).toBeGreaterThanOrEqual(0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: CURVE MODE FORWARDING
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Curve Modes', () => {
    it('forwards energyCurveMode from config', () => {
        config.set('energyCurveMode', 1.0);
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uEnergyCurveMode.value).toBe(1.0);
    });

    it('forwards urgencyCurveMode from config', () => {
        config.set('urgencyCurveMode', 1.0);
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uUrgencyCurveMode.value).toBe(1.0);
    });

    it('forwards urgency thresholds from config', () => {
        config.set('urgencyThresholdLow', 0.2);
        config.set('urgencyThresholdHigh', 0.8);
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uUrgencyThresholdLow.value).toBe(0.2);
        expect(u.uUrgencyThresholdHigh.value).toBe(0.8);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: COLOR MODE
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Color Mode', () => {
    it('white mode sets uColorMode to 0', () => {
        bridge.colorMode = 'white';
        bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        expect(r.uColorMode.value).toBe(0.0);
    });

    it('rainbow mode sets uColorMode to 1', () => {
        bridge.colorMode = 'color';
        bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        expect(r.uColorMode.value).toBe(1.0);
    });

    it('always sets neutral white base color (shader does tinting)', () => {
        bridge.colorMode = 'white';
        bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        expect(r.uColor.value.set).toHaveBeenCalledWith(1.0, 1.0, 1.0);
    });

    it('maps tension to render shader for warm/cool color', () => {
        bridge.update();
        const r = (mockParticles.particles.material as any).uniforms;
        // tension=0.3 from mock audio engine, influence=1.0
        expect(r.uTension.value).toBeCloseTo(0.3, 2);
    });

    it('maps energy to render shader for brightness glow', () => {
        bridge.update();
        const r = (mockParticles.particles.material as any).uniforms;
        // energy=0.5 from mock audio engine, influence=1.0
        expect(r.uEnergy.value).toBeCloseTo(0.5, 2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// 6. SENTIMENT COLOR
// ══════════════════════════════════════════════════════════════════════

describe('Sentiment Color', () => {
    it('uSentiment stays 0 when sentimentEnabled is false', () => {
        bridge.colorMode = 'color';
        bridge.sentimentEnabled = false;
        bridge.sentimentOverride = 0.8;
        bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        // smoothedSentiment lerps toward 0 when disabled
        expect(r.uSentiment.value).toBeCloseTo(0, 1);
    });

    it('uSentiment works in white mode when enabled (not rainbow-only)', () => {
        bridge.colorMode = 'white';
        bridge.sentimentEnabled = true;
        bridge.sentimentOverride = 0.8;
        // Run several frames
        for (let i = 0; i < 60; i++) bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        // Should have moved toward target since sentiment now works in both modes
        expect(r.uSentiment.value).toBeGreaterThan(0.3);
    });

    it('uSentiment moves toward override when enabled', () => {
        bridge.colorMode = 'color';
        bridge.sentimentEnabled = true;
        bridge.sentimentOverride = 0.8;

        // Run several frames to let smoothing converge
        for (let i = 0; i < 60; i++) bridge.update();

        const r = (mockParticles.particles.material as any).uniforms;
        // Should have moved substantially toward target (0.8)
        expect(r.uSentiment.value).toBeGreaterThan(0.3);
    });
});


// ══════════════════════════════════════════════════════════════════════
// 7. WORD → SENTIMENT → UNIFORM (End-to-End)
// ══════════════════════════════════════════════════════════════════════
// These tests verify the full pipeline: a spoken word is classified by
// KeywordClassifier, the resulting sentiment is fed to UniformBridge,
// and the shader uniform moves in the correct direction.
// ══════════════════════════════════════════════════════════════════════

describe('Word → Sentiment Color (end-to-end)', () => {
    let classifier: KeywordClassifier;

    beforeEach(() => {
        classifier = new KeywordClassifier();
    });

    /**
     * Helper: classify a word, push its sentiment into the bridge,
     * run enough frames for smoothing to converge, return final
     * uSentiment value.
     */
    function sentimentForWord(word: string): number {
        const state = classifier.classify(word);
        bridge.colorMode = 'color';
        bridge.sentimentEnabled = true;
        bridge.sentimentOverride = state.sentiment;

        // Run 120 frames (~2s at 60fps) to let smoothing converge
        for (let i = 0; i < 120; i++) bridge.update();

        return (mockParticles.particles.material as any)
            .uniforms.uSentiment.value;
    }

    it('"happy" produces positive sentiment (warm shift)', () => {
        const s = sentimentForWord('happy');
        // happy = AFINN +3, normalized to 0.6 — should be clearly positive
        expect(s).toBeGreaterThan(0.3);
    });

    it('"angry" produces negative sentiment (cool shift)', () => {
        const s = sentimentForWord('angry');
        // angry = AFINN -3, normalized to -0.6 — should be clearly negative
        expect(s).toBeLessThan(-0.3);
    });

    it('"sad" produces negative sentiment (cool shift)', () => {
        const s = sentimentForWord('sad');
        // sad = AFINN -2, normalized to -0.4
        expect(s).toBeLessThan(-0.2);
    });

    it('"ashamed" produces negative sentiment (cool shift)', () => {
        const s = sentimentForWord('ashamed');
        // ashamed = AFINN -2, normalized to -0.4
        expect(s).toBeLessThan(-0.2);
    });

    it('"anxious" produces negative sentiment (cool shift)', () => {
        const s = sentimentForWord('anxious');
        // anxious = AFINN -2, normalized to -0.4
        expect(s).toBeLessThan(-0.2);
    });

    it('positive words shift warmer than negative words', () => {
        const happy = sentimentForWord('happy');

        // Reset bridge between words
        bridge.sentimentOverride = null;
        for (let i = 0; i < 120; i++) bridge.update();

        const angry = sentimentForWord('angry');

        // happy should be positive, angry should be negative
        expect(happy).toBeGreaterThan(0);
        expect(angry).toBeLessThan(0);
        // The difference should be substantial
        expect(happy - angry).toBeGreaterThan(0.5);
    });
});

describe('Sentiment Movement', () => {
    it('uSentimentMovement stays 0 when sentimentMovementEnabled is false', () => {
        bridge.sentimentMovementEnabled = false;
        bridge.sentimentOverride = 0.6;
        bridge.update();

        const v = (mockParticles.velocityVariable.material as any).uniforms;
        expect(v.uSentimentMovement.value).toBe(0);
    });

    it('uSentimentMovement tracks smoothedSentiment when enabled', () => {
        bridge.sentimentMovementEnabled = true;
        bridge.sentimentOverride = 0.6;
        // Run multiple updates for smoothing to converge
        for (let i = 0; i < 60; i++) bridge.update();

        const v = (mockParticles.velocityVariable.material as any).uniforms;
        expect(v.uSentimentMovement.value).toBeGreaterThan(0.3);
    });

    it('pushes sentimentMovementIntensity from config', () => {
        bridge.sentimentMovementEnabled = true;
        bridge.sentimentOverride = 0.5;
        bridge.update();

        const v = (mockParticles.velocityVariable.material as any).uniforms;
        expect(v.uSentimentMovementIntensity.value).toBe(config.get('sentimentMovementIntensity'));
    });

    it('works independently of color mode (white and rainbow)', () => {
        bridge.sentimentMovementEnabled = true;
        bridge.sentimentOverride = 0.6;

        // Test in white mode
        bridge.colorMode = 'white';
        for (let i = 0; i < 60; i++) bridge.update();
        const v = (mockParticles.velocityVariable.material as any).uniforms;
        const whiteValue = v.uSentimentMovement.value;
        expect(whiteValue).toBeGreaterThan(0.3);

        // Reset and test in rainbow mode — should get same result
        bridge.sentimentOverride = null;
        for (let i = 0; i < 120; i++) bridge.update();
        bridge.colorMode = 'color';
        bridge.sentimentOverride = 0.6;
        for (let i = 0; i < 60; i++) bridge.update();
        const rainbowValue = v.uSentimentMovement.value;
        expect(rainbowValue).toBeGreaterThan(0.3);
    });
});
