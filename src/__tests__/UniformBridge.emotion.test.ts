/**
 * UniformBridge.emotion.test.ts — Tests for SER emotion → particle physics integration.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * UniformBridge receives full VAD (Valence/Arousal/Dominance) emotion state
 * from the SER worker and maps it to particle physics:
 *   - Arousal → noise amplitude offset (excited = chaotic)
 *   - Valence → spring constant offset (positive = lighter springs)
 *   - Dominance → repulsion strength boost (dominant = assertive)
 *
 * The raw emotion values (updated every ~2s) are EMA-smoothed to prevent
 * jarring step-changes at frame rate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniformBridge } from '../engine/UniformBridge';
import { TuningConfig } from '../services/TuningConfig';
import type { EmotionState } from '../audio/types';

// ── MOCK FACTORIES ───────────────────────────────────────────────────

function createMockAudioEngine() {
    return {
        getFeatures: vi.fn().mockReturnValue({
            energy: 0.5, tension: 0.3, urgency: 0.4,
            breathiness: 0.2, flatness: 0.1, textureComplexity: 0.6,
            rolloff: 0.7, pitch: 0, pitchDeviation: 0, pitchConfidence: 0,
        }),
        start: vi.fn(),
        stop: vi.fn(),
        setConfig: vi.fn(),
    } as any;
}

function createMockParticleSystem() {
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
        uDelta: { value: 0.016 },
        uSentimentMovement: { value: 0 },
        uSentimentMovementIntensity: { value: 0 },
        uAbstraction: { value: 0 },
        uNoiseAmplitude: { value: 0.25 },
        uSpringK: { value: 1.5 },
        uRepulsionStrength: { value: 5.0 },
    };

    const renderUniforms = {
        uRolloff: { value: 0 },
        uColorMode: { value: 0 },
        uTension: { value: 0 },
        uEnergy: { value: 0 },
        uColor: { value: { copy: vi.fn(), set: vi.fn() } },
        uSentiment: { value: 0 },
        uEmotionalIntensity: { value: 0 },
        uEmotionArousal: { value: 0 },
        uEmotionDominance: { value: 0 },
    };

    return {
        velocityVariable: { material: { uniforms: velocityUniforms } },
        particles: { material: { uniforms: renderUniforms } },
    } as any;
}

function makeEmotion(overrides: Partial<EmotionState> = {}): EmotionState {
    return {
        valence: 0,
        arousal: 0,
        dominance: 0,
        confidence: 0.8,
        timestamp: Date.now(),
        ...overrides,
    };
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
// SUITE 1: EMOTION STATE RECEPTION
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Emotion State Reception', () => {
    it('setEmotionState() stores emotion for smoothing', () => {
        const emotion = makeEmotion({ valence: 0.8, arousal: 0.7, dominance: 0.6 });
        bridge.setEmotionState(emotion);

        // After many frames, smoothed values should converge toward raw
        for (let i = 0; i < 120; i++) bridge.update();

        const smoothed = bridge.getSmoothedEmotion();
        expect(smoothed.valence).toBeGreaterThan(0.5);
        expect(smoothed.arousal).toBeGreaterThan(0.4);
        expect(smoothed.dominance).toBeGreaterThan(0.3);
    });

    it('neutral emotion produces near-zero smoothed values', () => {
        bridge.setEmotionState(makeEmotion());
        for (let i = 0; i < 60; i++) bridge.update();

        const smoothed = bridge.getSmoothedEmotion();
        expect(Math.abs(smoothed.valence)).toBeLessThan(0.05);
        expect(Math.abs(smoothed.arousal)).toBeLessThan(0.05);
        expect(Math.abs(smoothed.dominance)).toBeLessThan(0.05);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: EMA SMOOTHING BEHAVIOR
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Emotion EMA Smoothing', () => {
    it('smoothed values change gradually (not snap to raw)', () => {
        bridge.setEmotionState(makeEmotion({ arousal: 0.9 }));

        // After 1 frame: smoothed should be well below raw
        bridge.update();
        const afterOne = bridge.getSmoothedEmotion();
        expect(afterOne.arousal).toBeLessThan(0.5);

        // After 30 frames: should be much closer
        for (let i = 0; i < 29; i++) bridge.update();
        const afterThirty = bridge.getSmoothedEmotion();
        expect(afterThirty.arousal).toBeGreaterThan(afterOne.arousal);
        expect(afterThirty.arousal).toBeGreaterThan(0.5);
    });

    it('transitions smoothly between two emotion states', () => {
        bridge.setEmotionState(makeEmotion({ valence: 0.8 }));
        for (let i = 0; i < 60; i++) bridge.update();
        const warmState = bridge.getSmoothedEmotion().valence;

        // Switch to negative
        bridge.setEmotionState(makeEmotion({ valence: -0.6 }));
        bridge.update();

        // After 1 frame: should still be mostly positive
        const afterSwitch = bridge.getSmoothedEmotion().valence;
        expect(afterSwitch).toBeGreaterThan(0);

        // After many frames: should converge toward negative
        for (let i = 0; i < 120; i++) bridge.update();
        const converged = bridge.getSmoothedEmotion().valence;
        expect(converged).toBeLessThan(warmState);
        expect(converged).toBeLessThan(0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: AROUSAL → NOISE AMPLITUDE
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Arousal → Noise', () => {
    it('high arousal increases noise amplitude', () => {
        // First, read baseline noise with neutral emotion
        bridge.setEmotionState(makeEmotion());
        bridge.noiseOverride = 0.5;
        bridge.update();
        const baselineNoise = mockParticles.velocityVariable.material.uniforms.uNoiseAmplitude.value;

        // Now set high arousal and let it converge
        bridge.setEmotionState(makeEmotion({ arousal: 0.9 }));
        for (let i = 0; i < 60; i++) bridge.update();
        const arousalNoise = mockParticles.velocityVariable.material.uniforms.uNoiseAmplitude.value;

        expect(arousalNoise).toBeGreaterThan(baselineNoise);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: VALENCE → SPRING CONSTANT
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Valence → Spring', () => {
    it('positive valence reduces spring constant (lighter feel)', () => {
        bridge.setEmotionState(makeEmotion({ valence: 0.8 }));
        for (let i = 0; i < 60; i++) bridge.update();

        const springK = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
        // Base spring is 1.5, positive valence should reduce it
        expect(springK).toBeLessThan(1.5);
    });

    it('negative valence increases spring constant (tighter feel)', () => {
        bridge.setEmotionState(makeEmotion({ valence: -0.6 }));
        for (let i = 0; i < 60; i++) bridge.update();

        const springK = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
        // Negative valence → positive offset → higher spring
        expect(springK).toBeGreaterThan(1.5);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: DOMINANCE → REPULSION
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Dominance → Repulsion', () => {
    it('high dominance boosts repulsion strength', () => {
        // Read baseline
        bridge.setEmotionState(makeEmotion());
        bridge.update();
        const baseRepulsion = mockParticles.velocityVariable.material.uniforms.uRepulsionStrength.value;

        // Set high dominance
        bridge.setEmotionState(makeEmotion({ dominance: 0.9 }));
        for (let i = 0; i < 60; i++) bridge.update();

        const boostedRepulsion = mockParticles.velocityVariable.material.uniforms.uRepulsionStrength.value;
        expect(boostedRepulsion).toBeGreaterThan(baseRepulsion);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: SPRING OVERRIDE (TRANSITION CHOREOGRAPHY)
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Spring Override', () => {
    it('springOverride directly controls uSpringK', () => {
        bridge.springOverride = 0.5;
        bridge.update();

        const springK = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
        // Should be close to 0.5 (with small valence offset since valence=0)
        expect(springK).toBeCloseTo(0.5, 1);
    });

    it('springOverride null falls back to config value', () => {
        bridge.springOverride = null;
        bridge.update();

        const springK = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
        // Should be near the config default (1.5) with valence offset
        expect(springK).toBeGreaterThan(1.0);
    });
});

