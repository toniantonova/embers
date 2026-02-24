/**
 * sentiment.ts — Text sentiment scoring for the animation pipeline.
 *
 * RELATIONSHIP TO EXISTING EMOTION PIPELINE:
 * ───────────────────────────────────────────
 * The project has TWO independent emotion signals that feed into the shader:
 *
 *   1. PROSODIC (audio-based):
 *      SER worker → wav2vec2 → valence/arousal/dominance → audio uniforms [2–5]
 *      Detects HOW something is said (tone, pitch, energy).
 *
 *   2. TEXTUAL (this file):
 *      SpeechEngine transcript → computeSentiment() → audio uniforms [7] textSentiment
 *      Detects WHAT is said (word meaning, negation, intensity).
 *
 * These are complementary, not redundant. Someone can say "I'm fine" angrily
 * (positive text, negative prosody) or "that's terrible" cheerfully (negative
 * text, positive prosody). The shader receives both signals on separate uniform
 * slots and can blend them as needed.
 *
 * This module fills the `textSentiment` slot [7] in AudioUniforms, which is
 * already spec'd and tested in audio-uniforms.ts and AudioUniforms.test.ts.
 *
 * BUILDS ON:
 * ──────────
 * Uses the existing AFINN lexicon in `src/data/sentiment.ts`, adding
 * multi-word averaging, negation handling, and intensity adverb scaling.
 * Does NOT duplicate the lexicon — imports and extends it.
 */

import { AFINN_SUBSET, AFINN_MAX_SCORE } from '../data/sentiment';

// ── NEGATION WORDS ──────────────────────────────────────────────────
const NEGATION_WORDS = new Set([
    'not', "don't", "doesn't", "didn't", "won't", "wouldn't",
    "can't", "couldn't", "shouldn't", "isn't", "aren't",
    "wasn't", "weren't", "no", 'never', 'neither', 'nor',
    "haven't", "hasn't", "hadn't",
]);

// ── INTENSITY MODIFIERS ─────────────────────────────────────────────
const INTENSIFIERS: Record<string, number> = {
    very: 1.5,
    really: 1.3,
    extremely: 1.8,
    incredibly: 1.7,
    absolutely: 1.6,
    deeply: 1.4,
    profoundly: 1.5,
    totally: 1.3,
    utterly: 1.6,
    quite: 1.2,
    so: 1.3,
};

const DIMINISHERS: Record<string, number> = {
    slightly: 0.5,
    somewhat: 0.6,
    barely: 0.3,
    hardly: 0.3,
    mildly: 0.5,
    'a bit': 0.5,
    'a little': 0.6,
    kind: 0.5,  // "kind of"
    sort: 0.5,  // "sort of"
};


// ── MAIN FUNCTION ───────────────────────────────────────────────────

/**
 * Compute the sentiment score for a text string.
 *
 * This value is intended to be written directly to:
 *   audioUniforms.textSentiment = computeSentiment(transcript);
 * which occupies uniform slot [7] in the shader.
 *
 * Algorithm:
 * 1. Tokenize and lowercase
 * 2. For each word, look up AFINN score
 * 3. Apply negation (flip sign if preceded by negation word)
 * 4. Apply intensity modifiers (scale if preceded by intensifier)
 * 5. Average all scoring words, normalize to −1..+1
 *
 * @param text - Input text string
 * @returns Sentiment score from −1.0 to +1.0 (0 = neutral/unknown)
 */
export function computeSentiment(text: string): number {
    if (!text || text.trim().length === 0) return 0;

    const words = text.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean);

    let totalScore = 0;
    let scoringWords = 0;
    let isNegated = false;
    let intensityScale = 1.0;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];

        // Check for negation
        if (NEGATION_WORDS.has(word)) {
            isNegated = true;
            continue;
        }

        // Check for intensity modifiers
        if (INTENSIFIERS[word] !== undefined) {
            intensityScale = INTENSIFIERS[word];
            continue;
        }
        if (DIMINISHERS[word] !== undefined) {
            intensityScale = DIMINISHERS[word];
            continue;
        }

        // Look up sentiment
        const score = AFINN_SUBSET[word];
        if (score !== undefined) {
            let adjustedScore = score * intensityScale;
            if (isNegated) {
                adjustedScore *= -0.75; // Negation partially flips
            }
            totalScore += adjustedScore;
            scoringWords++;
        }

        // Reset modifiers after each content word
        isNegated = false;
        intensityScale = 1.0;
    }

    if (scoringWords === 0) return 0;

    // Average the scores, then normalize to −1..+1
    const average = totalScore / scoringWords;
    return Math.max(-1.0, Math.min(1.0, average / AFINN_MAX_SCORE));
}


/**
 * Quick positive/negative/neutral classification.
 *
 * @param text - Input text string
 * @returns 'positive' | 'negative' | 'neutral'
 */
export function sentimentLabel(text: string): 'positive' | 'negative' | 'neutral' {
    const score = computeSentiment(text);
    if (score > 0.1) return 'positive';
    if (score < -0.1) return 'negative';
    return 'neutral';
}
