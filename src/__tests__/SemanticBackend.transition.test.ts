/**
 * SemanticBackend.transition.test.ts — Tests for S12 Transition Choreography.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * The dissolve→reform→settle phase machine that creates intentional,
 * organic shape transitions instead of just letting spring forces pull.
 *
 *   1. Phase sequencing: morph → dissolve → reform → settle → idle
 *   2. Mid-transition interruption: new word during dissolve/settle
 *   3. Audio-responsive timing: high energy → shorter phases
 *   4. Idle decay: 300s silence → 30s gradual return to ring
 *   5. Transition overrides are cleaned up on dispose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticBackend, TransitionPhase } from '../services/SemanticBackend';
import { KeywordClassifier } from '../services/KeywordClassifier';
import type { TranscriptEvent } from '../services/SpeechEngine';

// ── MOCK FACTORIES ───────────────────────────────────────────────────

function createMockSpeechEngine() {
    let capturedCallback: ((event: TranscriptEvent) => void) | null = null;

    return {
        onTranscript: vi.fn((cb: (event: TranscriptEvent) => void) => {
            capturedCallback = cb;
            return () => { capturedCallback = null; };
        }),
        pushTranscript(text: string, isFinal = true) {
            if (capturedCallback) {
                capturedCallback({
                    text,
                    isFinal,
                    timestamp: Date.now(),
                });
            }
        },
    } as any;
}

function createMockParticleSystem() {
    return {
        setTarget: vi.fn(),
        morphTargets: { hasTarget: vi.fn().mockReturnValue(false) },
        velocityVariable: {
            material: { uniforms: { uDelta: { value: 0.016 } } }
        },
    } as any;
}

function createMockUniformBridge() {
    return {
        sentimentOverride: null as number | null,
        abstractionOverride: null as number | null,
        noiseOverride: null as number | null,
        emotionalIntensityOverride: null as number | null,
        springOverride: null as number | null,
    } as any;
}

function createMockAudioEngine(energy = 0.5) {
    return {
        getFeatures: vi.fn().mockReturnValue({
            energy,
            tension: 0.3, urgency: 0.4, breathiness: 0.2,
            flatness: 0.1, textureComplexity: 0.6, rolloff: 0.7,
            pitch: 0, pitchDeviation: 0, pitchConfidence: 0,
        }),
    } as any;
}


// ── SETUP ────────────────────────────────────────────────────────────
let mockSpeech: ReturnType<typeof createMockSpeechEngine>;
let classifier: KeywordClassifier;
let mockParticles: ReturnType<typeof createMockParticleSystem>;
let mockBridge: ReturnType<typeof createMockUniformBridge>;
let mockAudio: ReturnType<typeof createMockAudioEngine>;
let backend: SemanticBackend;

beforeEach(() => {
    mockSpeech = createMockSpeechEngine();
    classifier = new KeywordClassifier();
    mockParticles = createMockParticleSystem();
    mockBridge = createMockUniformBridge();
    mockAudio = createMockAudioEngine();
    backend = new SemanticBackend(
        mockSpeech,
        classifier,
        mockParticles,
        mockBridge,
        null, // sessionLogger
        null, // serverClient
        mockAudio,
    );
});

/**
 * Helper: advance time by running update frames.
 */
function advanceTime(seconds: number) {
    const frames = Math.ceil(seconds / 0.016);
    for (let i = 0; i < frames; i++) backend.update(0.016);
}


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: PHASE SEQUENCING
// ══════════════════════════════════════════════════════════════════════

describe('Transition Choreography — Phase Sequencing', () => {
    it('starts in Idle phase', () => {
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Idle);
    });

    it('morph triggers Dissolve phase', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);

        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Dissolve);
    });

    it('Dissolve → Reform → Settle → Idle sequence completes', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);

        // Should be in Dissolve
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Dissolve);

        // Advance past Dissolve (0.3s default)
        advanceTime(0.35);
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Reform);

        // Advance past Reform (0.7s default)
        advanceTime(0.75);
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Settle);

        // Advance past Settle (0.5s default)
        advanceTime(0.55);
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Idle);
    });

    it('setTarget is called during Reform (not Dissolve)', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);

        // During Dissolve, setTarget should NOT have been called
        expect(mockParticles.setTarget).not.toHaveBeenCalled();

        // After Dissolve completes → Reform starts → setTarget fires
        advanceTime(0.35);
        expect(mockParticles.setTarget).toHaveBeenCalled();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: SPRING AND NOISE OVERRIDES
// ══════════════════════════════════════════════════════════════════════

describe('Transition Choreography — Spring/Noise Overrides', () => {
    it('Dissolve sets low spring and high noise', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);

        expect(mockBridge.springOverride).toBeLessThan(1.0);
        expect(mockBridge.noiseOverride).toBeGreaterThan(0.3);
    });

    it('overrides are cleared after Settle completes', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);

        // Run through entire transition (1.5s total)
        advanceTime(2.0);

        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Idle);
        expect(mockBridge.springOverride).toBeNull();
        expect(mockBridge.noiseOverride).toBeNull();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: MID-TRANSITION INTERRUPTION
// ══════════════════════════════════════════════════════════════════════

describe('Transition Choreography — Mid-Transition Interruption', () => {
    it('new word during Dissolve restarts Dissolve with new target', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Dissolve);

        // Interrupt during Dissolve with a new word
        advanceTime(0.1); // Partway through Dissolve
        mockSpeech.pushTranscript('bird');
        backend.update(0.016);

        // Should restart Dissolve (not advance to Reform)
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Dissolve);
    });

    it('new word during Settle starts new Dissolve', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);

        // Advance to Settle phase
        advanceTime(1.1); // Past Dissolve (0.3) + Reform (0.7)
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Settle);

        // Interrupt during Settle
        mockSpeech.pushTranscript('bird');
        backend.update(0.016);

        // Should start new Dissolve
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Dissolve);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: AUDIO-RESPONSIVE TIMING
// ══════════════════════════════════════════════════════════════════════

describe('Transition Choreography — Audio-Responsive Timing', () => {
    it('high energy produces shorter transition durations', () => {
        // High energy audio
        const highEnergyAudio = createMockAudioEngine(0.9);
        const backend2 = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, null, highEnergyAudio,
        );

        mockSpeech.pushTranscript('horse');
        backend2.update(0.016);

        const durations = backend2.getTransitionDurations();
        // energy=0.9 → scale = 1.5 - 0.9 = 0.6
        expect(durations[0]).toBeLessThan(0.3); // Base dissolve
        expect(durations[1]).toBeLessThan(0.7); // Base reform
        expect(durations[2]).toBeLessThan(0.5); // Base settle
    });

    it('low energy produces longer transition durations', () => {
        const lowEnergyAudio = createMockAudioEngine(0.1);
        const backend2 = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, null, lowEnergyAudio,
        );

        mockSpeech.pushTranscript('horse');
        backend2.update(0.016);

        const durations = backend2.getTransitionDurations();
        // energy=0.1 → scale = 1.5 - 0.1 = 1.4
        expect(durations[0]).toBeGreaterThan(0.3); // Base dissolve
        expect(durations[1]).toBeGreaterThan(0.7); // Base reform
        expect(durations[2]).toBeGreaterThan(0.5); // Base settle
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: IDLE DECAY (30s GRADUAL)
// ══════════════════════════════════════════════════════════════════════

describe('Transition Choreography — Idle Decay', () => {
    it('300s silence triggers gradual idle decay', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);
        advanceTime(2.0); // Complete transition

        // Accumulate silence past 300s threshold using 1s steps
        // (avoid huge dt that would complete decay in one frame)
        for (let i = 0; i < 302; i++) backend.update(1.0);

        expect(backend.isIdleDecayActive).toBe(true);
    });

    it('idle decay applies springOverride during decay', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);
        advanceTime(2.0);
        mockBridge.springOverride = null;

        // Accumulate silence past threshold
        for (let i = 0; i < 302; i++) backend.update(1.0);

        expect(mockBridge.springOverride).not.toBeNull();
    });

    it('idle decay completes and sets target to ring after 30s', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);
        advanceTime(2.0);

        // Trigger idle decay
        backend.update(301);

        // Run 31 seconds of frames
        for (let i = 0; i < 62; i++) backend.update(0.5);

        expect(mockParticles.setTarget).toHaveBeenCalledWith('ring');
        expect(backend.isIdleDecayActive).toBe(false);
    });

    it('speech during idle decay cancels it', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);
        advanceTime(2.0);

        // Accumulate silence past threshold
        for (let i = 0; i < 302; i++) backend.update(1.0);
        expect(backend.isIdleDecayActive).toBe(true);

        // Speech arrives — should cancel idle decay
        mockSpeech.pushTranscript('bird');
        backend.update(0.016);

        expect(backend.isIdleDecayActive).toBe(false);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: DISPOSE CLEANUP
// ══════════════════════════════════════════════════════════════════════

describe('Transition Choreography — Dispose', () => {
    it('dispose clears transition overrides', () => {
        mockSpeech.pushTranscript('horse');
        backend.update(0.016);
        expect(mockBridge.springOverride).not.toBeNull();

        backend.dispose();

        expect(mockBridge.springOverride).toBeNull();
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Idle);
    });
});
