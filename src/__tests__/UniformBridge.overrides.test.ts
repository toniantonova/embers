/**
 * UniformBridge.overrides.test.ts — Tests for semantic override + WorkspaceEngine fallback paths.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * UniformBridge has a three-tier priority for shader values:
 *   1. SemanticBackend override (abstractionOverride, noiseOverride)
 *   2. WorkspaceEngine fallback (reads workspace state if no override)
 *   3. Config default (if neither override nor workspace is set)
 *
 * These tests verify the override resolution logic, ensuring the priority
 * chain works correctly and that WorkspaceEngine integration behaves
 * as expected when the semantic pipeline is not providing values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniformBridge } from '../engine/UniformBridge';
import { TuningConfig } from '../services/TuningConfig';
import { WorkspaceEngine } from '../engine/WorkspaceEngine';
import type { AudioFeatures } from '../services/AudioEngine';

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function silentAudio(): AudioFeatures {
    return {
        energy: 0, tension: 0, urgency: 0, breathiness: 0,
        flatness: 0, textureComplexity: 0, rolloff: 0.5,
        pitch: 0, pitchDeviation: 0, pitchConfidence: 0,
    };
}

// ── SETUP ────────────────────────────────────────────────────────────
let config: TuningConfig;
let mockAudio: ReturnType<typeof createMockAudioEngine>;
let mockParticles: ReturnType<typeof createMockParticleSystem>;

beforeEach(() => {
    localStorage.clear();
    config = new TuningConfig();
    mockAudio = createMockAudioEngine();
    mockParticles = createMockParticleSystem();
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: ABSTRACTION OVERRIDE PRIORITY
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Abstraction Override Priority', () => {
    it('abstractionOverride takes precedence over workspace engine', () => {
        const workspace = new WorkspaceEngine();
        // Drive workspace abstraction toward 0.2 via semantic state
        for (let i = 0; i < 100; i++) {
            workspace.update(0.1, silentAudio(), {
                morphTarget: 'horse', abstractionLevel: 0.2,
                dominantWord: 'horse', sentiment: 0, confidence: 0.8,
                emotionalIntensity: 0,
            });
        }

        const bridge = new UniformBridge(mockAudio, mockParticles, config, workspace);
        bridge.abstractionOverride = 0.9;
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // Should use the override (0.9), not the workspace value (~0.2)
        expect(u.uAbstraction.value).toBeCloseTo(0.9, 1);
    });

    it('workspace engine provides abstraction when override is null', () => {
        const workspace = new WorkspaceEngine();
        // Converge workspace abstraction to ~0.2
        for (let i = 0; i < 100; i++) {
            workspace.update(0.1, silentAudio(), {
                morphTarget: 'horse', abstractionLevel: 0.2,
                dominantWord: 'horse', sentiment: 0, confidence: 0.8,
                emotionalIntensity: 0,
            });
        }

        const bridge = new UniformBridge(mockAudio, mockParticles, config, workspace);
        bridge.abstractionOverride = null;
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // Should read from workspace engine (~0.2)
        expect(u.uAbstraction.value).toBeCloseTo(0.2, 1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: NOISE OVERRIDE PRIORITY
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Noise Override Priority', () => {
    it('noiseOverride takes precedence over workspace engine', () => {
        const workspace = new WorkspaceEngine();
        const bridge = new UniformBridge(mockAudio, mockParticles, config, workspace);
        bridge.noiseOverride = 0.8;
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // Should be near 0.8 (plus small emotion offset since emotion=0)
        expect(u.uNoiseAmplitude.value).toBeCloseTo(0.8, 1);
    });

    it('workspace noise used when noiseOverride is null', () => {
        const workspace = new WorkspaceEngine();
        const bridge = new UniformBridge(mockAudio, mockParticles, config, workspace);
        bridge.noiseOverride = null;
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // WorkspaceEngine default noise is 0.15
        expect(u.uNoiseAmplitude.value).toBeCloseTo(0.15, 1);
    });

    it('noise override is clamped to [0, 2]', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);
        bridge.noiseOverride = 5.0;
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        expect(u.uNoiseAmplitude.value).toBeLessThanOrEqual(2.0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: WORKSPACE ENGINE IDLE NOISE
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Workspace Idle Noise', () => {
    it('uses increased noise from workspace when idle (no override)', () => {
        const workspace = new WorkspaceEngine();
        // Push workspace into idle (past 300s timeout)
        workspace.update(301, silentAudio(), null);
        workspace.update(5, silentAudio(), null);

        const bridge = new UniformBridge(mockAudio, mockParticles, config, workspace);
        bridge.noiseOverride = null;
        bridge.update();

        const u = mockParticles.velocityVariable.material.uniforms;
        // Idle noise should be > 0.15 (base)
        expect(u.uNoiseAmplitude.value).toBeGreaterThan(0.15);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: EMOTIONAL INTENSITY OVERRIDE
// ══════════════════════════════════════════════════════════════════════

describe('UniformBridge — Emotional Intensity Override', () => {
    it('passes emotionalIntensityOverride to render shader when sentiment enabled', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);
        bridge.sentimentEnabled = true;
        bridge.sentimentOverride = 0.5;
        bridge.emotionalIntensityOverride = 0.8;
        bridge.update();

        const r = // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (mockParticles.particles.material as any).uniforms;
        expect(r.uEmotionalIntensity.value).toBe(0.8);
    });

    it('uEmotionalIntensity is 0 when sentiment is disabled', () => {
        const bridge = new UniformBridge(mockAudio, mockParticles, config);
        bridge.sentimentEnabled = false;
        bridge.emotionalIntensityOverride = 0.8;
        bridge.update();

        const r = // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (mockParticles.particles.material as any).uniforms;
        expect(r.uEmotionalIntensity.value).toBe(0);
    });
});
