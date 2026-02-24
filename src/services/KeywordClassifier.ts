/**
 * KeywordClassifier — Maps transcript text to semantic visual states.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Takes a string of text (from SpeechEngine) and returns a SemanticState
 * describing what morph target to display, how abstract/concrete it should
 * be, the emotional sentiment, and intensity.
 *
 * Example:
 *   classify("the horse is galloping fast")
 *   → {
 *       morphTarget: "quadruped",       // "horse" matched a concrete noun
 *       abstractionLevel: 0.1,          // very concrete — show the shape clearly
 *       sentiment: 0,                   // no sentiment words found
 *       emotionalIntensity: 0.75,       // "galloping" modifier (1.5) boosted it
 *       dominantWord: "horse",          // the word that triggered the match
 *       confidence: 0.9                 // concrete noun = high confidence
 *     }
 *
 * WHY DICTIONARY LOOKUP (vs ML)?
 * ──────────────────────────────
 * 1. **Zero latency** — no model inference, no network call
 * 2. **Fully deterministic** — same input always gives same output
 * 3. **Interpretable** — you can see exactly why "horse" → quadruped
 * 4. **Tiny bundle** — ~5KB of word lists vs ~50MB+ for a transformer
 * 5. **No dependencies** — no TensorFlow.js, no ONNX runtime
 *
 * The tradeoff is coverage: we only recognize words in our dictionary.
 * But for a creative performance tool, curated vocabulary is intentional.
 *
 * ARCHITECTURE:
 * ─────────────
 * This implements the SemanticBackend interface, which abstracts the
 * classification strategy. This allows swapping to an ML backend later
 * (e.g., Transformers.js with a small sentiment model) without changing
 * the consumer code. All consumers just call backend.classify(text).
 *
 * PRIORITY ORDER:
 * ───────────────
 * When multiple keyword types match, we prioritize:
 *   1. Concrete nouns (highest — user said a specific thing)
 *   2. Abstract concepts (medium — user expressed an idea)
 *   3. Default (lowest — no keywords found, keep current state)
 */

import { CONCRETE_NOUNS, ABSTRACT_CONCEPTS, ACTION_MODIFIERS } from '../data/keywords';
import type { KeywordMapping } from '../data/keywords';
import { AFINN_SUBSET, AFINN_MAX_SCORE, WORD_AROUSAL } from '../data/sentiment';

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/**
 * SemanticState — The output of classification.
 *
 * This is the "semantic fingerprint" of a piece of speech. Every field
 * maps to a visual parameter:
 *
 *   morphTarget       → which shape to morph to (ParticleSystem.setTarget)
 *   abstractionLevel  → how literally to render (0 = photorealistic, 1 = moody)
 *   sentiment         → warm/cool color shift, attraction/repulsion
 *   emotionalIntensity → amplitude/speed of particle motion
 *   dominantWord      → for debug display / UI feedback
 *   confidence        → how much to weight this state vs the current one
 */
export interface SemanticState {
    morphTarget: string;
    abstractionLevel: number;   // 0.0 (concrete) → 1.0 (abstract)
    sentiment: number;          // −1.0 (negative) → +1.0 (positive)
    emotionalIntensity: number; // 0.0 (calm) → 1.0 (intense)
    dominantWord: string;       // the keyword that triggered this classification
    confidence: number;         // 0.0 (guessing) → 1.0 (exact match)
}

/**
 * SemanticBackend — The interface any classification strategy must implement.
 *
 * This abstraction exists so we can swap classification strategies without
 * changing any consumer code. Possible backends:
 *   - KeywordClassifier (this file) — dictionary lookup, instant
 *   - TransformerBackend (future)   — Transformers.js, ~100ms
 *   - HybridBackend (future)        — keyword first, ML fallback
 *
 * The `name` field is for debugging/UI display.
 */
export interface SemanticBackend {
    classify(text: string): SemanticState;
    name: string;
}


// ══════════════════════════════════════════════════════════════════════
// KEYWORD CLASSIFIER
// ══════════════════════════════════════════════════════════════════════

export class KeywordClassifier implements SemanticBackend {
    // ── Public identifier for debugging / UI ─────────────────────────
    readonly name = 'KeywordClassifier';

    /**
     * classify — Main entry point. Takes raw text, returns a SemanticState.
     *
     * Algorithm:
     * 1. Normalize: lowercase, split into words, strip punctuation
     * 2. Scan for concrete nouns (highest priority)
     * 3. Scan for abstract concepts (if no concrete match)
     * 4. Compute sentiment from AFINN lexicon
     * 5. Detect action modifiers → adjust emotional intensity
     * 6. Return the best match (or a low-confidence default)
     *
     * The entire method is synchronous — no async, no Promises.
     * On modern hardware, classify() takes <0.1ms for typical sentences.
     */
    classify(text: string): SemanticState {
        // ── STEP 1: Normalize ────────────────────────────────────────
        // Lowercase everything, strip punctuation, split on whitespace.
        // We keep only alphabetic characters to avoid "horse." not matching "horse".
        const words = text
            .toLowerCase()
            .replace(/[^a-z\s]/g, '')  // strip everything except letters and spaces
            .split(/\s+/)              // split on any whitespace
            .filter(w => w.length > 0); // remove empty strings from split

        // ── STEP 2: Scan for keywords ────────────────────────────────
        // We iterate through all words and collect matches.
        // `bestMatch` holds the highest-priority keyword found.
        // Priority: concrete noun > abstract concept.
        let bestMatch: {
            word: string;
            target: string;
            abstraction: number;
            priority: number;  // 2 = concrete, 1 = abstract
        } | null = null;

        for (const word of words) {
            // Check concrete nouns first (priority 2)
            if (CONCRETE_NOUNS[word]) {
                const mapping = CONCRETE_NOUNS[word];
                // Only upgrade if this is higher priority or first match
                if (!bestMatch || bestMatch.priority < 2) {
                    bestMatch = {
                        word,
                        target: mapping.target,
                        abstraction: mapping.abstraction,
                        priority: 2,
                    };
                }
            }
            // Check abstract concepts (priority 1)
            else if (ABSTRACT_CONCEPTS[word]) {
                const mapping = ABSTRACT_CONCEPTS[word];
                if (!bestMatch || bestMatch.priority < 1) {
                    bestMatch = {
                        word,
                        target: mapping.target,
                        abstraction: mapping.abstraction,
                        priority: 1,
                    };
                }
            }
        }

        // ── STEP 3: Compute sentiment ────────────────────────────────
        // Sum AFINN scores for all recognized words, then average.
        // We average instead of sum so "happy happy happy" doesn't
        // saturate the sentiment — it should feel "very happy" (0.6),
        // not "unrealistically happy" (1.8 → clamped to 1.0).
        let sentimentSum = 0;
        let sentimentCount = 0;

        for (const word of words) {
            if (AFINN_SUBSET[word] !== undefined) {
                sentimentSum += AFINN_SUBSET[word];
                sentimentCount++;
            }
        }

        // Normalize to −1 to +1. If no sentiment words found, default to 0.
        const sentiment = sentimentCount > 0
            ? Math.max(-1, Math.min(1, (sentimentSum / sentimentCount) / AFINN_MAX_SCORE))
            : 0;

        // ── STEP 4: Check action modifiers ───────────────────────────
        // Action modifiers affect emotional intensity.
        // Base intensity is 0.5 (neutral). Modifiers scale it.
        // If multiple modifiers are found, we use the most extreme one.
        let intensityMultiplier = 1.0;
        let hasModifier = false;

        for (const word of words) {
            if (ACTION_MODIFIERS[word] !== undefined) {
                const modifier = ACTION_MODIFIERS[word];
                // Take the most extreme modifier (furthest from 1.0)
                if (!hasModifier || Math.abs(modifier - 1.0) > Math.abs(intensityMultiplier - 1.0)) {
                    intensityMultiplier = modifier;
                    hasModifier = true;
                }
            }
        }

        // Apply modifier to base intensity and clamp to 0–1 range.
        // Base intensity: 0.5 if a keyword was found, 0.1 if not.
        const baseIntensity = bestMatch ? 0.5 : 0.1;
        let emotionalIntensity = Math.max(0, Math.min(1, baseIntensity * intensityMultiplier));

        // ── STEP 4b: Derive arousal from sentiment words ─────────
        // Override emotionalIntensity with word-level arousal so the
        // Plutchik wheel can distinguish angry (high) from sad (low).
        // Uses the weighted average arousal of all sentiment-bearing words.
        let arousalSum = 0;
        let arousalCount = 0;
        for (const word of words) {
            if (AFINN_SUBSET[word] !== undefined) {
                const arousal = WORD_AROUSAL[word] ?? 0.5; // default moderate
                arousalSum += arousal;
                arousalCount++;
            }
        }
        if (arousalCount > 0) {
            // Blend word arousal with modifier intensity (word arousal dominates)
            const wordArousal = arousalSum / arousalCount;
            emotionalIntensity = Math.max(emotionalIntensity, wordArousal);
        }

        // ── STEP 5: Assemble the SemanticState ───────────────────────
        if (bestMatch) {
            // We found a keyword — return a confident classification.
            // Confidence is higher for concrete nouns (0.9) than
            // abstract concepts (0.7).
            return {
                morphTarget: bestMatch.target,
                abstractionLevel: bestMatch.abstraction,
                sentiment,
                emotionalIntensity,
                dominantWord: bestMatch.word,
                confidence: bestMatch.priority === 2 ? 0.9 : 0.7,
            };
        }

        // ── STEP 6: Probable noun fallback (DISABLED) ────────────────
        // Previously routed unknown words to the server with confidence 0.5.
        // Disabled: abstract words ("street") triggered shapes that looked
        // wrong. In Complex mode the classifier is bypassed entirely, so this
        // code is unreachable. In Simple mode, unknown words now hold.
        // Re-enable when server shape quality is tuned for single-word prompts.
        //
        // const probableNoun = KeywordClassifier.extractProbableNoun(words);
        // if (probableNoun) {
        //     return {
        //         morphTarget: probableNoun,
        //         abstractionLevel: 0.3,
        //         sentiment,
        //         emotionalIntensity,
        //         dominantWord: probableNoun,
        //         confidence: 0.5,
        //     };
        // }

        // ── STEP 7: Default (nothing found) ──────────────────────────
        // Return a low-confidence state that tells the consumer
        // "I didn't understand this, don't change the current shape."
        // The empty morphTarget signals "keep whatever is currently active."
        return {
            morphTarget: '',           // empty = don't change shape
            abstractionLevel: 0.9,     // high abstraction = loose/ambient
            sentiment,                 // we may still have sentiment data
            emotionalIntensity,        // modifiers may still have been found
            dominantWord: '',          // no keyword matched
            confidence: 0.1,           // very low — almost a no-op
        };
    }

    /**
     * Look up the full KeywordMapping for a word, including hierarchy data.
     * Returns null if the word is not in any dictionary.
     */
    lookupKeyword(word: string): KeywordMapping | null {
        const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
        return CONCRETE_NOUNS[normalized] || ABSTRACT_CONCEPTS[normalized] || null;
    }

    /**
     * Extract sentiment and emotional intensity ONLY — no keyword/dictionary
     * lookup, no morphTarget resolution.
     *
     * Used in Complex mode where the classifier is bypassed for shape routing
     * (full phrases go to server), but we still want AFINN sentiment scoring
     * and action modifier intensity for driving color + movement.
     */
    classifySentimentOnly(text: string): Pick<SemanticState, 'sentiment' | 'emotionalIntensity'> {
        const words = text
            .toLowerCase()
            .replace(/[^a-z\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 0);

        // AFINN sentiment scoring (same as classify Step 3)
        let sentimentSum = 0;
        let sentimentCount = 0;
        for (const word of words) {
            if (AFINN_SUBSET[word] !== undefined) {
                sentimentSum += AFINN_SUBSET[word];
                sentimentCount++;
            }
        }
        const sentiment = sentimentCount > 0
            ? Math.max(-1, Math.min(1, (sentimentSum / sentimentCount) / AFINN_MAX_SCORE))
            : 0;

        // Action modifier intensity (same as classify Step 4)
        let intensityMultiplier = 1.0;
        let hasModifier = false;
        for (const word of words) {
            if (ACTION_MODIFIERS[word] !== undefined) {
                const modifier = ACTION_MODIFIERS[word];
                if (!hasModifier || Math.abs(modifier - 1.0) > Math.abs(intensityMultiplier - 1.0)) {
                    intensityMultiplier = modifier;
                    hasModifier = true;
                }
            }
        }
        // Base intensity 0.3 for phrase-level classification (no keyword match)
        let emotionalIntensity = Math.max(0, Math.min(1, 0.3 * intensityMultiplier));

        // Word arousal override (same as classify Step 4b)
        let arousalSum = 0;
        let arousalCount = 0;
        for (const word of words) {
            if (AFINN_SUBSET[word] !== undefined) {
                const arousal = WORD_AROUSAL[word] ?? 0.5;
                arousalSum += arousal;
                arousalCount++;
            }
        }
        if (arousalCount > 0) {
            emotionalIntensity = Math.max(emotionalIntensity, arousalSum / arousalCount);
        }

        return { sentiment, emotionalIntensity };
    }

    // ── STOPWORD SET ──────────────────────────────────────────────────
    // Common English words that are never useful as 3D shape prompts.
    // Used to filter non-content words when extracting probable nouns.
    private static readonly STOPWORDS = new Set([
        // Articles & determiners
        'the', 'this', 'that', 'these', 'those', 'some', 'every', 'each',
        // Pronouns
        'they', 'them', 'their', 'there', 'here', 'what', 'which', 'where',
        'when', 'while', 'whom', 'whose', 'with', 'would', 'will', 'were',
        // Prepositions
        'from', 'into', 'onto', 'upon', 'over', 'under', 'about', 'after',
        'before', 'between', 'through', 'around', 'above', 'below', 'along',
        // Conjunctions & connectors
        'also', 'another', 'because', 'been', 'being', 'both',
        // Common verbs (forms that STT frequently outputs)
        'have', 'having', 'does', 'doing', 'done', 'goes', 'going', 'gone',
        'come', 'came', 'coming', 'take', 'took', 'taken', 'make', 'made',
        'give', 'gave', 'given', 'keep', 'kept', 'know', 'knew', 'known',
        'think', 'thought', 'tell', 'told', 'said', 'says', 'just', 'like',
        'very', 'really', 'only', 'much', 'many', 'more', 'most', 'even',
        'than', 'then', 'well', 'back', 'could', 'should', 'want', 'need',
        'seem', 'seems', 'look', 'feel', 'felt', 'find', 'found', 'call',
        'called', 'tried', 'trying', 'turn', 'turned', 'leave', 'left',
        'hear', 'heard', 'help', 'show', 'start', 'began', 'begin',
        // Auxiliary / short function words
        'your', 'you', 'are', 'was', 'not', 'but', 'all', 'can', 'had',
        'her', 'his', 'him', 'how', 'its', 'let', 'may', 'our', 'own',
        'she', 'too', 'use', 'used',
        // Common adjectives not useful as shape prompts
        'good', 'great', 'long', 'little', 'same', 'other', 'such',
        'first', 'last', 'next', 'still', 'right', 'real',
        // Relative/filler verbs (3rd person forms STT outputs)
        'sits', 'eats', 'gets', 'puts', 'runs', 'looks', 'says',
        'goes', 'comes', 'takes', 'makes', 'gives', 'keeps',
        // Common greeting/discourse words that STT captures
        'hello', 'okay', 'yeah', 'sure', 'well', 'actually',
        'really', 'basically', 'literally', 'maybe', 'probably',
    ]);

    /**
     * Extract the most likely noun from a list of words.
     * Returns null if no probable noun is found.
     *
     * Heuristic: longest word > 3 chars that isn't a stopword,
     * a known action modifier, an AFINN sentiment word, or already
     * in our keyword dictionaries. Longer words are more likely to
     * be content nouns suitable as 3D shape prompts.
     */
    static extractProbableNoun(words: string[]): string | null {
        let best: string | null = null;
        let bestLen = 0;

        for (const word of words) {
            if (word.length <= 3) continue;
            if (KeywordClassifier.STOPWORDS.has(word)) continue;
            if (CONCRETE_NOUNS[word]) continue;
            if (ABSTRACT_CONCEPTS[word]) continue;
            if (ACTION_MODIFIERS[word] !== undefined) continue;
            // AFINN sentiment words (happy, terrible, etc.) have emotional
            // meaning but make poor 3D shape prompts — skip them.
            if (AFINN_SUBSET[word] !== undefined) continue;

            if (word.length > bestLen) {
                best = word;
                bestLen = word.length;
            }
        }

        return best;
    }
}
