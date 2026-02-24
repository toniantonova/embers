/**
 * template-parser.ts — Core parser that converts a template JSON + part list
 * into a MotionPlanData ready for the shader.
 *
 * Matching fallback chain (per the plan):
 *   1. Exact glob match against partList[].name
 *   2. Type inference fallback — infer canonical type → re-try
 *   3. Skip silently
 */

import type { MotionPlanData, PartMotionData, PrimitiveId } from '../renderer/types';
import {
    PRIMITIVE_NAMES,
    ONE_SHOT_PRIMITIVES,
    createEmptyMotionPlan,
} from '../renderer/types';
import type {
    TemplateJSON,
    PartInfo,
    ParseOverrides,
    PartRule,
} from './template-types';
import { resolveParamValue, type ExpressionVariables } from './expression-eval';
import { matchGlob } from './glob-matcher';
import { inferPartType, type CanonicalPartType } from './part-type-inference';


// ── REVERSE NAME → ID LOOKUP ────────────────────────────────────

const NAME_TO_ID: Record<string, PrimitiveId> = {};
for (const [id, name] of Object.entries(PRIMITIVE_NAMES)) {
    NAME_TO_ID[name] = Number(id) as PrimitiveId;
}

/**
 * Map a primitive name (e.g. "oscillate_bend") to its shader ID (0–14).
 * Throws if the name is unknown.
 */
export function resolvePrimitiveId(name: string): PrimitiveId {
    const id = NAME_TO_ID[name];
    if (id === undefined) {
        throw new Error(
            `[TemplateParser] Unknown primitive name: "${name}". ` +
            `Valid names: ${Object.values(PRIMITIVE_NAMES).join(', ')}`
        );
    }
    return id;
}


// ── PARAM RESOLUTION ────────────────────────────────────────────

/**
 * Resolve a params record into a flat 12-float array for the shader.
 *
 * Template params use semantic keys like "direction", "amplitude", "frequency".
 * We map these to numbered slots based on what the primitive expects.
 *
 * For now, we use a simple ordered approach:
 *   - Array values are spread in order
 *   - Scalar values are appended in order
 *   - All padded to exactly 12 floats
 */
function resolveParams(
    params: Record<string, number | string | number[]>,
    variables: ExpressionVariables
): number[] {
    const result: number[] = [];

    for (const value of Object.values(params)) {
        if (Array.isArray(value)) {
            // Array values: spread each element
            for (const v of value) {
                result.push(typeof v === 'number' ? v : resolveParamValue(String(v), variables));
            }
        } else {
            result.push(resolveParamValue(value, variables));
        }
    }

    // Pad to exactly 12
    while (result.length < 12) result.push(0);
    // Truncate if over (shouldn't happen with well-formed templates)
    return result.slice(0, 12);
}


// ── DURATION RESOLUTION ─────────────────────────────────────────

/**
 * Resolve the duration for a motion.
 * - If explicitly set in the spec → use that
 * - If one-shot primitive and no duration → default 1.0s
 * - If looping primitive → 0
 */
function resolveDuration(
    primitiveId: PrimitiveId,
    specDuration: number | string | undefined,
    variables: ExpressionVariables
): number {
    if (specDuration !== undefined) {
        // Resolve expression if it's a string like "{{1.5 / speed}}"
        if (typeof specDuration === 'string') {
            return resolveParamValue(specDuration, variables);
        }
        return specDuration;
    }
    return ONE_SHOT_PRIMITIVES.has(primitiveId) ? 1.0 : 0;
}


// ── PART MOTION BUILDER ─────────────────────────────────────────

function buildPartMotion(
    primitiveId: PrimitiveId,
    params: number[],
    phase: number,
    startTime: number,
    duration: number
): PartMotionData {
    return {
        primitiveId,
        params,
        phase,
        startTime,
        duration,
        active: true,
    };
}


// ── MAIN PARSER ─────────────────────────────────────────────────

/**
 * Parse a template JSON + part list into a MotionPlanData.
 *
 * @param template - The template JSON definition
 * @param partList - The object's actual parts from PartCrafter
 * @param overrides - Optional speed, amplitude, adverb overrides
 * @returns A MotionPlanData ready for MotionPlanManager.setMotionPlan()
 */
export function parseTemplate(
    template: TemplateJSON,
    partList: PartInfo[],
    overrides?: ParseOverrides
): MotionPlanData {
    const plan = createEmptyMotionPlan();

    // ── Resolve overrides ──
    let speed = template.defaults.speed;
    let amplitudeScale = 1.0;
    const startTime = overrides?.startTime ?? 0;

    // Apply adverb overrides first
    if (overrides?.adverb && template.defaults.adverb_map[overrides.adverb]) {
        const adverbOvr = template.defaults.adverb_map[overrides.adverb];
        if (adverbOvr.speed !== undefined) speed = adverbOvr.speed;
        if (adverbOvr.amplitude_scale !== undefined) amplitudeScale = adverbOvr.amplitude_scale;
    }

    // Then apply explicit overrides (take priority over adverb)
    if (overrides?.speed !== undefined) speed = overrides.speed;
    if (overrides?.amplitudeScale !== undefined) amplitudeScale = overrides.amplitudeScale;

    plan.speedScale = speed;
    plan.amplitudeScale = amplitudeScale;

    // ── Resolve whole-body ──
    const wb = template.whole_body;
    const wbPrimId = resolvePrimitiveId(wb.primitive);
    const wbVars: ExpressionVariables = { speed, amplitudeScale, index: 0, count: partList.length };
    const wbParams = resolveParams(wb.params, wbVars);
    plan.wholeBody = buildPartMotion(wbPrimId, wbParams, 0, startTime, resolveDuration(wbPrimId, wb.duration, wbVars));

    // ── Resolve per-part rules ──
    const partNames = partList.map(p => p.name);
    // Pre-compute inferred types for fallback
    const partTypes = partList.map(p => inferPartType(p.name));
    // Track which part IDs have been assigned by earlier rules,
    // so type inference fallback won't overwrite explicit matches.
    const assignedPartIds = new Set<number>();

    for (const rule of template.part_rules) {
        const matchedParts = resolvePartMatches(rule, partList, partNames, partTypes, assignedPartIds);

        for (let matchIdx = 0; matchIdx < matchedParts.length; matchIdx++) {
            const part = matchedParts[matchIdx];
            const primId = resolvePrimitiveId(rule.primitive);
            const vars: ExpressionVariables = {
                speed,
                amplitudeScale,
                index: matchIdx,
                count: matchedParts.length,
            };

            const params = resolveParams(rule.params, vars);
            const duration = resolveDuration(primId, rule.duration, vars);

            // Phase: if params include a phase expression, it's already in the params.
            // For explicit phase control, templates use the "phase" key in params.
            // The standard phase offset for part matching is via {{index * N}}.
            const phase = 0; // phase is encoded in params via expressions

            plan.parts[part.id] = buildPartMotion(primId, params, phase, startTime, duration);
            assignedPartIds.add(part.id);
        }
    }

    return plan;
}


// ── PART MATCHING (3-STEP CHAIN) ────────────────────────────────

/**
 * Resolve which parts a rule matches using the 3-step fallback chain:
 *   1. Exact glob match against part names
 *   2. Type inference fallback (excluding already-assigned parts)
 *   3. Skip silently (return empty)
 */
function resolvePartMatches(
    rule: PartRule,
    partList: PartInfo[],
    partNames: string[],
    partTypes: (CanonicalPartType | null)[],
    assignedPartIds: Set<number>
): PartInfo[] {
    // Step 1: Exact glob match (always allowed even if already assigned)
    const directMatches: PartInfo[] = [];
    for (let i = 0; i < partNames.length; i++) {
        if (matchGlob(partNames[i], rule.match)) {
            directMatches.push(partList[i]);
        }
    }
    if (directMatches.length > 0) return directMatches;

    // Step 2: Type inference fallback — but skip parts already assigned by earlier rules
    const patternType = inferTypeFromPattern(rule.match);
    if (patternType) {
        const typeMatches: PartInfo[] = [];
        for (let i = 0; i < partTypes.length; i++) {
            if (partTypes[i] === patternType && !assignedPartIds.has(partList[i].id)) {
                typeMatches.push(partList[i]);
            }
        }
        if (typeMatches.length > 0) return typeMatches;
    }

    // Step 3: Skip silently
    return [];
}


/**
 * Extract a canonical type from a glob pattern for type-inference fallback.
 *
 * Looks for type-bearing words in the pattern:
 *   "front_*_leg" → finds "leg" → canonical "limb"
 *   "wing*" → finds "wing" → canonical "limb"
 *   "*_wheel" → finds "wheel" → canonical "rotation"
 */
function inferTypeFromPattern(pattern: string): CanonicalPartType | null {
    // Strip wildcard and split into words
    const subPatterns = pattern.split(/\s+OR\s+/);
    for (const sub of subPatterns) {
        const words = sub.replace(/\*/g, '').split(/[_\s]+/).filter(w => w.length > 0);
        for (const word of words) {
            const type = inferPartType(word);
            if (type) return type;
        }
    }
    return null;
}
