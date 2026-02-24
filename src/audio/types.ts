/**
 * Audio subsystem shared types.
 *
 * These interfaces define the contracts between the new audio components
 * (pitch extraction, SER, STT manager, uniform aggregator). They extend
 * the existing AudioFeatures interface from AudioEngine.ts — no duplication.
 */

// Re-export the existing interface so consumers can import from one place.
export type { AudioFeatures } from '../services/AudioEngine';

// ═══════════════════════════════════════════════════════════════════════
// PITCH DATA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Real-time pitch (F0) extraction results from Pitchy.
 *
 * Updated every audio frame (~46ms at 44.1kHz / 2048 samples).
 * The McLeod Pitch Method provides both the fundamental frequency
 * and a confidence/clarity score.
 */
export interface PitchData {
    /** Raw fundamental frequency in Hz. 0 when no pitch detected. */
    hz: number;

    /**
     * Normalized deviation from the speaker's baseline pitch.
     * Range: -1.0 (much lower than usual) to +1.0 (much higher).
     * Gated to 0 when confidence < 0.5.
     */
    deviation: number;

    /** Pitch clarity/confidence. 0.0–1.0. Below 0.5 = unreliable. */
    confidence: number;

    /** Running EMA baseline of the speaker's typical F0 (Hz). */
    baseline: number;
}

// ═══════════════════════════════════════════════════════════════════════
// EMOTION STATE (SER)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Speech Emotion Recognition output from wav2vec2-base.
 *
 * Updated every ~2 seconds (one inference per 2-second audio chunk).
 * Between updates, the previous state persists — emotions don't
 * change frame-to-frame.
 */
export interface EmotionState {
    /** Emotional valence. -1.0 (negative/sad) to +1.0 (positive/happy). */
    valence: number;

    /** Arousal / activation level. 0.0 (calm) to 1.0 (excited). */
    arousal: number;

    /** Dominance / control. 0.0 (submissive) to 1.0 (dominant). */
    dominance: number;

    /** Model confidence for this prediction. 0.0–1.0. */
    confidence: number;

    /** Timestamp (Date.now()) when this state was computed. */
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════
// AUDIO UNIFORMS (GPU-ready)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Packed audio data for GPU uniform upload.
 *
 * This is the bridge between the audio subsystem and the shader pipeline.
 * 16 floats = 64 bytes, aligned for WebGL uniform buffer writes.
 *
 * Layout:
 *   [0] energy              - Meyda RMS energy (0.0–1.0)
 *   [1] spectralCentroid    - Meyda normalized (0.0–1.0)
 *   [2] pitchDeviation      - Pitchy F0 deviation (-1.0 to +1.0)
 *   [3] pitchConfidence     - Pitchy clarity (0.0–1.0)
 *   [4] emotionValence      - SER valence (-1.0 to +1.0)
 *   [5] emotionArousal      - SER arousal (0.0–1.0)
 *   [6] emotionDominance    - SER dominance (0.0–1.0)
 *   [7] textSentiment       - NLP sentiment (-1.0 to +1.0)
 *   [8–15] reserved         - zeros (future use / alignment)
 */
export interface AudioUniformLayout {
    energy: number;
    spectralCentroid: number;
    pitchDeviation: number;
    pitchConfidence: number;
    emotionValence: number;
    emotionArousal: number;
    emotionDominance: number;
    textSentiment: number;
}

/** Number of floats in the audio uniform buffer. */
export const AUDIO_UNIFORM_COUNT = 16;

// ═══════════════════════════════════════════════════════════════════════
// STT TIER
// ═══════════════════════════════════════════════════════════════════════

/** Which speech-to-text engine is currently active. */
export type STTTier = 'webspeech' | 'websocket' | 'loading';

/** Status returned by STTManager.getStatus(). */
export interface STTStatus {
    engine: STTTier;
    isListening: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSCRIPT EVENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Canonical transcript event emitted by all STT engines.
 *
 * Both the Web Speech API path and the WebSocket Deepgram path produce
 * this same shape, so consumers don't need to know which engine is active.
 */
export interface TranscriptEvent {
    /** The recognized text (may be partial if isFinal=false). */
    text: string;
    /** true when the engine is confident the utterance is complete. */
    isFinal: boolean;
    /** Date.now() at recognition time. */
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════
// SER WORKER MESSAGES
// ═══════════════════════════════════════════════════════════════════════

/** Message sent from main thread to SER worker. */
export interface SERWorkerRequest {
    type: 'init' | 'process';
    /** 2-second Float32Array audio chunk (only for 'process'). */
    audioData?: Float32Array;
    /** Sample rate of the audio data. */
    sampleRate?: number;
}

/** Message sent from SER worker back to main thread. */
export interface SERWorkerResponse {
    type: 'ready' | 'result' | 'error';
    emotion?: EmotionState;
    error?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// AUDIO WORKLET MESSAGES
// ═══════════════════════════════════════════════════════════════════════

/** Message sent from AudioWorklet to main thread. */
export interface AudioWorkletMessage {
    type: 'audio-frame' | 'ser-chunk';
    /** Raw PCM samples (Float32Array). */
    samples: Float32Array;
    /** Sample rate. */
    sampleRate: number;
}

// ═══════════════════════════════════════════════════════════════════════
// DEFAULT / NEUTRAL STATES
// ═══════════════════════════════════════════════════════════════════════

/** A neutral EmotionState (no emotion detected). */
export const NEUTRAL_EMOTION: Readonly<EmotionState> = {
    valence: 0,
    arousal: 0,
    dominance: 0,
    confidence: 0,
    timestamp: 0,
};

/** A neutral PitchData (no pitch detected). */
export const NEUTRAL_PITCH: Readonly<PitchData> = {
    hz: 0,
    deviation: 0,
    confidence: 0,
    baseline: 0,
};
