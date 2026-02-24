/**
 * template-types.ts — TypeScript interfaces for the A3 template JSON schema.
 *
 * Templates are JSON files that compose A2's 15 primitives into
 * ready-to-use animation plans. The parser reads these + a part list
 * and produces a MotionPlanData for the shader.
 */


// ── PART INFO (from PartCrafter) ────────────────────────────────

/** Describes one part in a decomposed object. */
export interface PartInfo {
    /** Part ID used in the shader (0 = unassigned, 1–32 for real parts). */
    id: number;
    /** Semantic label: "body", "head", "front_left_leg", "tail", etc. */
    name: string;
    /** Which part this attaches to (null = root). */
    parentId: number | null;
}


// ── TEMPLATE JSON SCHEMA ────────────────────────────────────────

/** Top-level template JSON structure. */
export interface TemplateJSON {
    /** Unique identifier, e.g. "locomotion_quadruped". */
    template_id: string;

    /** Verbs that trigger this template. */
    anchor_verbs: string[];

    /** VerbNet classification (metadata for Tier 2). */
    verbnet_class: string;

    /** Thematic role mappings (metadata for Tier 2). */
    thematic_roles: Record<string, string>;

    /** Human-readable description. */
    description: string;

    /** Motion applied to all particles if no per-part rule matches. */
    whole_body: PrimitiveSpec;

    /** Part-specific motion rules with glob matching. */
    part_rules: PartRule[];

    /** Default values and adverb overrides. */
    defaults: TemplateDefaults;
}

/** Specifies a primitive + its parameters (used in whole_body and part_rules). */
export interface PrimitiveSpec {
    /** Primitive name, e.g. "oscillate_translate". Resolved to ID at parse time. */
    primitive: string;

    /**
     * Parameters for the primitive. Values can be:
     * - number: literal
     * - string: expression template like "{{speed * 2.0}}"
     * Keyed by semantic name, mapped to the 12-float param array by the parser.
     */
    params: Record<string, number | string | number[]>;

    /**
     * Duration in seconds for one-shot primitives.
     * Can be a number or an expression string like "{{1.5 / speed}}".
     * If omitted: defaults to 1.0 for one-shots, 0 for loopers.
     */
    duration?: number | string;
}

/** A part-specific motion rule with glob matching on part names. */
export interface PartRule {
    /**
     * Glob pattern for matching part names.
     * Supports:
     *   - "front_*_leg" — wildcard
     *   - "front_*_leg OR forelimb*" — OR combinator
     *   - "head" — exact match
     */
    match: string;

    /** Primitive name for matched parts. */
    primitive: string;

    /**
     * Keypoint targets for this part's motion.
     * Keys are semantic (e.g. "forward_extent"), values have direction + magnitude.
     */
    keypoints?: Record<string, KeypointSpec>;

    /** Primitive parameters (same format as PrimitiveSpec.params). */
    params: Record<string, number | string | number[]>;

    /**
     * How attachment weight is used:
     * - "gradient" (default): weight = radial distance from joint (organic)
     * - "uniform": all particles move equally
     */
    attachment_behavior?: 'gradient' | 'uniform';

    /** Duration in seconds for one-shot primitives. Can be expression string. */
    duration?: number | string;
}

/** A keypoint specification for a part rule. */
export interface KeypointSpec {
    direction: number[];
    magnitude: number;
}

/** Default values and adverb-based overrides. */
export interface TemplateDefaults {
    /** Default speed multiplier. */
    speed: number;

    /**
     * Maps adverbs to parameter overrides.
     * e.g. "slowly" → { speed: 0.3 }
     */
    adverb_map: Record<string, AdverbOverride>;
}

/** Parameter overrides triggered by an adverb. */
export interface AdverbOverride {
    speed?: number;
    amplitude_scale?: number;
}


// ── PARSER OUTPUT OVERRIDES ─────────────────────────────────────

/** Overrides passed to parseTemplate() by the caller. */
export interface ParseOverrides {
    /** Speed multiplier (e.g. from adverb). */
    speed?: number;
    /** Amplitude multiplier. */
    amplitudeScale?: number;
    /** Start time for one-shot primitives (seconds since app start). */
    startTime?: number;
    /** Adverb string to look up in template's adverb_map. */
    adverb?: string;
}
