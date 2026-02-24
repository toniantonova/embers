/**
 * WorkspaceEngine.test.ts — Unit tests for the session state aggregator.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * WorkspaceEngine aggregates audio features, semantic state, and temporal
 * data into a unified WorkspaceState used by the AnalysisPanel. We verify:
 *   1. Initial state values
 *   2. Arousal computation from audio energy + urgency
 *   3. Time-since-last-utterance tracking
 *   4. registerSpeech() resets the idle timer
 *   5. Idle behavior (morphTargetBlend decay, noise increase)
 *   6. Semantic state integration (abstraction, entropy, sentiment)
 *   7. Breathing phase oscillation
 *   8. Coherence computation
 *   9. getState() returns a defensive copy
 *  10. getNoiseAmplitude() returns current noise level
 *
 * MOCK STRATEGY:
 * ──────────────
 * We create controlled AudioFeatures and SemanticState objects.
 * No mocking framework needed — WorkspaceEngine is a pure state machine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceEngine } from '../engine/WorkspaceEngine';
import type { AudioFeatures } from '../services/AudioEngine';
import type { SemanticState } from '../services/KeywordClassifier';

// ── FACTORIES ────────────────────────────────────────────────────────

/** Default silent audio features. */
function silentAudio(): AudioFeatures {
    return {
        energy: 0,
        tension: 0,
        urgency: 0,
        breathiness: 0,
        flatness: 0,
        textureComplexity: 0,
        rolloff: 0.5,
        pitch: 0,
        pitchDeviation: 0,
        pitchConfidence: 0,
    };
}

/** Active audio features simulating speech. */
function activeAudio(energy = 0.6, urgency = 0.4): AudioFeatures {
    return {
        energy,
        tension: 0.3,
        urgency,
        breathiness: 0.2,
        flatness: 0.1,
        textureComplexity: 0.5,
        rolloff: 0.7,
        pitch: 0.4,
        pitchDeviation: 0.1,
        pitchConfidence: 0.7,
    };
}

/** A concrete semantic state for a recognized word. */
function concreteSemanticState(overrides: Partial<SemanticState> = {}): SemanticState {
    return {
        morphTarget: 'horse',
        abstractionLevel: 0.2,
        dominantWord: 'horse',
        sentiment: 0.5,
        confidence: 0.8,
        emotionalIntensity: 0.5,
        ...overrides,
    };
}

// ── SETUP ────────────────────────────────────────────────────────────
let engine: WorkspaceEngine;

beforeEach(() => {
    engine = new WorkspaceEngine();
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: INITIAL STATE
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — Initial State', () => {
    it('starts with sensible defaults', () => {
        const state = engine.getState();

        expect(state.coherence).toBe(0);
        expect(state.entropy).toBe(1.0);
        expect(state.abstractionLevel).toBe(1.0);
        expect(state.dominantConcept).toBeNull();
        expect(state.conceptConfidence).toBe(0);
        expect(state.emotionalValence).toBe(0);
        expect(state.arousal).toBe(0);
        expect(state.timeSinceLastUtterance).toBe(0);
        expect(state.breathingPhase).toBe(0);
        expect(state.morphTargetBlend).toBe(1.0);
        expect(state.idleTimeout).toBe(300);
    });

    it('getNoiseAmplitude returns base value initially', () => {
        expect(engine.getNoiseAmplitude()).toBe(0.15);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: AROUSAL FROM AUDIO
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — Arousal', () => {
    it('arousal = 0 with silent audio', () => {
        engine.update(0.016, silentAudio(), null);
        expect(engine.getState().arousal).toBe(0);
    });

    it('arousal = average of energy and urgency', () => {
        engine.update(0.016, activeAudio(0.6, 0.4), null);
        // (0.6 + 0.4) / 2 = 0.5
        expect(engine.getState().arousal).toBeCloseTo(0.5, 2);
    });

    it('arousal is clamped to [0, 1]', () => {
        engine.update(0.016, activeAudio(1.0, 1.0), null);
        expect(engine.getState().arousal).toBeLessThanOrEqual(1.0);

        engine.update(0.016, activeAudio(0.0, 0.0), null);
        expect(engine.getState().arousal).toBeGreaterThanOrEqual(0.0);
    });

    it('arousal responds to energy changes', () => {
        engine.update(0.016, activeAudio(0.2, 0.0), null);
        const low = engine.getState().arousal;

        engine.update(0.016, activeAudio(0.9, 0.0), null);
        const high = engine.getState().arousal;

        expect(high).toBeGreaterThan(low);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: TIME-SINCE-LAST-UTTERANCE
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — Utterance Timer', () => {
    it('timeSinceLastUtterance accumulates with deltaTime', () => {
        engine.update(1.0, silentAudio(), null);
        expect(engine.getState().timeSinceLastUtterance).toBeCloseTo(1.0, 2);

        engine.update(2.0, silentAudio(), null);
        expect(engine.getState().timeSinceLastUtterance).toBeCloseTo(3.0, 2);
    });

    it('registerSpeech resets timeSinceLastUtterance to 0', () => {
        engine.update(5.0, silentAudio(), null);
        expect(engine.getState().timeSinceLastUtterance).toBeCloseTo(5.0, 2);

        engine.registerSpeech();
        expect(engine.getState().timeSinceLastUtterance).toBe(0);
    });

    it('timer resumes after registerSpeech', () => {
        engine.update(5.0, silentAudio(), null);
        engine.registerSpeech();
        engine.update(2.0, silentAudio(), null);

        expect(engine.getState().timeSinceLastUtterance).toBeCloseTo(2.0, 2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: IDLE BEHAVIOR
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — Idle Behavior', () => {
    it('morphTargetBlend stays 1.0 before idle timeout', () => {
        // Simulate 299 seconds (just under 300s timeout)
        engine.update(299, silentAudio(), null);
        expect(engine.getState().morphTargetBlend).toBe(1.0);
    });

    it('morphTargetBlend decays after idle timeout', () => {
        // Push past idle timeout
        engine.update(301, silentAudio(), null);
        // After 1 second past timeout, blend should decrease by 0.1
        engine.update(1.0, silentAudio(), null);

        expect(engine.getState().morphTargetBlend).toBeLessThan(1.0);
    });

    it('morphTargetBlend floors at 0.0', () => {
        // Way past timeout
        engine.update(400, silentAudio(), null);
        // 10 seconds of decay at 0.1/s = fully decayed
        for (let i = 0; i < 20; i++) {
            engine.update(1.0, silentAudio(), null);
        }

        expect(engine.getState().morphTargetBlend).toBe(0);
    });

    it('noise amplitude increases during idle', () => {
        // Before idle
        const baseNoise = engine.getNoiseAmplitude();
        expect(baseNoise).toBe(0.15);

        // Push into idle and decay morph blend
        engine.update(301, silentAudio(), null);
        engine.update(5, silentAudio(), null);

        expect(engine.getNoiseAmplitude()).toBeGreaterThan(0.15);
    });

    it('noise amplitude resets when not idle', () => {
        // Go idle
        engine.update(301, silentAudio(), null);
        engine.update(5, silentAudio(), null);
        expect(engine.getNoiseAmplitude()).toBeGreaterThan(0.15);

        // Come back from idle
        engine.registerSpeech();
        engine.update(0.016, silentAudio(), null);
        expect(engine.getNoiseAmplitude()).toBe(0.15);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: SEMANTIC STATE INTEGRATION
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — Semantic Integration', () => {
    it('tracks dominantConcept from semantic state', () => {
        engine.update(0.016, silentAudio(), concreteSemanticState({ dominantWord: 'ocean' }));
        expect(engine.getState().dominantConcept).toBe('ocean');
    });

    it('tracks emotionalValence from semantic sentiment', () => {
        engine.update(0.016, silentAudio(), concreteSemanticState({ sentiment: -0.6 }));
        expect(engine.getState().emotionalValence).toBe(-0.6);
    });

    it('tracks conceptConfidence from semantic confidence', () => {
        engine.update(0.016, silentAudio(), concreteSemanticState({ confidence: 0.95 }));
        expect(engine.getState().conceptConfidence).toBe(0.95);
    });

    it('entropy = 1 - confidence (clamped)', () => {
        engine.update(0.016, silentAudio(), concreteSemanticState({ confidence: 0.8 }));
        expect(engine.getState().entropy).toBeCloseTo(0.2, 2);
    });

    it('null semantic state resets to defaults', () => {
        engine.update(0.016, silentAudio(), concreteSemanticState());
        // Verify non-null state
        expect(engine.getState().dominantConcept).toBe('horse');

        // Pass null
        engine.update(0.016, silentAudio(), null);
        expect(engine.getState().entropy).toBe(1.0);
        expect(engine.getState().dominantConcept).toBeNull();
        expect(engine.getState().conceptConfidence).toBe(0);
        expect(engine.getState().emotionalValence).toBe(0);
    });

    it('abstraction level smoothly interpolates toward target', () => {
        // Initial abstraction is 1.0, semantic target is 0.2
        engine.update(0.016, silentAudio(), concreteSemanticState({ abstractionLevel: 0.2 }));

        // After one frame, should have moved TOWARD 0.2 but not arrived
        const afterOneFrame = engine.getState().abstractionLevel;
        expect(afterOneFrame).toBeLessThan(1.0);
        expect(afterOneFrame).toBeGreaterThan(0.2);

        // After many frames, should converge
        for (let i = 0; i < 100; i++) {
            engine.update(0.1, silentAudio(), concreteSemanticState({ abstractionLevel: 0.2 }));
        }
        expect(engine.getState().abstractionLevel).toBeCloseTo(0.2, 1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: BREATHING PHASE
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — Breathing Phase', () => {
    it('breathing phase advances with time', () => {
        engine.update(1.0, silentAudio(), null);
        expect(engine.getState().breathingPhase).toBeGreaterThan(0);
    });

    it('breathing phase wraps around 2π', () => {
        // The phase increments by deltaTime * 0.2 * 2π per update
        // With dt=1.0, that's ~1.257 per update. After 6 updates: ~7.54 > 2π
        for (let i = 0; i < 6; i++) {
            engine.update(1.0, silentAudio(), null);
        }
        // Should have wrapped back
        expect(engine.getState().breathingPhase).toBeLessThan(Math.PI * 2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 7: COHERENCE
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — Coherence', () => {
    it('coherence is near 0 with high abstraction (no semantic)', () => {
        engine.update(0.016, silentAudio(), null);
        // abstraction=1.0 → coherence ≈ 0
        expect(engine.getState().coherence).toBeCloseTo(0, 1);
    });

    it('coherence increases as abstraction decreases', () => {
        // Run many frames to converge abstraction toward 0.2
        for (let i = 0; i < 100; i++) {
            engine.update(0.1, silentAudio(), concreteSemanticState({ abstractionLevel: 0.2 }));
        }

        expect(engine.getState().coherence).toBeGreaterThan(0.5);
    });

    it('coherence is clamped to [0, 1]', () => {
        for (let i = 0; i < 200; i++) {
            engine.update(0.1, silentAudio(), concreteSemanticState({ abstractionLevel: 0.0 }));
        }

        const coherence = engine.getState().coherence;
        expect(coherence).toBeGreaterThanOrEqual(0);
        expect(coherence).toBeLessThanOrEqual(1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 8: DEFENSIVE COPY
// ══════════════════════════════════════════════════════════════════════

describe('WorkspaceEngine — State Isolation', () => {
    it('getState returns a copy, not the internal reference', () => {
        const state1 = engine.getState();
        engine.update(1.0, silentAudio(), null);
        const state2 = engine.getState();

        // state1 should NOT have been mutated by the update
        expect(state1.timeSinceLastUtterance).toBe(0);
        expect(state2.timeSinceLastUtterance).toBeCloseTo(1.0, 2);
    });

    it('mutating returned state does not affect engine', () => {
        const state = engine.getState();
        state.arousal = 999;

        expect(engine.getState().arousal).toBe(0);
    });
});
