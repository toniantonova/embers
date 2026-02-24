/**
 * adverb-resolver.ts — Resolves adverbs to speed/amplitude overrides.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Given an adverb from parsed speech and a template JSON, looks up the
 * template's adverb_map to extract speed and amplitude_scale overrides.
 * Falls back to sensible defaults if the adverb isn't in the map.
 *
 * resolveAdverb("quickly", locomotion_quadruped)
 *   → { speed: 2.0 }
 *
 * resolveAdverb("furiously", action_jump)
 *   → { speed: 2.5, amplitudeScale: 1.5 }
 */

import type { TemplateJSON, ParseOverrides } from '../templates/template-types';


// ── GENERIC ADVERB FALLBACKS ────────────────────────────────────────
// Used when the specific template doesn't define the adverb in its map.

const GENERIC_SPEED_MAP: Record<string, number> = {
    // Fast
    quickly: 2.0, fast: 2.0, rapidly: 2.2, swiftly: 1.8, briskly: 1.5,
    hastily: 2.0, urgently: 2.0,
    // Slow
    slowly: 0.4, gently: 0.5, carefully: 0.5, cautiously: 0.6,
    lazily: 0.3, leisurely: 0.4, softly: 0.5,
    // Intense
    furiously: 2.5, violently: 2.5, fiercely: 2.3, wildly: 2.2,
    aggressively: 2.0, frantically: 2.3, desperately: 2.0,
    // Graceful
    gracefully: 0.7, elegantly: 0.7, smoothly: 0.8, delicately: 0.5,
    beautifully: 0.7, majestically: 0.6,
    // Playful
    playfully: 1.3, cheerfully: 1.2, happily: 1.1, excitedly: 1.5,
    enthusiastically: 1.4, joyfully: 1.2,
    // Heavy
    heavily: 0.6, wearily: 0.4, tiredly: 0.3, sluggishly: 0.3,
};

const GENERIC_AMPLITUDE_MAP: Record<string, number> = {
    furiously: 1.8, violently: 2.0, wildly: 2.0, fiercely: 1.5,
    gently: 0.5, softly: 0.4, delicately: 0.3, gracefully: 0.6,
    heavily: 1.4, slightly: 0.3, barely: 0.2, enormously: 1.8,
    dramatically: 1.6, powerfully: 1.5, explosively: 2.0,
};


// ── MAIN RESOLVER ───────────────────────────────────────────────────

/**
 * Resolve an adverb into ParseOverrides using the template's adverb_map.
 *
 * Priority:
 * 1. Template's own adverb_map (most specific)
 * 2. Generic speed/amplitude fallback maps
 * 3. No overrides (return defaults)
 *
 * @param adverb - The adverb to resolve (e.g. "quickly", "slowly")
 * @param template - Template JSON with adverb_map in defaults
 * @returns ParseOverrides with speed and/or amplitudeScale
 */
export function resolveAdverb(
    adverb: string | null | undefined,
    template: TemplateJSON,
): ParseOverrides {
    const overrides: ParseOverrides = {};

    if (!adverb) return overrides;

    const normalizedAdverb = adverb.toLowerCase().trim();
    if (!normalizedAdverb) return overrides;

    // ── Priority 1: Template-specific adverb map ─────────────────
    const templateMap = template.defaults?.adverb_map;
    if (templateMap && templateMap[normalizedAdverb]) {
        const entry = templateMap[normalizedAdverb];
        if (entry.speed !== undefined) overrides.speed = entry.speed;
        if (entry.amplitude_scale !== undefined) overrides.amplitudeScale = entry.amplitude_scale;
        return overrides;
    }

    // ── Priority 2: Generic fallback maps ────────────────────────
    const genericSpeed = GENERIC_SPEED_MAP[normalizedAdverb];
    if (genericSpeed !== undefined) overrides.speed = genericSpeed;

    const genericAmp = GENERIC_AMPLITUDE_MAP[normalizedAdverb];
    if (genericAmp !== undefined) overrides.amplitudeScale = genericAmp;

    return overrides;
}


/**
 * Check if an adverb is recognized (in either template map or generic map).
 */
export function isKnownAdverb(adverb: string): boolean {
    const normalized = adverb.toLowerCase().trim();
    return GENERIC_SPEED_MAP[normalized] !== undefined
        || GENERIC_AMPLITUDE_MAP[normalized] !== undefined;
}
