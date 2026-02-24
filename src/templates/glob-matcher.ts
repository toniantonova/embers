/**
 * glob-matcher.ts — Glob/OR pattern matcher for part names.
 *
 * Supports:
 *   - "*" wildcard: matches any sequence of characters
 *   - "OR" combinator: "front_*_leg OR forelimb*"
 *   - Case-insensitive matching
 *   - Exact matches: "head" matches "head" only
 *
 * Used by the template parser to resolve part_rules against an
 * object's actual part list from PartCrafter.
 */


/**
 * Convert a glob pattern to a RegExp.
 * "*" → ".*" (match any chars), rest is escaped.
 */
function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
        .replace(/\*/g, '.*');                  // * → .*
    return new RegExp(`^${escaped}$`, 'i');     // case-insensitive, full match
}


/**
 * Test if a name matches a single glob pattern (no OR).
 */
function matchSinglePattern(name: string, pattern: string): boolean {
    const trimmed = pattern.trim();
    if (trimmed === '*') return true;
    return globToRegex(trimmed).test(name);
}


/**
 * Test if a part name matches a pattern string.
 * Handles "OR" combinator: returns true if any sub-pattern matches.
 *
 * @param name - The part name to test (e.g. "front_left_leg")
 * @param pattern - The pattern string (e.g. "front_*_leg OR forelimb*")
 * @returns Whether the name matches
 *
 * @example
 * matchGlob("front_left_leg", "front_*_leg");           // true
 * matchGlob("front_right_leg", "front_*_leg");          // true
 * matchGlob("back_left_leg", "front_*_leg");            // false
 * matchGlob("left_wing", "wing* OR *_wing");            // true
 * matchGlob("head", "head");                            // true
 * matchGlob("HEAD", "head");                            // true (case-insensitive)
 */
export function matchGlob(name: string, pattern: string): boolean {
    // Split on " OR " (case-sensitive for the keyword)
    const subPatterns = pattern.split(/\s+OR\s+/);
    return subPatterns.some(sub => matchSinglePattern(name, sub));
}


/**
 * Find all parts from a list that match a pattern.
 *
 * @param partNames - Array of part names
 * @param pattern - Glob/OR pattern
 * @returns Array of { name, index } for matching parts
 */
export function findMatchingParts(
    partNames: string[],
    pattern: string
): Array<{ name: string; index: number }> {
    const matches: Array<{ name: string; index: number }> = [];
    for (let i = 0; i < partNames.length; i++) {
        if (matchGlob(partNames[i], pattern)) {
            matches.push({ name: partNames[i], index: i });
        }
    }
    return matches;
}


/**
 * Validate a glob pattern string.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateGlobPattern(pattern: string): string | null {
    if (!pattern || pattern.trim().length === 0) {
        return 'Empty pattern';
    }
    const subPatterns = pattern.split(/\s+OR\s+/);
    for (const sub of subPatterns) {
        const trimmed = sub.trim();
        if (trimmed.length === 0) {
            return `Empty sub-pattern in OR expression: "${pattern}"`;
        }
    }
    return null; // valid
}
