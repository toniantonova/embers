/**
 * keywords.ts — Curated word → morph target mappings for the KeywordClassifier.
 *
 * WHY DICTIONARY LOOKUPS?
 * ───────────────────────
 * For a creative, real-time speech-to-visual system, we want classification
 * to be:
 *   1. **Instant** — no network round-trip, no model inference time
 *   2. **Interpretable** — you can see exactly why "horse" → quadruped
 *   3. **Tunable** — add/remove words without retraining anything
 *
 * The tradeoff is coverage: we only recognize words in our dictionary.
 * But for a performative art piece, a curated vocabulary is a *feature*,
 * not a limitation — it keeps the mapping intentional and aesthetic.
 *
 * STRUCTURE:
 * ──────────
 * Three tiers of word mappings, each serving a different purpose:
 *
 *   1. CONCRETE_NOUNS — Physical things → specific morph targets
 *      Low abstraction (0.1–0.2). "Horse" clearly means quadruped.
 *
 *   2. ABSTRACT_CONCEPTS — Emotions/ideas → behavioral morph targets
 *      High abstraction (0.5–0.9). "Love" means attraction, not a shape.
 *
 *   3. ACTION_MODIFIERS — Verbs/adjectives → intensity multipliers
 *      These modify HOW the shape behaves, not WHAT the shape is.
 *      Values > 1.0 = more energetic, < 1.0 = calmer.
 *
 * MORPH TARGET REFERENCE (12 available):
 * ──────────────────────────────────────
 * ring, sphere, quadruped, humanoid, scatter, dual-attract,
 * wave, starburst, tree, mountain, building, bird
 */

// ══════════════════════════════════════════════════════════════════════
// TYPE: Each keyword maps to a morph target name and an abstraction
// level. Abstraction tells the rendering system how "literal" to be:
//   0.0 = very concrete (particles form a recognizable shape)
//   1.0 = very abstract (particles behave loosely, more like a mood)
// ══════════════════════════════════════════════════════════════════════
export interface KeywordMapping {
    target: string;
    abstraction: number;
    /** 3-level morph hierarchy: [abstract, mid, specific] */
    hierarchy: [string, string, string];
    /** Labels shown in ghost transcript as crystallization progresses */
    hierarchyLabels: [string, string, string];
}

// ══════════════════════════════════════════════════════════════════════
// TIER 1: CONCRETE NOUNS
// ══════════════════════════════════════════════════════════════════════
// Physical objects and creatures → specific morph targets.
// These are the most "literal" mappings. When someone says "horse",
// they expect to see something horse-like.
//
// We map to the CLOSEST available morph target. E.g., "fish" maps to
// "wave" because we don't have a fish shape, and water is the closest
// visual association.
// ══════════════════════════════════════════════════════════════════════
export const CONCRETE_NOUNS: Record<string, KeywordMapping> = {
    // ── Animals (quadruped) ──────────────────────────────────────────
    horse: { target: 'quadruped', abstraction: 0.1, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'horse'] },
    dog: { target: 'quadruped', abstraction: 0.1, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'dog'] },
    cat: { target: 'quadruped', abstraction: 0.1, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'cat'] },
    wolf: { target: 'quadruped', abstraction: 0.1, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'wolf'] },
    lion: { target: 'quadruped', abstraction: 0.1, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'lion'] },
    tiger: { target: 'quadruped', abstraction: 0.12, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'tiger'] },
    deer: { target: 'quadruped', abstraction: 0.1, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'deer'] },
    bear: { target: 'quadruped', abstraction: 0.12, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'bear'] },
    fox: { target: 'quadruped', abstraction: 0.1, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'fox'] },
    elephant: { target: 'quadruped', abstraction: 0.12, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'animal', 'elephant'] },
    animal: { target: 'quadruped', abstraction: 0.15, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'creature', 'animal'] },
    creature: { target: 'quadruped', abstraction: 0.2, hierarchy: ['sphere', 'quadruped', 'quadruped'], hierarchyLabels: ['...', 'entity', 'creature'] },

    // ── People (humanoid) ────────────────────────────────────────────
    person: { target: 'humanoid', abstraction: 0.1, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'being', 'person'] },
    man: { target: 'humanoid', abstraction: 0.1, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'being', 'man'] },
    woman: { target: 'humanoid', abstraction: 0.1, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'being', 'woman'] },
    child: { target: 'humanoid', abstraction: 0.1, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'being', 'child'] },
    body: { target: 'humanoid', abstraction: 0.12, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'form', 'body'] },
    human: { target: 'humanoid', abstraction: 0.1, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'being', 'human'] },
    dancer: { target: 'humanoid', abstraction: 0.15, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'being', 'dancer'] },
    figure: { target: 'humanoid', abstraction: 0.15, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'form', 'figure'] },
    people: { target: 'humanoid', abstraction: 0.12, hierarchy: ['sphere', 'humanoid', 'humanoid'], hierarchyLabels: ['...', 'beings', 'people'] },

    // ── Water & waves ────────────────────────────────────────────────
    ocean: { target: 'wave', abstraction: 0.1, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'water', 'ocean'] },
    water: { target: 'wave', abstraction: 0.15, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'flow', 'water'] },
    wave: { target: 'wave', abstraction: 0.15, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'flow', 'wave'] },
    river: { target: 'wave', abstraction: 0.15, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'water', 'river'] },
    sea: { target: 'wave', abstraction: 0.1, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'water', 'sea'] },
    rain: { target: 'wave', abstraction: 0.2, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'water', 'rain'] },
    tide: { target: 'wave', abstraction: 0.15, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'water', 'tide'] },
    flood: { target: 'wave', abstraction: 0.15, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'water', 'flood'] },
    fish: { target: 'wave', abstraction: 0.15, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'water', 'fish'] },

    // ── Celestial / light (starburst) ────────────────────────────────
    star: { target: 'starburst', abstraction: 0.1, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'light', 'star'] },
    sun: { target: 'starburst', abstraction: 0.1, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'light', 'sun'] },
    light: { target: 'starburst', abstraction: 0.2, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'glow', 'light'] },
    fire: { target: 'starburst', abstraction: 0.15, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'heat', 'fire'] },
    flame: { target: 'starburst', abstraction: 0.15, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'heat', 'flame'] },
    spark: { target: 'starburst', abstraction: 0.15, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'light', 'spark'] },
    lightning: { target: 'starburst', abstraction: 0.15, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'energy', 'lightning'] },
    moon: { target: 'sphere', abstraction: 0.1, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'celestial', 'moon'] },
    planet: { target: 'sphere', abstraction: 0.1, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'celestial', 'planet'] },
    earth: { target: 'sphere', abstraction: 0.12, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'world', 'earth'] },
    globe: { target: 'sphere', abstraction: 0.1, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'world', 'globe'] },
    ball: { target: 'sphere', abstraction: 0.1, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'object', 'ball'] },
    bubble: { target: 'sphere', abstraction: 0.15, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'air', 'bubble'] },

    // ── Nature ───────────────────────────────────────────────────────
    tree: { target: 'tree', abstraction: 0.1, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'plant', 'tree'] },
    forest: { target: 'tree', abstraction: 0.15, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'nature', 'forest'] },
    flower: { target: 'tree', abstraction: 0.15, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'plant', 'flower'] },
    garden: { target: 'tree', abstraction: 0.15, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'nature', 'garden'] },
    leaf: { target: 'tree', abstraction: 0.12, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'plant', 'leaf'] },
    plant: { target: 'tree', abstraction: 0.12, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'nature', 'plant'] },
    mountain: { target: 'mountain', abstraction: 0.1, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'terrain', 'mountain'] },
    hill: { target: 'mountain', abstraction: 0.12, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'terrain', 'hill'] },
    cliff: { target: 'mountain', abstraction: 0.12, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'terrain', 'cliff'] },
    rock: { target: 'mountain', abstraction: 0.15, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'earth', 'rock'] },
    volcano: { target: 'mountain', abstraction: 0.12, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'terrain', 'volcano'] },

    // ── Structures (building) ────────────────────────────────────────
    house: { target: 'building', abstraction: 0.1, hierarchy: ['sphere', 'building', 'building'], hierarchyLabels: ['...', 'structure', 'house'] },
    building: { target: 'building', abstraction: 0.1, hierarchy: ['sphere', 'building', 'building'], hierarchyLabels: ['...', 'structure', 'building'] },
    tower: { target: 'building', abstraction: 0.1, hierarchy: ['sphere', 'building', 'building'], hierarchyLabels: ['...', 'structure', 'tower'] },
    castle: { target: 'building', abstraction: 0.1, hierarchy: ['sphere', 'building', 'building'], hierarchyLabels: ['...', 'structure', 'castle'] },
    city: { target: 'building', abstraction: 0.15, hierarchy: ['sphere', 'building', 'building'], hierarchyLabels: ['...', 'place', 'city'] },
    wall: { target: 'building', abstraction: 0.15, hierarchy: ['sphere', 'building', 'building'], hierarchyLabels: ['...', 'structure', 'wall'] },
    bridge: { target: 'building', abstraction: 0.12, hierarchy: ['sphere', 'building', 'building'], hierarchyLabels: ['...', 'structure', 'bridge'] },

    // ── Birds ────────────────────────────────────────────────────────
    bird: { target: 'bird', abstraction: 0.1, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'creature', 'bird'] },
    eagle: { target: 'bird', abstraction: 0.1, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'creature', 'eagle'] },
    hawk: { target: 'bird', abstraction: 0.1, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'creature', 'hawk'] },
    dove: { target: 'bird', abstraction: 0.1, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'creature', 'dove'] },
    owl: { target: 'bird', abstraction: 0.1, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'creature', 'owl'] },
    crow: { target: 'bird', abstraction: 0.1, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'creature', 'crow'] },
    wing: { target: 'bird', abstraction: 0.15, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'flight', 'wing'] },
    feather: { target: 'bird', abstraction: 0.15, hierarchy: ['sphere', 'bird', 'bird'], hierarchyLabels: ['...', 'flight', 'feather'] },

    // ── Chaos / destruction (scatter) ────────────────────────────────
    explosion: { target: 'scatter', abstraction: 0.2, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'force', 'explosion'] },
    chaos: { target: 'scatter', abstraction: 0.3, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'force', 'chaos'] },
    destroy: { target: 'scatter', abstraction: 0.3, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'force', 'destroy'] },
    shatter: { target: 'scatter', abstraction: 0.2, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'force', 'shatter'] },
    break: { target: 'scatter', abstraction: 0.25, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'force', 'break'] },
    crash: { target: 'scatter', abstraction: 0.2, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'force', 'crash'] },
    storm: { target: 'scatter', abstraction: 0.25, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'weather', 'storm'] },
    tornado: { target: 'scatter', abstraction: 0.2, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'weather', 'tornado'] },
    wind: { target: 'scatter', abstraction: 0.25, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'weather', 'wind'] },

    // ── Ring / circle ────────────────────────────────────────────────
    ring: { target: 'ring', abstraction: 0.1, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'shape', 'ring'] },
    circle: { target: 'ring', abstraction: 0.1, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'shape', 'circle'] },
    loop: { target: 'ring', abstraction: 0.12, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'shape', 'loop'] },
    orbit: { target: 'ring', abstraction: 0.15, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'path', 'orbit'] },
    halo: { target: 'ring', abstraction: 0.15, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'glow', 'halo'] },
    wheel: { target: 'ring', abstraction: 0.1, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'object', 'wheel'] },
};


// ══════════════════════════════════════════════════════════════════════
// TIER 2: ABSTRACT CONCEPTS
// ══════════════════════════════════════════════════════════════════════
// Emotions, ideas, and states → behavioral morph targets.
// These are higher-abstraction: "love" doesn't look like anything
// specific, but it BEHAVES like attraction (dual-attract).
//
// The abstraction level is 0.5–0.9 because these words are inherently
// non-literal. The rendering system should respond more loosely —
// affecting physics/color/speed rather than shape fidelity.
// ══════════════════════════════════════════════════════════════════════
export const ABSTRACT_CONCEPTS: Record<string, KeywordMapping> = {
    // ── Attraction / connection (dual-attract) ───────────────────────
    // Abstract concepts stay in sphere longer before crystallizing
    love: { target: 'dual-attract', abstraction: 0.8, hierarchy: ['sphere', 'sphere', 'dual-attract'], hierarchyLabels: ['...', 'feeling', 'love'] },
    together: { target: 'dual-attract', abstraction: 0.7, hierarchy: ['sphere', 'sphere', 'dual-attract'], hierarchyLabels: ['...', 'feeling', 'together'] },
    hug: { target: 'dual-attract', abstraction: 0.6, hierarchy: ['sphere', 'dual-attract', 'dual-attract'], hierarchyLabels: ['...', 'touch', 'hug'] },
    embrace: { target: 'dual-attract', abstraction: 0.65, hierarchy: ['sphere', 'dual-attract', 'dual-attract'], hierarchyLabels: ['...', 'touch', 'embrace'] },
    connect: { target: 'dual-attract', abstraction: 0.7, hierarchy: ['sphere', 'sphere', 'dual-attract'], hierarchyLabels: ['...', 'bond', 'connect'] },
    bond: { target: 'dual-attract', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'dual-attract'], hierarchyLabels: ['...', 'tie', 'bond'] },
    unite: { target: 'dual-attract', abstraction: 0.7, hierarchy: ['sphere', 'sphere', 'dual-attract'], hierarchyLabels: ['...', 'joining', 'unite'] },
    hold: { target: 'dual-attract', abstraction: 0.6, hierarchy: ['sphere', 'dual-attract', 'dual-attract'], hierarchyLabels: ['...', 'touch', 'hold'] },

    // ── Dispersion / chaos (scatter) ─────────────────────────────────
    hate: { target: 'scatter', abstraction: 0.8, hierarchy: ['sphere', 'sphere', 'scatter'], hierarchyLabels: ['...', 'emotion', 'hate'] },
    anger: { target: 'scatter', abstraction: 0.75, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'emotion', 'anger'] },
    rage: { target: 'scatter', abstraction: 0.8, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'fury', 'rage'] },
    freedom: { target: 'scatter', abstraction: 0.85, hierarchy: ['sphere', 'sphere', 'scatter'], hierarchyLabels: ['...', 'idea', 'freedom'] },
    fear: { target: 'scatter', abstraction: 0.8, hierarchy: ['sphere', 'sphere', 'scatter'], hierarchyLabels: ['...', 'emotion', 'fear'] },
    anxiety: { target: 'scatter', abstraction: 0.8, hierarchy: ['sphere', 'sphere', 'scatter'], hierarchyLabels: ['...', 'emotion', 'anxiety'] },
    panic: { target: 'scatter', abstraction: 0.75, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'emotion', 'panic'] },
    war: { target: 'scatter', abstraction: 0.7, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'conflict', 'war'] },
    violence: { target: 'scatter', abstraction: 0.75, hierarchy: ['sphere', 'scatter', 'scatter'], hierarchyLabels: ['...', 'conflict', 'violence'] },

    // ── Calm / wholeness (sphere) ────────────────────────────────────
    peace: { target: 'sphere', abstraction: 0.7, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'stillness', 'peace'] },
    calm: { target: 'sphere', abstraction: 0.65, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'stillness', 'calm'] },
    serenity: { target: 'sphere', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'stillness', 'serenity'] },
    harmony: { target: 'sphere', abstraction: 0.7, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'balance', 'harmony'] },
    balance: { target: 'sphere', abstraction: 0.7, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'center', 'balance'] },
    quiet: { target: 'sphere', abstraction: 0.65, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'silence', 'quiet'] },
    still: { target: 'sphere', abstraction: 0.6, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'pause', 'still'] },
    sadness: { target: 'sphere', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'emotion', 'sadness'] },
    sorrow: { target: 'sphere', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'emotion', 'sorrow'] },
    grief: { target: 'sphere', abstraction: 0.8, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'emotion', 'grief'] },
    lonely: { target: 'sphere', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'sphere'], hierarchyLabels: ['...', 'emotion', 'lonely'] },

    // ── Energy / radiance (starburst) ────────────────────────────────
    joy: { target: 'starburst', abstraction: 0.7, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'emotion', 'joy'] },
    happiness: { target: 'starburst', abstraction: 0.7, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'emotion', 'happiness'] },
    energy: { target: 'starburst', abstraction: 0.65, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'force', 'energy'] },
    power: { target: 'starburst', abstraction: 0.7, hierarchy: ['sphere', 'starburst', 'starburst'], hierarchyLabels: ['...', 'force', 'power'] },
    hope: { target: 'starburst', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'starburst'], hierarchyLabels: ['...', 'feeling', 'hope'] },
    wonder: { target: 'starburst', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'starburst'], hierarchyLabels: ['...', 'feeling', 'wonder'] },
    magic: { target: 'starburst', abstraction: 0.8, hierarchy: ['sphere', 'sphere', 'starburst'], hierarchyLabels: ['...', 'mystery', 'magic'] },

    // ── Beauty / order (ring) ────────────────────────────────────────
    beauty: { target: 'ring', abstraction: 0.7, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'form', 'beauty'] },
    grace: { target: 'ring', abstraction: 0.7, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'form', 'grace'] },
    elegance: { target: 'ring', abstraction: 0.75, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'form', 'elegance'] },
    perfection: { target: 'ring', abstraction: 0.7, hierarchy: ['sphere', 'ring', 'ring'], hierarchyLabels: ['...', 'ideal', 'perfection'] },
    infinity: { target: 'ring', abstraction: 0.85, hierarchy: ['sphere', 'sphere', 'ring'], hierarchyLabels: ['...', 'concept', 'infinity'] },
    eternity: { target: 'ring', abstraction: 0.9, hierarchy: ['sphere', 'sphere', 'ring'], hierarchyLabels: ['...', 'concept', 'eternity'] },

    // ── Growth / nature (tree) ───────────────────────────────────────
    growth: { target: 'tree', abstraction: 0.7, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'process', 'growth'] },
    life: { target: 'tree', abstraction: 0.75, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'concept', 'life'] },
    roots: { target: 'tree', abstraction: 0.6, hierarchy: ['sphere', 'tree', 'tree'], hierarchyLabels: ['...', 'ground', 'roots'] },
    nature: { target: 'tree', abstraction: 0.65, hierarchy: ['sphere', 'sphere', 'tree'], hierarchyLabels: ['...', 'world', 'nature'] },

    // ── Stability / strength (mountain) ──────────────────────────────
    strength: { target: 'mountain', abstraction: 0.7, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'force', 'strength'] },
    solid: { target: 'mountain', abstraction: 0.6, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'matter', 'solid'] },
    steady: { target: 'mountain', abstraction: 0.65, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'state', 'steady'] },
    immovable: { target: 'mountain', abstraction: 0.7, hierarchy: ['sphere', 'mountain', 'mountain'], hierarchyLabels: ['...', 'force', 'immovable'] },

    // ── Flow / motion (wave) ─────────────────────────────────────────
    flow: { target: 'wave', abstraction: 0.65, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'motion', 'flow'] },
    drift: { target: 'wave', abstraction: 0.7, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'motion', 'drift'] },
    rhythm: { target: 'wave', abstraction: 0.7, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'pattern', 'rhythm'] },
    breath: { target: 'wave', abstraction: 0.7, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'life', 'breath'] },
    pulse: { target: 'wave', abstraction: 0.65, hierarchy: ['sphere', 'wave', 'wave'], hierarchyLabels: ['...', 'beat', 'pulse'] },
};


// ══════════════════════════════════════════════════════════════════════
// TIER 3: ACTION MODIFIERS
// ══════════════════════════════════════════════════════════════════════
// Verbs and adjectives that modify INTENSITY, not shape.
// These multiply the emotionalIntensity of the semantic state:
//   > 1.0 = more energetic, faster, bigger movements
//   < 1.0 = calmer, slower, smaller movements
//   1.0   = neutral (no modification)
//
// Example: "the horse is galloping" → quadruped shape + 1.5x intensity
//          "the horse is sleeping"  → quadruped shape + 0.3x intensity
// ══════════════════════════════════════════════════════════════════════
export const ACTION_MODIFIERS: Record<string, number> = {
    // ── High energy (multiplier > 1.0) ───────────────────────────────
    galloping: 1.5,
    running: 1.3,
    flying: 1.4,
    exploding: 1.8,
    screaming: 1.6,
    smashing: 1.7,
    violent: 1.7,
    crashing: 1.5,
    raging: 1.6,
    wild: 1.4,
    spinning: 1.3,
    roaring: 1.5,
    charging: 1.4,
    leaping: 1.3,
    dancing: 1.2,

    // ── Low energy (multiplier < 1.0) ────────────────────────────────
    floating: 0.6,
    drifting: 0.5,
    sleeping: 0.3,
    gentle: 0.4,
    whisper: 0.3,
    // Note: 'quiet' and 'still' are in ABSTRACT_CONCEPTS (→ sphere shape),
    // so they're excluded here to avoid dead code. The classifier checks
    // ABSTRACT_CONCEPTS before ACTION_MODIFIERS, meaning entries here
    // would never be reached for those words.
    slow: 0.5,
    fading: 0.4,
    melting: 0.5,
    resting: 0.3,
    breathing: 0.6,
    gliding: 0.5,
    soft: 0.4,
    silent: 0.3,
};
