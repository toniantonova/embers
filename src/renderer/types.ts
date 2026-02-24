/**
 * renderer/types.ts — TypeScript interfaces for motion plan data.
 *
 * These types define the CPU-side representation of motion plans
 * that get packed into GPU DataTextures for the velocity shader.
 *
 * Layout in the GPU DataTexture (4×33 RGBA Float32):
 *   Row 0:     whole-body motion
 *   Rows 1–32: per-part motion (indexed by partId)
 *   Each row = 4 pixels × 4 channels = 16 floats:
 *     Pixel 0: [primitiveId, phase, startTime, duration]
 *     Pixel 1: [p0, p1, p2, p3]
 *     Pixel 2: [p4, p5, p6, p7]
 *     Pixel 3: [p8, p9, p10, p11]
 */


/**
 * Primitive IDs — must match the dispatch in primitives.glsl.
 */
export const PRIMITIVE_IDS = {
    OSCILLATE_BEND: 0,
    OSCILLATE_TRANSLATE: 1,
    ARC_TRANSLATE: 2,
    RIGID_ROTATE: 3,
    SPRING_SETTLE: 4,
    RADIAL_BURST: 5,
    RADIAL_CONTRACT: 6,
    SPIRAL: 7,
    LAMINAR_FLOW: 8,
    CURL_NOISE_FLOW: 9,
    BROWNIAN_SCATTER: 10,
    WAVE_PROPAGATE: 11,
    STRETCH_ALONG_AXIS: 12,
    TWIST: 13,
    PENDULUM: 14,
} as const;

export type PrimitiveId = typeof PRIMITIVE_IDS[keyof typeof PRIMITIVE_IDS];

/** Names for display/debugging. */
export const PRIMITIVE_NAMES: Record<PrimitiveId, string> = {
    0: 'oscillate_bend',
    1: 'oscillate_translate',
    2: 'arc_translate',
    3: 'rigid_rotate',
    4: 'spring_settle',
    5: 'radial_burst',
    6: 'radial_contract',
    7: 'spiral',
    8: 'laminar_flow',
    9: 'curl_noise_flow',
    10: 'brownian_scatter',
    11: 'wave_propagate',
    12: 'stretch_along_axis',
    13: 'twist',
    14: 'pendulum',
};

/**
 * One-shot primitives (have a defined duration and hold final state).
 * Loopers run forever.
 */
export const ONE_SHOT_PRIMITIVES = new Set<PrimitiveId>([
    PRIMITIVE_IDS.ARC_TRANSLATE,
    PRIMITIVE_IDS.SPRING_SETTLE,
    PRIMITIVE_IDS.RADIAL_BURST,
    PRIMITIVE_IDS.RADIAL_CONTRACT,
    PRIMITIVE_IDS.BROWNIAN_SCATTER,
]);


/**
 * Per-part motion data — describes what one part does.
 */
export interface PartMotionData {
    /** Which primitive function to run (0–14). */
    primitiveId: PrimitiveId;

    /** Up to 12 float parameters for the primitive. */
    params: number[];

    /** Timing offset for this part (shifts the animation phase). */
    phase: number;

    /**
     * For one-shot primitives: when this motion began (seconds since
     * app start). Set by MotionPlanManager when the plan is activated.
     */
    startTime: number;

    /**
     * For one-shot primitives: how long the motion runs (seconds).
     * 0 = looping (no end).
     */
    duration: number;

    /** Whether this part's motion is active. */
    active: boolean;
}

/**
 * Full motion plan — whole-body + up to 32 per-part motions.
 */
export interface MotionPlanData {
    /** Motion applied uniformly to all particles. */
    wholeBody: PartMotionData;

    /**
     * Per-part motions, indexed by partId (1–32).
     * partId 0 = unassigned (whole-body only).
     * Sparse: only entries for active parts need to be present.
     */
    parts: (PartMotionData | null)[];

    /** Global speed multiplier (from adverbs like "quickly"). */
    speedScale: number;

    /** Global amplitude multiplier (from adverbs like "gently"). */
    amplitudeScale: number;
}


/**
 * Creates a default inactive PartMotionData.
 */
export function createInactivePartMotion(): PartMotionData {
    return {
        primitiveId: 0,
        params: new Array(12).fill(0),
        phase: 0,
        startTime: 0,
        duration: 0,
        active: false,
    };
}

/**
 * Creates an empty motion plan (all parts inactive).
 */
export function createEmptyMotionPlan(): MotionPlanData {
    const parts: (PartMotionData | null)[] = new Array(33).fill(null);
    return {
        wholeBody: createInactivePartMotion(),
        parts,
        speedScale: 1.0,
        amplitudeScale: 1.0,
    };
}

/** Maximum number of parts supported by the shader. */
export const MAX_PARTS = 32;

/** Number of float parameters per part in the motion plan texture. */
export const PARAMS_PER_PART = 12;

/** Motion plan texture dimensions. */
export const MOTION_PLAN_TEX_WIDTH = 4;   // 4 pixels per row
export const MOTION_PLAN_TEX_HEIGHT = 33; // 33 rows (1 whole-body + 32 parts)
