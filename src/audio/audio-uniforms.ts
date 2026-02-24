/**
 * AudioUniforms — Aggregates audio features into a GPU-ready uniform buffer.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Combines the frame-rate AudioFeatures (from AudioEngine), periodic
 * EmotionState (from SER Worker), and NLP text sentiment into a single
 * Float32Array(16) ready for GPU uniform upload.
 *
 * This supplements (does NOT replace) the existing UniformBridge. The
 * existing UniformBridge continues to drive the current GLSL uniforms
 * (uEnergy, uTension, etc.). This aggregator prepares a new, packed
 * uniform buffer that future shader upgrades (A2) will consume.
 *
 * LAYOUT (16 floats = 64 bytes):
 * ──────────────────────────────
 *   [0]  energy              — Meyda RMS energy (0.0–1.0)
 *   [1]  spectralCentroid    — Meyda normalized (0.0–1.0)
 *   [2]  pitchDeviation      — Pitchy F0 deviation (-1.0 to +1.0)
 *   [3]  pitchConfidence     — Pitchy clarity (0.0–1.0)
 *   [4]  emotionValence      — SER valence (-1.0 to +1.0)
 *   [5]  emotionArousal      — SER arousal (0.0–1.0)
 *   [6]  emotionDominance    — SER dominance (0.0–1.0)
 *   [7]  textSentiment       — NLP sentiment (-1.0 to +1.0)
 *   [8–15] reserved          — zeros (future use / alignment)
 */

import type { AudioFeatures } from '../services/AudioEngine';
import type { EmotionState } from './types';
import { AUDIO_UNIFORM_COUNT, NEUTRAL_EMOTION } from './types';

export class AudioUniforms {
    /** The packed uniform buffer. Reused every frame to avoid GC. */
    private buffer: Float32Array;

    /** The most recent emotion state from SER. Persists between updates. */
    private emotion: EmotionState;

    /** External text sentiment value. Set by the NLP pipeline. */
    private _textSentiment = 0;

    constructor() {
        this.buffer = new Float32Array(AUDIO_UNIFORM_COUNT);
        this.emotion = { ...NEUTRAL_EMOTION };
    }

    // ── UPDATE ────────────────────────────────────────────────────────────

    /**
     * Update the uniform buffer with the latest audio features.
     * Called once per frame from the animation loop.
     *
     * @param features — Current audio features from AudioEngine.getFeatures()
     */
    update(features: AudioFeatures): void {
        this.buffer[0] = features.energy;
        this.buffer[1] = features.tension; // spectralCentroid → tension in our naming
        this.buffer[2] = features.pitchDeviation;
        this.buffer[3] = features.pitchConfidence;
        this.buffer[4] = this.emotion.valence;
        this.buffer[5] = this.emotion.arousal;
        this.buffer[6] = this.emotion.dominance;
        this.buffer[7] = this._textSentiment;
        // [8–15] remain at 0 (reserved)
    }

    /**
     * Get the packed Float32Array for GPU upload.
     * Returns the same reference every frame (no allocation).
     */
    getUniforms(): Float32Array {
        return this.buffer;
    }

    // ── EMOTION STATE ─────────────────────────────────────────────────────

    /**
     * Update the emotion state from SER Worker output.
     * This is called approximately every 2 seconds (asynchronously).
     */
    setEmotion(emotion: EmotionState): void {
        this.emotion = emotion;
    }

    /**
     * Get the current emotion state.
     */
    getEmotion(): Readonly<EmotionState> {
        return this.emotion;
    }

    // ── TEXT SENTIMENT ─────────────────────────────────────────────────────

    /**
     * Set the text sentiment value from NLP analysis.
     * Range: -1.0 (very negative) to +1.0 (very positive).
     */
    set textSentiment(value: number) {
        this._textSentiment = Math.max(-1, Math.min(1, value));
    }

    get textSentiment(): number {
        return this._textSentiment;
    }

    // ── RESET ──────────────────────────────────────────────────────────────

    /**
     * Reset all values to neutral/zero.
     */
    reset(): void {
        this.buffer.fill(0);
        this.emotion = { ...NEUTRAL_EMOTION };
        this._textSentiment = 0;
    }
}
