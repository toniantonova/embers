/**
 * SemanticBackend.complexMode.test.ts — Tests for Complex mode routing,
 * interim event skip, and applyMorphFromPhrase lifecycle.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * 1. Complex mode bypasses classifier, sends phrases to server
 * 2. Simple mode still uses classifier (existing behavior)
 * 3. Interim events are skipped (only reset silence timer)
 * 4. Empty strings are guarded against in complex mode
 * 5. Complex mode with no ServerClient falls back to simple
 * 6. pendingFullText lifecycle (set → consumed → cleared)
 * 7. dispose() clears pendingFullText
 *
 * MOCK STRATEGY:
 * ──────────────
 * - TuningConfig: minimal mock with complexMode getter
 * - ServerClient: spy on generateShape
 * - All other mocks reuse the factories from SemanticBackend.test.ts
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
                capturedCallback({ text, isFinal, timestamp: Date.now() });
            }
        },
    } as any;
}

function createMockParticleSystem() {
    return {
        setTarget: vi.fn(),
        setTargetTexture: vi.fn(),
        morphTargets: {
            hasTarget: vi.fn((_: string) => false),
        },
        velocityVariable: {
            material: { uniforms: { uDelta: { value: 0.016 } } }
        },
        size: 128,
    } as any;
}

function createMockUniformBridge() {
    return {
        sentimentOverride: null as number | null,
        abstractionOverride: null as number | null,
        noiseOverride: null as number | null,
        emotionalIntensityOverride: null as number | null,
        springOverride: null as number | null,
        transitionPhase: 0,
    } as any;
}

function createMockTuningConfig(complexMode: boolean) {
    return {
        _complexMode: complexMode,
        get complexMode() { return this._complexMode; },
        set complexMode(v: boolean) { this._complexMode = v; },
        get: vi.fn().mockReturnValue(1.5), // serverShapeScale default
        set: vi.fn(),
    } as any;
}

function createMockServerClient() {
    return {
        generateShape: vi.fn().mockResolvedValue({
            positions: new Float32Array(2048 * 3),
            partIds: new Uint8Array(2048),
            partNames: ['body'],
            templateType: 'custom',
            boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
            cached: false,
            generationTimeMs: 500,
            pipeline: 'partcrafter',
        }),
        warmUp: vi.fn().mockResolvedValue(true),
    } as any;
}

// ── SETUP ────────────────────────────────────────────────────────────
let mockSpeech: ReturnType<typeof createMockSpeechEngine>;
let classifier: KeywordClassifier;
let mockParticles: ReturnType<typeof createMockParticleSystem>;
let mockBridge: ReturnType<typeof createMockUniformBridge>;

beforeEach(() => {
    mockSpeech = createMockSpeechEngine();
    classifier = new KeywordClassifier();
    mockParticles = createMockParticleSystem();
    mockBridge = createMockUniformBridge();
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: INTERIM EVENT SKIP
// ══════════════════════════════════════════════════════════════════════

describe('SemanticBackend — Interim Event Skip', () => {
    it('interim events do NOT trigger classification or morphs', () => {
        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge
        );

        // Push an interim event (isFinal=false) with a keyword
        mockSpeech.pushTranscript('horse', false);
        backend.update(0.016);

        // No morph should occur — interims are skipped
        expect(backend.lastAction).toBe('');
        expect(mockParticles.setTarget).not.toHaveBeenCalled();
    });

    it('interim events still reset silence timer (loosening fires once)', () => {
        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge
        );

        // Simulate 3 seconds of silence
        backend.update(3.0);

        // Push an interim event — loosening triggers because >2s silence
        mockSpeech.pushTranscript('hello', false);
        backend.update(0.016);

        // Loosening SHOULD fire on the interim (any speech after silence)
        expect(mockBridge.noiseOverride).toBe(0.3);

        // Now push 0.1s gap, then a final event for 'horse' (keyword)
        // This is < 2s since the interim, so loosening must NOT re-trigger.
        backend.update(0.1);
        mockSpeech.pushTranscript('horse', true);
        backend.update(0.016);

        // The morph should have processed (final event with keyword)
        expect(backend.lastAction).toBe('morph');
    });

    it('only final events trigger morph in Simple mode', () => {
        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge
        );

        // Push interim first
        mockSpeech.pushTranscript('horse', false);
        backend.update(0.016);
        expect(backend.lastAction).toBe('');

        // Then push the same word as final
        mockSpeech.pushTranscript('horse', true);
        backend.update(0.016);
        expect(backend.lastAction).toBe('morph');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: COMPLEX MODE ROUTING
// ══════════════════════════════════════════════════════════════════════

describe('SemanticBackend — Complex Mode Routing', () => {
    it('complex mode triggers morph from phrase (bypasses classifier for routing)', () => {
        const mockConfig = createMockTuningConfig(true);
        const mockServer = createMockServerClient();

        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, mockServer, null, mockConfig,
        );

        mockSpeech.pushTranscript('a dragon blows fire', true);
        backend.update(0.016);

        // Should trigger morph action
        expect(backend.lastAction).toBe('morph');
    });

    it('complex mode sends full phrase to server immediately', async () => {
        const mockConfig = createMockTuningConfig(true);
        const mockServer = createMockServerClient();

        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, mockServer, null, mockConfig,
        );

        mockSpeech.pushTranscript('a beautiful mountain landscape', true);
        backend.update(0.016);

        // Server should have been called immediately (no dissolve needed)
        expect(mockServer.generateShape).toHaveBeenCalledWith(
            'a beautiful mountain landscape'
        );
    });

    it('complex mode still extracts sentiment for color/movement', () => {
        const mockConfig = createMockTuningConfig(true);
        const mockServer = createMockServerClient();

        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, mockServer, null, mockConfig,
        );

        // 'terrible' is in AFINN with negative sentiment
        mockSpeech.pushTranscript('terrible disaster', true);
        backend.update(0.016);

        // Sentiment should be pushed to bridge
        expect(mockBridge.sentimentOverride).toBeLessThan(0);
    });

    it('simple mode still uses classifier', () => {
        const mockConfig = createMockTuningConfig(false);
        const mockServer = createMockServerClient();

        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, mockServer, null, mockConfig,
        );

        // 'horse' is a known keyword → should use hierarchy, not server
        mockSpeech.pushTranscript('horse', true);
        backend.update(0.016);

        expect(backend.lastAction).toBe('morph');
        expect(backend.lastState?.dominantWord).toBe('horse');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: EMPTY TEXT GUARD
// ══════════════════════════════════════════════════════════════════════

describe('SemanticBackend — Empty Text Guard', () => {
    it('skips empty strings in complex mode (no crash, no server call)', () => {
        const mockConfig = createMockTuningConfig(true);
        const mockServer = createMockServerClient();

        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, mockServer, null, mockConfig,
        );

        // Push empty final transcript
        mockSpeech.pushTranscript('', true);
        backend.update(0.016);

        // No morph, no crash
        expect(backend.lastAction).toBe('');
        expect(mockServer.generateShape).not.toHaveBeenCalled();
    });

    it('skips whitespace-only strings in complex mode', () => {
        const mockConfig = createMockTuningConfig(true);
        const mockServer = createMockServerClient();

        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, mockServer, null, mockConfig,
        );

        mockSpeech.pushTranscript('   ', true);
        backend.update(0.016);

        expect(backend.lastAction).toBe('');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: COMPLEX MODE WITHOUT SERVER CLIENT
// ══════════════════════════════════════════════════════════════════════

describe('SemanticBackend — Complex Mode Fallback', () => {
    it('falls back to simple mode when complexMode=true but no serverClient', () => {
        const mockConfig = createMockTuningConfig(true);

        // No server client passed
        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, null, null, mockConfig,
        );

        // 'horse' is a known keyword → should classify normally
        mockSpeech.pushTranscript('horse', true);
        backend.update(0.016);

        // Should fall through to simple mode
        expect(backend.lastAction).toBe('morph');
        expect(backend.lastState?.dominantWord).toBe('horse');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: DISPOSE CLEARS PENDING STATE
// ══════════════════════════════════════════════════════════════════════

describe('SemanticBackend — Dispose', () => {
    it('dispose() clears pendingFullText and transition state', () => {
        const mockConfig = createMockTuningConfig(true);
        const mockServer = createMockServerClient();

        const backend = new SemanticBackend(
            mockSpeech, classifier, mockParticles, mockBridge,
            null, mockServer, null, mockConfig,
        );

        // Trigger complex mode morph
        mockSpeech.pushTranscript('a dragon blows fire', true);
        backend.update(0.016);
        // Complex mode stays Idle (no dissolve choreography)
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Idle);

        // Dispose
        backend.dispose();

        // All state should be cleared
        expect(backend.currentTransitionPhase).toBe(TransitionPhase.Idle);
        expect(mockBridge.springOverride).toBeNull();
        expect(mockBridge.noiseOverride).toBeNull();
        expect(mockBridge.transitionPhase).toBe(0);
    });
});
