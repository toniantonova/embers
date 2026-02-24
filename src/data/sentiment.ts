/**
 * sentiment.ts — AFINN-165 lexicon subset for real-time sentiment analysis.
 *
 * WHAT IS AFINN?
 * ──────────────
 * AFINN is a curated list of English words manually scored for sentiment
 * by Finn Årup Nielsen. Each word has an integer score from −5 to +5:
 *   −5 = extremely negative ("bastard", "terrorize")
 *   +5 = extremely positive ("superb", "thrilling")
 *    0 = neutral (not included — why waste space?)
 *
 * WHY A SUBSET?
 * ─────────────
 * The full AFINN-165 has ~3,300 words. We include ~150 of the most
 * commonly spoken words in conversational English. This keeps the bundle
 * small while covering the vast majority of sentiment-carrying speech.
 *
 * HOW IT'S USED:
 * ──────────────
 * The KeywordClassifier sums the raw scores of all recognized words in
 * a transcript, then normalizes to the −1 to +1 range by dividing by
 * the maximum possible magnitude (5). This gives a smooth sentiment
 * gradient that can drive color, physics, or shader parameters.
 *
 * ADDING WORDS:
 * ─────────────
 * Just add a new entry to AFINN_SUBSET. The key is the lowercase word,
 * the value is the raw AFINN score (−5 to +5). The classifier handles
 * normalization automatically.
 */

// ══════════════════════════════════════════════════════════════════════
// AFINN-165 SUBSET
// ══════════════════════════════════════════════════════════════════════
// Raw sentiment scores, −5 (extremely negative) to +5 (extremely positive).
// Words with score 0 are omitted — they don't contribute to sentiment.
//
// Categories are organizational only; the classifier doesn't use them.
// ══════════════════════════════════════════════════════════════════════
export const AFINN_SUBSET: Record<string, number> = {
    // ── Strongly positive (+4 to +5) ─────────────────────────────────
    superb: 5,
    outstanding: 5,
    thrilling: 5,
    breathtaking: 5,
    amazing: 4,
    awesome: 4,
    brilliant: 4,
    excellent: 4,
    fantastic: 4,
    incredible: 4,
    magnificent: 4,
    wonderful: 4,
    spectacular: 4,
    marvelous: 4,

    // ── Moderately positive (+2 to +3) ───────────────────────────────
    love: 3,
    happy: 3,
    beautiful: 3,
    good: 3,
    great: 3,
    joy: 3,
    lovely: 3,
    perfect: 3,
    pleasant: 3,
    smile: 3,
    warm: 2,
    kind: 2,
    like: 2,
    nice: 2,
    fun: 2,
    calm: 2,
    gentle: 2,
    pretty: 2,
    sweet: 2,
    bright: 2,
    cool: 2,
    delight: 3,
    grateful: 3,
    inspire: 3,
    proud: 2,
    safe: 2,
    strong: 2,
    free: 2,
    blessed: 3,
    peaceful: 2,
    magic: 3,
    dream: 2,
    hope: 2,
    win: 2,
    laughing: 2,
    celebrate: 3,
    embrace: 2,
    paradise: 3,
    treasure: 2,
    charm: 2,
    graceful: 3,
    radiant: 3,

    // ── Mildly positive (+1) ─────────────────────────────────────────
    okay: 1,
    fine: 1,
    interesting: 1,
    surprise: 1,
    curious: 1,
    eager: 1,
    wish: 1,

    // ── Mildly negative (−1) ─────────────────────────────────────────
    concern: -1,
    doubt: -1,
    miss: -1,
    weird: -1,
    odd: -1,
    bored: -1,
    tired: -1,
    confused: -1,
    nervous: -1,
    restless: -1,

    // ── Moderately negative (−2 to −3) ───────────────────────────────
    bad: -3,
    sad: -2,
    ugly: -3,
    terrible: -3,
    horrible: -3,
    hate: -3,
    angry: -3,
    pain: -3,
    hurt: -2,
    cry: -2,
    dark: -2,
    fear: -2,
    alone: -2,
    lost: -2,
    broken: -2,
    wrong: -2,
    cold: -2,
    cruel: -3,
    suffer: -3,
    sick: -2,
    lie: -2,
    kill: -3,
    dead: -3,
    death: -3,
    enemy: -2,
    war: -3,
    violent: -3,
    scream: -2,
    dreadful: -3,
    miserable: -3,
    awful: -3,
    disgust: -3,
    anxious: -2,
    desperate: -3,
    grief: -3,
    regret: -2,
    ashamed: -2,
    worthless: -3,
    damage: -2,
    destroy: -3,
    danger: -2,
    toxic: -3,
    nightmare: -3,
    hell: -3,
    curse: -2,

    // ── Strongly negative (−4 to −5) ─────────────────────────────────
    devastating: -4,
    horrific: -4,
    atrocious: -4,
    catastrophe: -4,
    terrorize: -5,
    torture: -4,
    vile: -4,
    abhorrent: -4,
    wretched: -4,
    repulsive: -4,
};

// ══════════════════════════════════════════════════════════════════════
// NORMALIZATION CONSTANT
// ══════════════════════════════════════════════════════════════════════
// The maximum absolute AFINN score is 5. We divide by this to normalize
// individual word scores to the −1 to +1 range. For multi-word
// sentences, the KeywordClassifier averages rather than sums, so
// "happy beautiful day" → (3 + 3 + 0) / 2 = 3 → 3/5 = 0.6
// (only scoring words count toward the average)
// ══════════════════════════════════════════════════════════════════════
export const AFINN_MAX_SCORE = 5;

// ══════════════════════════════════════════════════════════════════════
// WORD AROUSAL LEVELS
// ══════════════════════════════════════════════════════════════════════
// Arousal values (0.0 = calm, 1.0 = intense) for sentiment words.
// Used to distinguish high-arousal emotions (angry, fear, surprise)
// from low-arousal ones (sad, bored, calm) on the Plutchik wheel.
//
// Only words where arousal differs significantly from the default (0.5)
// need entries here. Unlisted words default to 0.5 (moderate arousal).
// ══════════════════════════════════════════════════════════════════════
export const WORD_AROUSAL: Record<string, number> = {
    // ── High arousal (0.7–1.0) — intense, activating ─────────────
    angry: 0.9,
    hate: 0.85,
    scream: 0.95,
    violent: 0.95,
    kill: 0.9,
    war: 0.85,
    destroy: 0.85,
    rage: 0.95,
    fury: 0.95,
    terrible: 0.7,
    horrible: 0.7,
    fear: 0.8,
    danger: 0.8,
    terrorize: 0.95,
    torture: 0.9,
    surprise: 0.85,
    amazing: 0.75,
    awesome: 0.7,
    incredible: 0.75,
    thrilling: 0.85,
    breathtaking: 0.8,
    spectacular: 0.8,
    exciting: 0.85,
    fantastic: 0.7,
    brilliant: 0.7,
    superb: 0.7,
    outstanding: 0.7,
    magnificent: 0.7,
    celebrate: 0.75,
    laughing: 0.7,
    disgusting: 0.65,
    disgust: 0.65,
    repulsive: 0.7,
    vile: 0.75,
    abhorrent: 0.75,
    atrocious: 0.8,
    horrific: 0.85,
    catastrophe: 0.85,
    devastating: 0.8,
    nightmare: 0.75,

    // ── Moderate-high arousal (0.5–0.7) — warm, animated ────────
    // These common positive words were missing, causing them to
    // default to 0.5 and land in the wrong Plutchik wheel region.
    // "happy" at 0.65 places it firmly in the Gold/Yellow zone;
    // "love" at 0.6 keeps it warm but slightly calmer than joy.
    happy: 0.65,
    joy: 0.7,
    love: 0.6,
    wonderful: 0.65,
    beautiful: 0.55,
    good: 0.5,
    great: 0.55,
    lovely: 0.55,
    perfect: 0.6,
    pleasant: 0.45,
    smile: 0.6,
    delight: 0.65,
    grateful: 0.55,
    inspire: 0.6,
    proud: 0.6,
    blessed: 0.55,
    magic: 0.65,
    paradise: 0.6,
    radiant: 0.65,
    graceful: 0.5,
    marvelous: 0.65,
    excellent: 0.7,
    fun: 0.65,
    win: 0.7,
    embrace: 0.55,
    treasure: 0.5,
    charm: 0.55,

    // ── Moderate negative arousal (0.35–0.55) — uneasy ──────────
    bad: 0.45,
    ugly: 0.5,
    cruel: 0.7,
    suffer: 0.5,
    sick: 0.35,
    lie: 0.4,
    dead: 0.35,
    death: 0.4,
    enemy: 0.6,
    dreadful: 0.6,
    awful: 0.55,
    anxious: 0.6,
    desperate: 0.65,
    damage: 0.5,
    toxic: 0.55,
    hell: 0.6,
    curse: 0.55,
    wretched: 0.5,

    // ── Low arousal (0.0–0.3) — calm, subdued ────────────────────
    sad: 0.2,
    alone: 0.15,
    lost: 0.2,
    tired: 0.1,
    bored: 0.1,
    calm: 0.1,
    peaceful: 0.1,
    gentle: 0.15,
    quiet: 0.1,
    lonely: 0.15,
    broken: 0.25,
    hurt: 0.3,
    cry: 0.3,
    grief: 0.25,
    miserable: 0.25,
    worthless: 0.2,
    ashamed: 0.25,
    regret: 0.25,
    cold: 0.2,
    dark: 0.25,
    dream: 0.2,
    hope: 0.25,
    wish: 0.2,
    // Mildly negative — low energy
    concern: 0.3,
    doubt: 0.25,
    miss: 0.2,
    weird: 0.35,
    confused: 0.35,
    nervous: 0.5,
    restless: 0.45,
    // Mildly positive — low energy
    okay: 0.25,
    fine: 0.2,
    interesting: 0.4,
    curious: 0.45,
    eager: 0.55,
    warm: 0.35,
    kind: 0.3,
    nice: 0.35,
    cool: 0.35,
    sweet: 0.4,
    bright: 0.45,
    pretty: 0.4,
    safe: 0.2,
    strong: 0.55,
    free: 0.5,
};

