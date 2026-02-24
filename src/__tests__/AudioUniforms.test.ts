/**
 * AudioUniforms.test.ts — Tests for the GPU uniform aggregator.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * AudioUniforms packs audio features + emotion + sentiment into a
 * Float32Array(16) for GPU upload. We test:
 *   1. Default state is all zeros
 *   2. Buffer has correct length (16)
 *   3. Values are packed in the correct positions
 *   4. Emotion state persists between updates
 *   5. Reset clears all values
 *   6. Text sentiment is clamped to [-1, 1]
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AudioUniforms } from '../audio/audio-uniforms';
import type { AudioFeatures } from '../services/AudioEngine';

let uniforms: AudioUniforms;

// Helper: create a mock AudioFeatures with all zeros + optional overrides
function mockFeatures(overrides: Partial<AudioFeatures> = {}): AudioFeatures {
    return {
        energy: 0,
        tension: 0,
        urgency: 0,
        breathiness: 0,
        flatness: 0,
        textureComplexity: 0,
        rolloff: 0,
        pitch: 0,
        pitchDeviation: 0,
        pitchConfidence: 0,
        ...overrides,
    };
}

beforeEach(() => {
    uniforms = new AudioUniforms();
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: DEFAULT STATE
// ══════════════════════════════════════════════════════════════════════

describe('AudioUniforms — Defaults', () => {
    it('getUniforms() returns Float32Array of length 16', () => {
        const buf = uniforms.getUniforms();
        expect(buf).toBeInstanceOf(Float32Array);
        expect(buf.length).toBe(16);
    });

    it('all values are zero by default', () => {
        const buf = uniforms.getUniforms();
        for (let i = 0; i < 16; i++) {
            expect(buf[i]).toBe(0);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: PACKING LAYOUT
// ══════════════════════════════════════════════════════════════════════

describe('AudioUniforms — Packing', () => {
    it('energy goes to position [0]', () => {
        uniforms.update(mockFeatures({ energy: 0.75 }));
        expect(uniforms.getUniforms()[0]).toBeCloseTo(0.75);
    });

    it('tension (spectralCentroid) goes to position [1]', () => {
        uniforms.update(mockFeatures({ tension: 0.6 }));
        expect(uniforms.getUniforms()[1]).toBeCloseTo(0.6);
    });

    it('pitchDeviation goes to position [2]', () => {
        uniforms.update(mockFeatures({ pitchDeviation: -0.3 }));
        expect(uniforms.getUniforms()[2]).toBeCloseTo(-0.3);
    });

    it('pitchConfidence goes to position [3]', () => {
        uniforms.update(mockFeatures({ pitchConfidence: 0.9 }));
        expect(uniforms.getUniforms()[3]).toBeCloseTo(0.9);
    });

    it('emotionValence goes to position [4]', () => {
        uniforms.setEmotion({
            valence: 0.8, arousal: 0, dominance: 0,
            confidence: 1, timestamp: Date.now(),
        });
        uniforms.update(mockFeatures());
        expect(uniforms.getUniforms()[4]).toBeCloseTo(0.8);
    });

    it('emotionArousal goes to position [5]', () => {
        uniforms.setEmotion({
            valence: 0, arousal: 0.7, dominance: 0,
            confidence: 1, timestamp: Date.now(),
        });
        uniforms.update(mockFeatures());
        expect(uniforms.getUniforms()[5]).toBeCloseTo(0.7);
    });

    it('emotionDominance goes to position [6]', () => {
        uniforms.setEmotion({
            valence: 0, arousal: 0, dominance: 0.6,
            confidence: 1, timestamp: Date.now(),
        });
        uniforms.update(mockFeatures());
        expect(uniforms.getUniforms()[6]).toBeCloseTo(0.6);
    });

    it('textSentiment goes to position [7]', () => {
        uniforms.textSentiment = -0.5;
        uniforms.update(mockFeatures());
        expect(uniforms.getUniforms()[7]).toBeCloseTo(-0.5);
    });

    it('positions [8–15] are reserved (zeros)', () => {
        uniforms.update(mockFeatures({ energy: 1, tension: 1 }));
        uniforms.textSentiment = 1;
        const buf = uniforms.getUniforms();
        for (let i = 8; i < 16; i++) {
            expect(buf[i]).toBe(0);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: EMOTION PERSISTENCE
// ══════════════════════════════════════════════════════════════════════

describe('AudioUniforms — Emotion State', () => {
    it('emotion persists between update() calls', () => {
        uniforms.setEmotion({
            valence: 0.5, arousal: 0.3, dominance: 0.4,
            confidence: 0.9, timestamp: Date.now(),
        });

        // First update
        uniforms.update(mockFeatures());
        expect(uniforms.getUniforms()[4]).toBeCloseTo(0.5);

        // Second update — emotion should persist
        uniforms.update(mockFeatures());
        expect(uniforms.getUniforms()[4]).toBeCloseTo(0.5);
    });

    it('getEmotion() returns current emotion', () => {
        const emotion = {
            valence: 0.2, arousal: 0.8, dominance: 0.5,
            confidence: 0.7, timestamp: 12345,
        };
        uniforms.setEmotion(emotion);

        const result = uniforms.getEmotion();
        expect(result.valence).toBeCloseTo(0.2);
        expect(result.arousal).toBeCloseTo(0.8);
        expect(result.timestamp).toBe(12345);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: TEXT SENTIMENT CLAMPING
// ══════════════════════════════════════════════════════════════════════

describe('AudioUniforms — Text Sentiment', () => {
    it('clamps to -1 at minimum', () => {
        uniforms.textSentiment = -5;
        expect(uniforms.textSentiment).toBe(-1);
    });

    it('clamps to +1 at maximum', () => {
        uniforms.textSentiment = 3;
        expect(uniforms.textSentiment).toBe(1);
    });

    it('passes through values within range', () => {
        uniforms.textSentiment = 0.42;
        expect(uniforms.textSentiment).toBeCloseTo(0.42);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: RESET
// ══════════════════════════════════════════════════════════════════════

describe('AudioUniforms — Reset', () => {
    it('reset() clears all values to zero', () => {
        uniforms.textSentiment = 0.8;
        uniforms.setEmotion({
            valence: 0.5, arousal: 0.3, dominance: 0.4,
            confidence: 0.9, timestamp: Date.now(),
        });
        uniforms.update(mockFeatures({ energy: 0.7, tension: 0.3 }));

        uniforms.reset();

        const buf = uniforms.getUniforms();
        for (let i = 0; i < 16; i++) {
            expect(buf[i]).toBe(0);
        }
        expect(uniforms.textSentiment).toBe(0);
        expect(uniforms.getEmotion().valence).toBe(0);
    });
});
