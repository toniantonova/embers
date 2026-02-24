/**
 * sentence-parser.ts — NLP sentence parsing using compromise.js.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Extracts structured linguistic information from spoken/typed text:
 *   verb        → the main action word ("run", "jump", "eat")
 *   subject     → who is doing it ("the horse", "a bird")
 *   adverb      → how they do it ("quickly", "slowly", "gracefully")
 *   object      → what they're acting on ("the ball", "food")
 *   preposition → spatial/directional ("to", "over", "through")
 *   targetPart  → specific body part mentioned ("head", "tail", "legs")
 *
 * This sits ABOVE the existing KeywordClassifier (which maps nouns→shapes).
 * sentence-parser handles the verb/adverb/structure layer that KeywordClassifier
 * does not attempt.
 *
 * DATA FLOW:
 * ──────────
 * SpeechEngine transcript → parseSentence() → Tier1Orchestrator
 *                                           → verb  feeds hash lookup
 *                                           → adverb feeds adverb resolver
 *
 * targetPart CONSUMERS:
 * ─────────────────────
 * targetPart is FORWARD-LOOKING for A5/Tier 2. It is extracted now but NOT
 * consumed by the Tier 1 orchestrator. When A5 lands, targetPart will allow
 * sentences like "wag the tail" to override template part_rules and apply
 * a primitive to the named part rather than using the template's glob rules.
 * The Tier 1 orchestrator passes targetPart through in ParsedSentence so
 * downstream consumers can use it when ready.
 *
 * WHY COMPROMISE.JS:
 * ──────────────────
 * - ~200KB bundle, no WASM, no async loading
 * - POS tagging + basic dependency parsing
 * - <1ms for typical sentences
 * - No GPU, no Web Worker needed
 */

import nlp from 'compromise';

// ── TYPES ───────────────────────────────────────────────────────────

/** Structured parse result from sentence analysis. */
export interface ParsedSentence {
    /** Main verb (infinitive form if possible), e.g. "run", "eat" */
    verb: string | null;
    /** Subject noun phrase, e.g. "horse", "the bird" */
    subject: string | null;
    /** Adverb modifier, e.g. "quickly", "slowly" */
    adverb: string | null;
    /** Direct object, e.g. "food", "the ball" */
    object: string | null;
    /** Preposition, e.g. "to", "over", "through" */
    preposition: string | null;
    /**
     * Specific body part mentioned, e.g. "head", "tail".
     * FORWARD-LOOKING: extracted now, consumed by A5/Tier 2 for
     * per-part primitive targeting. Not used by Tier 1 orchestrator.
     */
    targetPart: string | null;
    /** Raw text that was parsed */
    rawText: string;
    /** Parse confidence (0–1) based on how many fields were extracted */
    confidence: number;
}

// ── BODY PART VOCABULARY ────────────────────────────────────────────
// Used to detect targetPart references in speech.

const BODY_PARTS = new Set([
    'head', 'body', 'torso', 'tail', 'neck',
    'leg', 'legs', 'arm', 'arms', 'wing', 'wings',
    'foot', 'feet', 'paw', 'paws', 'claw', 'claws',
    'mouth', 'jaw', 'beak', 'eye', 'eyes',
    'fin', 'fins', 'flipper', 'flippers',
    'horn', 'horns', 'ear', 'ears', 'nose', 'snout',
    'back', 'belly', 'chest', 'spine', 'skull',
    'shoulder', 'hip', 'knee', 'elbow', 'wrist', 'ankle',
]);


// ── MAIN PARSER ─────────────────────────────────────────────────────

/**
 * Parse a sentence into structured linguistic components.
 *
 * Handles:
 *   - Imperative: "run quickly" → verb="run", adverb="quickly"
 *   - Declarative: "the horse runs" → verb="run", subject="horse"
 *   - Bare verbs: "jump" → verb="jump"
 *   - Complex: "make the dog run slowly to the left" → verb="run", subject="dog", adverb="slowly"
 *
 * @param text - Raw text to parse
 * @returns ParsedSentence with extracted components
 */
export function parseSentence(text: string): ParsedSentence {
    const result: ParsedSentence = {
        verb: null,
        subject: null,
        adverb: null,
        object: null,
        preposition: null,
        targetPart: null,
        rawText: text,
        confidence: 0,
    };

    if (!text || text.trim().length === 0) {
        return result;
    }

    const doc = nlp(text.trim());

    // ── VERB EXTRACTION ──────────────────────────────────────────
    // Match individual #Verb tokens (not verb phrases, which include adverbs).
    // Exclude auxiliaries ("is", "has", "will") — we want the content verb.
    const verbTokens = doc.match('#Verb').not('#Auxiliary').not('#Adverb');
    if (verbTokens.found) {
        // Get the first verb token and convert to infinitive
        const firstVerbText = (verbTokens.out('array') as string[])[0];
        const firstVerbDoc = nlp(firstVerbText);
        const infinitive = firstVerbDoc.verbs().toInfinitive().out('text').trim();
        result.verb = (infinitive || firstVerbText).toLowerCase().split(/\s+/)[0];
    }

    // Fallback: if compromise didn't tag anything as a verb, try the first word
    // as a potential imperative (common in spoken commands)
    if (!result.verb) {
        const words = text.trim().toLowerCase().split(/\s+/);
        if (words.length >= 1) {
            const singleDoc = nlp(words[0]);
            if (singleDoc.match('#Verb').found || words.length === 1) {
                result.verb = words[0];
            }
        }
    }

    // ── ADVERB EXTRACTION ────────────────────────────────────────
    const adverbs = doc.adverbs();
    if (adverbs.found) {
        result.adverb = adverbs.out('text').trim().split(/\s+/)[0].toLowerCase();
    }

    // ── SUBJECT EXTRACTION ───────────────────────────────────────
    const nouns = doc.nouns();
    if (nouns.found) {
        const nounList = nouns.out('array') as string[];
        if (nounList.length > 0) {
            result.subject = nounList[0].toLowerCase().replace(/^(the|a|an)\s+/, '');
        }
        if (nounList.length > 1) {
            result.object = nounList[1].toLowerCase().replace(/^(the|a|an)\s+/, '');
        }
    }

    // ── PREPOSITION EXTRACTION ───────────────────────────────────
    const prepositions = doc.match('#Preposition').out('array') as string[];
    if (prepositions.length > 0) {
        result.preposition = prepositions[0].toLowerCase();
    }

    // ── TARGET PART DETECTION ────────────────────────────────────
    // Scan for body part vocabulary in the text.
    // NOTE: targetPart is forward-looking for A5/Tier 2 — not consumed
    // by the Tier 1 orchestrator. See docstring for details.
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
        const cleaned = word.replace(/[^a-z]/g, '');
        if (BODY_PARTS.has(cleaned)) {
            result.targetPart = cleaned;
            break;
        }
    }

    // ── CONFIDENCE CALCULATION ───────────────────────────────────
    let fieldsFound = 0;
    if (result.verb) fieldsFound += 2;       // Verb is worth double
    if (result.subject) fieldsFound += 1;
    if (result.adverb) fieldsFound += 1;
    if (result.object) fieldsFound += 1;
    if (result.preposition) fieldsFound += 0.5;
    if (result.targetPart) fieldsFound += 0.5;
    result.confidence = Math.min(1.0, fieldsFound / 4);

    return result;
}


/**
 * Quick verb-only extraction for fast lookups.
 * Skips full parsing when only the verb is needed.
 *
 * @param text - Raw text to extract verb from
 * @returns Verb in infinitive form, or null
 */
export function extractVerb(text: string): string | null {
    if (!text || text.trim().length === 0) return null;

    const doc = nlp(text.trim());
    const verbTokens = doc.match('#Verb').not('#Auxiliary').not('#Adverb');

    if (verbTokens.found) {
        const firstVerbText = (verbTokens.out('array') as string[])[0];
        const firstVerbDoc = nlp(firstVerbText);
        const inf = firstVerbDoc.verbs().toInfinitive().out('text').trim();
        if (inf) return inf.split(/\s+/)[0].toLowerCase();
        return firstVerbText.toLowerCase();
    }

    // Fallback: first word as potential imperative
    const first = text.trim().split(/\s+/)[0].toLowerCase();
    return first || null;
}
