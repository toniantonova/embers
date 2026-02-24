/**
 * part-type-inference.ts — Fuzzy part name → canonical type dictionary.
 *
 * When a template's glob pattern doesn't match any part by name,
 * the parser falls back to type inference:
 *   1. Infer canonical type from part name (e.g. "left_wing" → "limb")
 *   2. Re-try glob against inferred type
 *   3. If still no match → skip silently
 *
 * This allows templates written for "front_*_leg" to also work
 * with "forelimb", "front_paw", etc., depending on naming convention.
 */


/**
 * Canonical part types used for fuzzy matching.
 */
export type CanonicalPartType =
    | 'body'
    | 'head'
    | 'limb'
    | 'tail'
    | 'rotation'
    | 'appendage'
    | 'surface'
    | 'trunk';


/**
 * Dictionary mapping part name substrings to canonical types.
 * Order matters — first match wins.
 * Matching is case-insensitive.
 */
const PART_TYPE_RULES: Array<{ pattern: RegExp; type: CanonicalPartType }> = [
    // Head / face
    { pattern: /head|face|skull|snout|beak|mouth|jaw|muzzle/i, type: 'head' },

    // Tail / rear appendages (check BEFORE limb, since "tail_fin" should be tail not limb)
    { pattern: /tail|rudder/i, type: 'tail' },

    // Rotation parts (wheels, rotors, propellers) — check BEFORE limb
    { pattern: /wheel|rotor|propeller|gear|turbine|axle/i, type: 'rotation' },

    // Limbs (legs, arms, wings, fins, tentacles, paws)
    { pattern: /leg|arm|wing|fin|paw|claw|hoof|tentacle|limb|flipper|petal|paddle/i, type: 'limb' },

    // Trunk / stem
    { pattern: /trunk|stem|stalk|spine|torso/i, type: 'trunk' },

    // Surface parts (canopy, shell, skin)
    { pattern: /canopy|shell|bark|leaf|leaves|skin|fur|feather|scale/i, type: 'surface' },

    // Appendages (generic small parts)
    { pattern: /antenna|horn|tusk|ear|eye|nose|tongue|whisker/i, type: 'appendage' },

    // Body (catch-all for main mass)
    { pattern: /body|hull|chassis|fuselage|core|main|center/i, type: 'body' },
];


/**
 * Infer the canonical type of a part from its name.
 *
 * @param partName - The part name (e.g. "front_left_leg", "dorsal_fin")
 * @returns The inferred canonical type, or null if no match
 *
 * @example
 * inferPartType("front_left_leg")   // → "limb"
 * inferPartType("left_wing")        // → "limb"
 * inferPartType("tail_fin")         // → "tail"
 * inferPartType("front_left_wheel") // → "rotation"
 * inferPartType("canopy")           // → "surface"
 * inferPartType("xyzzy")            // → null
 */
export function inferPartType(partName: string): CanonicalPartType | null {
    for (const rule of PART_TYPE_RULES) {
        if (rule.pattern.test(partName)) {
            return rule.type;
        }
    }
    return null;
}


/**
 * Get a canonical type mapping for a list of parts.
 *
 * @param partNames - Array of part name strings
 * @returns Map from part name → canonical type (null if unknown)
 */
export function inferPartTypes(
    partNames: string[]
): Map<string, CanonicalPartType | null> {
    const result = new Map<string, CanonicalPartType | null>();
    for (const name of partNames) {
        result.set(name, inferPartType(name));
    }
    return result;
}


/**
 * Canonical type aliases — maps template glob patterns to
 * canonical types they might intend to match.
 *
 * Used when a glob like "front_*_leg" matches no parts, but
 * the object has parts inferred as "limb" type.
 */
export const TYPE_ALIASES: Record<string, CanonicalPartType> = {
    'leg': 'limb',
    'arm': 'limb',
    'wing': 'limb',
    'fin': 'limb',
    'paw': 'limb',
    'forelimb': 'limb',
    'hindlimb': 'limb',
    'flipper': 'limb',
    'tentacle': 'limb',
    'wheel': 'rotation',
    'rotor': 'rotation',
    'propeller': 'rotation',
    'tail': 'tail',
    'head': 'head',
    'body': 'body',
    'trunk': 'trunk',
};
