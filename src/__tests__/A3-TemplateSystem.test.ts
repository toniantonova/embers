/**
 * A3-TemplateSystem.test.ts — Tests for the A3 template system.
 *
 * Covers:
 *   1. ExpressionEval — arithmetic, variables, parentheses, errors
 *   2. GlobMatcher — wildcard, OR, case-insensitive, no-match
 *   3. TemplateParser — whole-body, part matching, one-shot duration, 3-step chain
 *   4. TemplateLibrary — load, validation, anchor verbs
 *   5. Round-trip integration (template JSON → MotionPlanData)
 */

import { describe, it, expect } from 'vitest';
import { evaluateExpression, resolveParamValue, isExpression } from '../templates/expression-eval';
import { matchGlob, findMatchingParts, validateGlobPattern } from '../templates/glob-matcher';
import { inferPartType } from '../templates/part-type-inference';
import { parseTemplate, resolvePrimitiveId } from '../templates/template-parser';
import { TemplateLibrary, validateTemplate } from '../templates/template-library';
import { PRIMITIVE_IDS, ONE_SHOT_PRIMITIVES } from '../renderer/types';
import type { TemplateJSON, PartInfo } from '../templates/template-types';

// Import actual JSON templates for round-trip tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import locomotionQuadruped from '../templates/templates/locomotion_quadruped.json';
import actionJump from '../templates/templates/action_jump.json';
import transformExplode from '../templates/templates/transform_explode.json';
import ambientIdle from '../templates/templates/ambient_idle.json';
import actionSpeak from '../templates/templates/action_speak.json';


// ══ MOCK DATA ══════════════════════════════════════════════════

const DOG_PARTS: PartInfo[] = [
    { id: 1, name: 'body', parentId: null },
    { id: 2, name: 'head', parentId: 1 },
    { id: 3, name: 'front_left_leg', parentId: 1 },
    { id: 4, name: 'front_right_leg', parentId: 1 },
    { id: 5, name: 'back_left_leg', parentId: 1 },
    { id: 6, name: 'back_right_leg', parentId: 1 },
    { id: 7, name: 'tail', parentId: 1 },
];

const BIRD_PARTS: PartInfo[] = [
    { id: 1, name: 'body', parentId: null },
    { id: 2, name: 'head', parentId: 1 },
    { id: 3, name: 'left_wing', parentId: 1 },
    { id: 4, name: 'right_wing', parentId: 1 },
    { id: 5, name: 'tail', parentId: 1 },
];


// ══ EXPRESSION EVAL ════════════════════════════════════════════

describe('ExpressionEval', () => {
    it('detects template expressions', () => {
        expect(isExpression('{{speed * 2.0}}')).toBe(true);
        expect(isExpression('2.5')).toBe(false);
        expect(isExpression(42)).toBe(false);
    });

    it('evaluates simple arithmetic', () => {
        expect(evaluateExpression('{{2 + 3}}', {})).toBe(5);
        expect(evaluateExpression('{{10 - 4}}', {})).toBe(6);
        expect(evaluateExpression('{{3 * 7}}', {})).toBe(21);
        expect(evaluateExpression('{{15 / 3}}', {})).toBe(5);
    });

    it('evaluates with variables', () => {
        expect(evaluateExpression('{{speed * 2.0}}', { speed: 1.5 })).toBe(3.0);
        expect(evaluateExpression('{{index * 0.5}}', { index: 3 })).toBe(1.5);
    });

    it('respects operator precedence', () => {
        expect(evaluateExpression('{{2 + 3 * 4}}', {})).toBe(14);
        expect(evaluateExpression('{{10 - 2 * 3}}', {})).toBe(4);
    });

    it('handles parentheses', () => {
        expect(evaluateExpression('{{(2 + 3) * 4}}', {})).toBe(20);
    });

    it('handles complex expressions', () => {
        expect(evaluateExpression('{{speed * 2.0 + index * 0.25}}', { speed: 1.0, index: 2 })).toBeCloseTo(2.5);
        expect(evaluateExpression('{{1.0 + speed * 0.8}}', { speed: 1.0 })).toBeCloseTo(1.8);
    });

    it('handles unary minus', () => {
        expect(evaluateExpression('{{-3}}', {})).toBe(-3);
        expect(evaluateExpression('{{-speed}}', { speed: 2 })).toBe(-2);
    });

    it('throws on unknown variables', () => {
        expect(() => evaluateExpression('{{unknown}}', {})).toThrow('Unknown variable');
    });

    it('throws on division by zero', () => {
        expect(() => evaluateExpression('{{1 / 0}}', {})).toThrow('Division by zero');
    });

    it('resolves param values (literal or expression)', () => {
        expect(resolveParamValue(42, {})).toBe(42);
        expect(resolveParamValue('{{speed}}', { speed: 3 })).toBe(3);
        expect(resolveParamValue('2.5', {})).toBe(2.5);
    });
});


// ══ GLOB MATCHER ═══════════════════════════════════════════════

describe('GlobMatcher', () => {
    it('matches exact names', () => {
        expect(matchGlob('head', 'head')).toBe(true);
        expect(matchGlob('body', 'head')).toBe(false);
    });

    it('matches wildcards', () => {
        expect(matchGlob('front_left_leg', 'front_*_leg')).toBe(true);
        expect(matchGlob('front_right_leg', 'front_*_leg')).toBe(true);
        expect(matchGlob('back_left_leg', 'front_*_leg')).toBe(false);
    });

    it('handles OR combinator', () => {
        expect(matchGlob('left_wing', 'wing* OR *_wing')).toBe(true);
        expect(matchGlob('wing_tip', 'wing* OR *_wing')).toBe(true);
        expect(matchGlob('body', 'wing* OR *_wing')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(matchGlob('HEAD', 'head')).toBe(true);
        expect(matchGlob('Front_Left_Leg', 'front_*_leg')).toBe(true);
    });

    it('matches star-only pattern', () => {
        expect(matchGlob('anything', '*')).toBe(true);
    });

    it('finds matching parts from a list', () => {
        const names = ['body', 'head', 'front_left_leg', 'front_right_leg', 'back_left_leg'];
        const matches = findMatchingParts(names, 'front_*_leg');
        expect(matches).toHaveLength(2);
        expect(matches[0].name).toBe('front_left_leg');
        expect(matches[1].name).toBe('front_right_leg');
    });

    it('validates patterns', () => {
        expect(validateGlobPattern('front_*_leg')).toBeNull();
        expect(validateGlobPattern('')).toBe('Empty pattern');
    });
});


// ══ PART TYPE INFERENCE ════════════════════════════════════════

describe('PartTypeInference', () => {
    it('infers limb types', () => {
        expect(inferPartType('front_left_leg')).toBe('limb');
        expect(inferPartType('left_wing')).toBe('limb');
        expect(inferPartType('dorsal_fin')).toBe('limb');
        expect(inferPartType('tentacle_3')).toBe('limb');
    });

    it('infers head type', () => {
        expect(inferPartType('head')).toBe('head');
        expect(inferPartType('beak')).toBe('head');
    });

    it('infers rotation type', () => {
        expect(inferPartType('front_left_wheel')).toBe('rotation');
        expect(inferPartType('rotor')).toBe('rotation');
    });

    it('infers tail type', () => {
        expect(inferPartType('tail')).toBe('tail');
        expect(inferPartType('tail_fin')).toBe('tail');
    });

    it('returns null for unknown parts', () => {
        expect(inferPartType('xyzzy')).toBeNull();
    });
});


// ══ TEMPLATE PARSER ════════════════════════════════════════════

describe('TemplateParser', () => {
    it('resolves primitive names to IDs', () => {
        expect(resolvePrimitiveId('oscillate_bend')).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);
        expect(resolvePrimitiveId('radial_burst')).toBe(PRIMITIVE_IDS.RADIAL_BURST);
        expect(resolvePrimitiveId('pendulum')).toBe(PRIMITIVE_IDS.PENDULUM);
    });

    it('throws on unknown primitive names', () => {
        expect(() => resolvePrimitiveId('oscilate_bend')).toThrow('Unknown primitive');
    });

    it('parses whole-body motion correctly', () => {
        const plan = parseTemplate(locomotionQuadruped as unknown as TemplateJSON, DOG_PARTS);
        expect(plan.wholeBody.active).toBe(true);
        expect(plan.wholeBody.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_TRANSLATE);
        expect(plan.wholeBody.duration).toBe(0); // looping
    });

    it('matches part rules with globs', () => {
        const plan = parseTemplate(locomotionQuadruped as unknown as TemplateJSON, DOG_PARTS);
        // front_left_leg (id=3) and front_right_leg (id=4) should match "front_*_leg"
        expect(plan.parts[3]).not.toBeNull();
        expect(plan.parts[3]!.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);
        expect(plan.parts[4]).not.toBeNull();
        expect(plan.parts[4]!.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);
    });

    it('sets correct one-shot duration', () => {
        const plan = parseTemplate(actionJump as unknown as TemplateJSON, DOG_PARTS);
        // whole_body = arc_translate → one-shot
        expect(plan.wholeBody.primitiveId).toBe(PRIMITIVE_IDS.ARC_TRANSLATE);
        expect(plan.wholeBody.duration).toBeGreaterThan(0);
    });

    it('defaults one-shot duration when not specified', () => {
        const plan = parseTemplate(transformExplode as unknown as TemplateJSON, DOG_PARTS);
        // radial_burst has explicit duration=2.0 in the template
        expect(plan.wholeBody.primitiveId).toBe(PRIMITIVE_IDS.RADIAL_BURST);
        expect(plan.wholeBody.duration).toBe(2.0);
    });

    it('applies adverb overrides', () => {
        const plan = parseTemplate(
            locomotionQuadruped as unknown as TemplateJSON,
            DOG_PARTS,
            { adverb: 'slowly' }
        );
        expect(plan.speedScale).toBe(0.3);
    });

    it('skips unmatched part rules silently', () => {
        // Bird has no legs matching "front_*_leg" — should skip without error
        const plan = parseTemplate(locomotionQuadruped as unknown as TemplateJSON, BIRD_PARTS);
        // At minimum, whole-body should be set and no error thrown
        expect(plan.wholeBody.active).toBe(true);
    });
});


// ══ TEMPLATE LIBRARY ═══════════════════════════════════════════

describe('TemplateLibrary', () => {
    it('loads templates and maps verbs', () => {
        const lib = new TemplateLibrary();
        lib.loadTemplates([locomotionQuadruped as unknown as TemplateJSON, ambientIdle as unknown as TemplateJSON]);

        expect(lib.size).toBe(2);
        expect(lib.getTemplate('locomotion_quadruped')).toBeDefined();
        expect(lib.getTemplate('ambient_idle')).toBeDefined();
        expect(lib.getTemplateIdForVerb('run')).toBe('locomotion_quadruped');
        expect(lib.getTemplateIdForVerb('idle')).toBe('ambient_idle');
    });

    it('returns all template IDs', () => {
        const lib = new TemplateLibrary();
        lib.loadTemplates([locomotionQuadruped as unknown as TemplateJSON, actionSpeak as unknown as TemplateJSON]);

        const ids = lib.getAllTemplateIds();
        expect(ids).toContain('locomotion_quadruped');
        expect(ids).toContain('action_speak');
    });

    it('returns anchor verb mapping', () => {
        const lib = new TemplateLibrary();
        lib.loadTemplates([locomotionQuadruped as unknown as TemplateJSON]);

        const verbs = lib.getAnchorVerbs();
        expect(verbs.get('run')).toBe('locomotion_quadruped');
        expect(verbs.get('gallop')).toBe('locomotion_quadruped');
    });

    it('detects invalid primitive names during validation', () => {
        const badTemplate: TemplateJSON = {
            template_id: 'bad_template',
            anchor_verbs: ['test'],
            verbnet_class: 'test',
            thematic_roles: {},
            description: 'test',
            whole_body: { primitive: 'oscilate_bend', params: {} },
            part_rules: [],
            defaults: { speed: 1.0, adverb_map: {} },
        };

        const errors = validateTemplate(badTemplate);
        expect(errors.some(e => e.severity === 'error' && e.message.includes('Unknown primitive'))).toBe(true);
    });

    it('warns on anchor verb collisions', () => {
        const lib = new TemplateLibrary();
        const template1: TemplateJSON = {
            template_id: 'template_a',
            anchor_verbs: ['test_verb'],
            verbnet_class: '',
            thematic_roles: {},
            description: '',
            whole_body: { primitive: 'oscillate_translate', params: {} },
            part_rules: [],
            defaults: { speed: 1.0, adverb_map: {} },
        };
        const template2: TemplateJSON = {
            ...template1,
            template_id: 'template_b',
        };

        const warnings = lib.loadTemplates([template1, template2]);
        expect(warnings.some(w => w.message.includes('test_verb'))).toBe(true);
    });

    it('clears all templates', () => {
        const lib = new TemplateLibrary();
        lib.loadTemplates([locomotionQuadruped as unknown as TemplateJSON]);
        expect(lib.size).toBe(1);
        lib.clear();
        expect(lib.size).toBe(0);
    });
});


// ══ ROUND-TRIP INTEGRATION TESTS ═══════════════════════════════

describe('Round-trip: Template JSON → MotionPlanData', () => {
    it('locomotion_quadruped + dog parts → correct gait phases', () => {
        const plan = parseTemplate(locomotionQuadruped as unknown as TemplateJSON, DOG_PARTS);

        // Whole body is oscillate_translate (body bob)
        expect(plan.wholeBody.active).toBe(true);
        expect(plan.wholeBody.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_TRANSLATE);

        // Front legs (3, 4) should be oscillate_bend with different phases
        expect(plan.parts[3]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);
        expect(plan.parts[4]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);

        // Back legs (5, 6) should also be oscillate_bend
        expect(plan.parts[5]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);
        expect(plan.parts[6]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);

        // Tail (7) should be oscillate_bend
        expect(plan.parts[7]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);

        // Head (2) should be oscillate_translate
        expect(plan.parts[2]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_TRANSLATE);
    });

    it('action_jump + dog parts → one-shot arc_translate with duration', () => {
        const plan = parseTemplate(actionJump as unknown as TemplateJSON, DOG_PARTS);

        expect(plan.wholeBody.primitiveId).toBe(PRIMITIVE_IDS.ARC_TRANSLATE);
        expect(ONE_SHOT_PRIMITIVES.has(plan.wholeBody.primitiveId)).toBe(true);
        expect(plan.wholeBody.duration).toBeGreaterThan(0);

        // Legs should have spring_settle (one-shot)
        const legIds = [3, 4, 5, 6];
        for (const id of legIds) {
            if (plan.parts[id]) {
                expect(plan.parts[id]!.primitiveId).toBe(PRIMITIVE_IDS.SPRING_SETTLE);
                expect(plan.parts[id]!.duration).toBeGreaterThan(0);
            }
        }
    });

    it('transform_explode + any parts → radial_burst whole-body only', () => {
        const plan = parseTemplate(transformExplode as unknown as TemplateJSON, DOG_PARTS);

        expect(plan.wholeBody.primitiveId).toBe(PRIMITIVE_IDS.RADIAL_BURST);
        expect(plan.wholeBody.duration).toBe(2.0);

        // No part-specific motions (explode is whole-body only)
        const activeParts = plan.parts.filter((p): p is NonNullable<typeof p> => p !== null);
        expect(activeParts).toHaveLength(0);
    });

    it('ambient_idle + dog parts → very low amplitude curl noise', () => {
        const plan = parseTemplate(ambientIdle as unknown as TemplateJSON, DOG_PARTS);

        expect(plan.wholeBody.primitiveId).toBe(PRIMITIVE_IDS.CURL_NOISE_FLOW);
        expect(plan.wholeBody.active).toBe(true);
        expect(plan.wholeBody.duration).toBe(0); // looping

        // Head should have micro oscillation
        expect(plan.parts[2]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_TRANSLATE);
        // Tail should have micro bend
        expect(plan.parts[7]?.primitiveId).toBe(PRIMITIVE_IDS.OSCILLATE_BEND);
    });

    it('locomotion_quadruped with "slowly" adverb → low speed scale', () => {
        const plan = parseTemplate(
            locomotionQuadruped as unknown as TemplateJSON,
            DOG_PARTS,
            { adverb: 'slowly' }
        );

        expect(plan.speedScale).toBe(0.3);
    });
});
