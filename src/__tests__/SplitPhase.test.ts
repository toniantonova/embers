/**
 * SplitPhase.test.ts — Tests for the split-phase update protocol.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * The animation loop uses a 3-phase protocol:
 *   Phase 1: ParticleSystem.writeConfigUniforms() — writes config baselines
 *   Phase 2: UniformBridge.update() — applies emotion/transition overrides
 *   Phase 3: ParticleSystem.computeAndRender() — GPU sees modulated values
 *
 * The critical invariant: UniformBridge's modulations must NOT be overwritten
 * by config baselines before the GPU compute runs. This was a real bug where
 * all emotion, transition, and sentiment overrides were silently erased.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniformBridge } from '../engine/UniformBridge';
import { TuningConfig } from '../services/TuningConfig';

// ── MOCK FACTORIES ───────────────────────────────────────────────────

function createMockAudioEngine() {
    return {
        getFeatures: vi.fn().mockReturnValue({
            energy: 0, tension: 0, urgency: 0, breathiness: 0,
            flatness: 0, textureComplexity: 0, rolloff: 0.5,
            pitch: 0, pitchDeviation: 0, pitchConfidence: 0,
        }),
        start: vi.fn(),
        stop: vi.fn(),
        setConfig: vi.fn(),
    } as any;
}

function createMockParticleSystem(config: TuningConfig) {
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
        uNoiseAmplitude: { value: config.get('noiseAmplitude') },
        uSpringK: { value: config.get('springK') },
        uRepulsionStrength: { value: config.get('repulsionStrength') },
        uRepulsionRadius: { value: config.get('repulsionRadius') },
        uDrag: { value: config.get('drag') },
        uNoiseFrequency: { value: config.get('noiseFrequency') },
        uBreathingAmplitude: { value: config.get('breathingAmplitude') },
        uFormationScale: { value: config.get('formationScale') },
        uTime: { value: 0 },
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
        uPointSize: { value: config.get('pointSize') },
        uAlpha: { value: config.get('pointOpacity') },
        uTime: { value: 0 },
    };

    return {
        velocityVariable: { material: { uniforms: velocityUniforms } },
        particles: { material: { uniforms: renderUniforms } },
        /**
         * Simulates writeConfigUniforms — resets uniforms to config baselines.
         * This is what the real ParticleSystem.writeConfigUniforms() does.
         */
        writeConfigUniforms(dt: number) {
            velocityUniforms.uSpringK.value = config.get('springK');
            velocityUniforms.uNoiseAmplitude.value = config.get('noiseAmplitude');
            velocityUniforms.uAbstraction.value = config.get('abstraction');
            velocityUniforms.uRepulsionStrength.value = config.get('repulsionStrength');
            velocityUniforms.uDrag.value = config.get('drag');
            velocityUniforms.uTime.value += dt;
            velocityUniforms.uDelta.value = dt;
        },
    } as any;
}

// ── SETUP ────────────────────────────────────────────────────────────
let config: TuningConfig;
let mockAudio: ReturnType<typeof createMockAudioEngine>;
let mockParticles: ReturnType<typeof createMockParticleSystem>;

beforeEach(() => {
    localStorage.clear();
    config = new TuningConfig();
    mockAudio = createMockAudioEngine();
    mockParticles = createMockParticleSystem(config);
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: SPRING OVERRIDE SURVIVES CONFIG BASELINE
// ══════════════════════════════════════════════════════════════════════

describe('Split-Phase Protocol — Spring Override', () => {
    it('springOverride survives writeConfigUniforms when applied after', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);

        // Phase 1: Config baseline writes springK = 3.0 (default)
        mockParticles.writeConfigUniforms(0.016);
        const baseSpring = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
        expect(baseSpring).toBe(config.get('springK'));

        // Phase 2: UniformBridge applies transition override
        bridge.springOverride = 0.5;
        bridge.update();

        // After bridge.update(), springK should reflect the override, NOT config baseline
        const overriddenSpring = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
        expect(overriddenSpring).toBeCloseTo(0.5, 1);
        expect(overriddenSpring).not.toBe(baseSpring);
    });

    it('WITHOUT split-phase, config baseline would erase override (regression guard)', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);

        // Simulate the OLD buggy order: bridge.update() THEN writeConfigUniforms
        bridge.springOverride = 0.5;
        bridge.update();

        const afterBridge = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
        expect(afterBridge).toBeCloseTo(0.5, 1);

        // If writeConfigUniforms ran AFTER bridge.update(), it would erase the override
        mockParticles.writeConfigUniforms(0.016);
        const afterConfig = mockParticles.velocityVariable.material.uniforms.uSpringK.value;

        // This proves the bug: config baseline overwrites the override
        expect(afterConfig).toBe(config.get('springK'));
        expect(afterConfig).not.toBeCloseTo(0.5, 1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: NOISE OVERRIDE SURVIVES CONFIG BASELINE
// ══════════════════════════════════════════════════════════════════════

describe('Split-Phase Protocol — Noise Override', () => {
    it('noiseOverride applied after writeConfigUniforms is visible to GPU', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);

        // Phase 1: baseline
        mockParticles.writeConfigUniforms(0.016);
        expect(mockParticles.velocityVariable.material.uniforms.uNoiseAmplitude.value)
            .toBe(config.get('noiseAmplitude'));

        // Phase 2: override
        bridge.noiseOverride = 0.8;
        bridge.update();

        const noise = mockParticles.velocityVariable.material.uniforms.uNoiseAmplitude.value;
        expect(noise).toBeGreaterThan(config.get('noiseAmplitude'));
        expect(noise).toBeCloseTo(0.8, 1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: ABSTRACTION OVERRIDE SURVIVES CONFIG BASELINE
// ══════════════════════════════════════════════════════════════════════

describe('Split-Phase Protocol — Abstraction Override', () => {
    it('abstractionOverride applied after writeConfigUniforms is visible', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);

        // Phase 1: baseline (abstraction default = 0.0)
        mockParticles.writeConfigUniforms(0.016);
        expect(mockParticles.velocityVariable.material.uniforms.uAbstraction.value)
            .toBe(config.get('abstraction'));

        // Phase 2: override
        bridge.abstractionOverride = 0.7;
        bridge.update();

        expect(mockParticles.velocityVariable.material.uniforms.uAbstraction.value)
            .toBeCloseTo(0.7, 1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: FULL ANIMATION LOOP SEQUENCE
// ══════════════════════════════════════════════════════════════════════

describe('Split-Phase Protocol — Full Loop Sequence', () => {
    it('correct order preserves all overrides for a single frame', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);

        // Set up overrides (as SemanticBackend would during dissolve phase)
        bridge.springOverride = 0.4;
        bridge.noiseOverride = 0.6;
        bridge.abstractionOverride = 0.5;

        // Simulate correct animation loop order:
        // Phase 1: writeConfigUniforms
        mockParticles.writeConfigUniforms(0.016);

        // Phase 2: bridge.update
        bridge.update();

        // Verify all overrides survived
        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uSpringK.value).toBeCloseTo(0.4, 1);
        expect(u.uNoiseAmplitude.value).toBeCloseTo(0.6, 1);
        expect(u.uAbstraction.value).toBeCloseTo(0.5, 1);
    });

    it('multiple consecutive frames maintain consistent overrides', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);
        bridge.springOverride = 0.4;

        // Run 10 frames with correct ordering
        for (let i = 0; i < 10; i++) {
            mockParticles.writeConfigUniforms(0.016);
            bridge.update();

            const springK = mockParticles.velocityVariable.material.uniforms.uSpringK.value;
            // Should be close to 0.4 every frame (small valence offset may drift slightly)
            expect(springK).toBeCloseTo(0.4, 0);
            expect(springK).toBeLessThan(config.get('springK'));
        }
    });
});
