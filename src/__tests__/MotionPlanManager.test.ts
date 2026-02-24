/**
 * MotionPlanManager.test.ts — Tests for the A2 motion plan system.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * The MotionPlanManager companion class that manages motion plan
 * data textures, crossfade state, and part attribute textures.
 *
 * We test:
 *   1. Motion plan activation and uniform updates
 *   2. Data texture packing (correct layout in 4×33 texture)
 *   3. Crossfade start, progress, and completion (double-buffer swap)
 *   4. Part attribute texture creation
 *   5. Clear/deactivation behavior
 *   6. buildMotionPlanShader() shader concatenation
 */

import { describe, it, expect, vi } from 'vitest';
import {
    MotionPlanManager,
    buildMotionPlanShader,
} from '../engine/particle-system-extensions';
import type { MotionPlanData, PartMotionData } from '../renderer/types';
import {
    PRIMITIVE_IDS,
    PRIMITIVE_NAMES,
    ONE_SHOT_PRIMITIVES,
    createEmptyMotionPlan,
    createInactivePartMotion,
    MOTION_PLAN_TEX_WIDTH,
    MOTION_PLAN_TEX_HEIGHT,
    MAX_PARTS,
    PARAMS_PER_PART,
} from '../renderer/types';


// ── HELPERS ─────────────────────────────────────────────────────────

function createMockUniforms(): Record<string, { value: any }> {
    return {};
}

function createPartMotion(
    primitiveId: number,
    params: number[] = [],
    active = true,
    duration = 0
): PartMotionData {
    const paddedParams = [...params];
    while (paddedParams.length < 12) paddedParams.push(0);
    return {
        primitiveId: primitiveId as any,
        params: paddedParams,
        phase: 0,
        startTime: 0,
        duration,
        active,
    };
}

function createTestPlan(): MotionPlanData {
    const plan = createEmptyMotionPlan();
    plan.wholeBody = createPartMotion(
        PRIMITIVE_IDS.OSCILLATE_TRANSLATE,
        [0, 1, 0, 0.5, 1.0, 0]
    );
    plan.parts[1] = createPartMotion(
        PRIMITIVE_IDS.OSCILLATE_BEND,
        [0, 0, 1, 0.3, 2.0, 0]
    );
    plan.speedScale = 1.5;
    plan.amplitudeScale = 0.8;
    return plan;
}


// ── TYPE TESTS ──────────────────────────────────────────────────────

describe('Renderer Types — Primitive IDs', () => {
    it('defines 15 primitive IDs (0–14)', () => {
        expect(Object.keys(PRIMITIVE_IDS)).toHaveLength(15);
        expect(PRIMITIVE_IDS.OSCILLATE_BEND).toBe(0);
        expect(PRIMITIVE_IDS.PENDULUM).toBe(14);
    });

    it('has names for all primitive IDs', () => {
        for (let i = 0; i <= 14; i++) {
            expect(PRIMITIVE_NAMES[i as keyof typeof PRIMITIVE_NAMES]).toBeDefined();
        }
    });

    it('identifies one-shot primitives correctly', () => {
        expect(ONE_SHOT_PRIMITIVES.has(PRIMITIVE_IDS.ARC_TRANSLATE)).toBe(true);
        expect(ONE_SHOT_PRIMITIVES.has(PRIMITIVE_IDS.SPRING_SETTLE)).toBe(true);
        expect(ONE_SHOT_PRIMITIVES.has(PRIMITIVE_IDS.RADIAL_BURST)).toBe(true);
        // Loopers should NOT be in the set
        expect(ONE_SHOT_PRIMITIVES.has(PRIMITIVE_IDS.OSCILLATE_BEND)).toBe(false);
        expect(ONE_SHOT_PRIMITIVES.has(PRIMITIVE_IDS.SPIRAL)).toBe(false);
    });
});

describe('Renderer Types — Empty Plan', () => {
    it('creates a plan with 33 null parts and inactive whole-body', () => {
        const plan = createEmptyMotionPlan();
        expect(plan.parts).toHaveLength(33);
        expect(plan.parts.every(p => p === null)).toBe(true);
        expect(plan.wholeBody.active).toBe(false);
        expect(plan.speedScale).toBe(1.0);
        expect(plan.amplitudeScale).toBe(1.0);
    });

    it('creates inactive part motion with correct defaults', () => {
        const pm = createInactivePartMotion();
        expect(pm.primitiveId).toBe(0);
        expect(pm.params).toHaveLength(12);
        expect(pm.active).toBe(false);
        expect(pm.duration).toBe(0);
    });
});

describe('Renderer Types — Constants', () => {
    it('has correct texture dimensions', () => {
        expect(MOTION_PLAN_TEX_WIDTH).toBe(4);
        expect(MOTION_PLAN_TEX_HEIGHT).toBe(33);
        expect(MAX_PARTS).toBe(32);
        expect(PARAMS_PER_PART).toBe(12);
    });
});


// ── MOTION PLAN MANAGER TESTS ───────────────────────────────────────

describe('MotionPlanManager — Construction', () => {
    it('initializes uniforms on construction', () => {
        const uniforms = createMockUniforms();
        new MotionPlanManager(uniforms, 64);

        expect(uniforms.uMotionPlanActive.value).toBe(0.0);
        expect(uniforms.uMotionSpeedScale.value).toBe(1.0);
        expect(uniforms.uMotionAmplitudeScale.value).toBe(1.0);
        expect(uniforms.uBlendFactor.value).toBe(0.0);
        expect(uniforms.tMotionPlan.value).toBeDefined();
        expect(uniforms.tMotionPlanB.value).toBeDefined();
        expect(uniforms.tPartAttr.value).toBeNull();
    });

    it('starts inactive and not blending', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);

        expect(manager.isActive).toBe(false);
        expect(manager.isBlending).toBe(false);
        expect(manager.plan).toBeNull();
    });
});

describe('MotionPlanManager — Plan Activation', () => {
    it('activates a motion plan and sets uniforms', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);
        const plan = createTestPlan();

        manager.setMotionPlan(plan);

        expect(manager.isActive).toBe(true);
        expect(uniforms.uMotionPlanActive.value).toBe(1.0);
        expect(uniforms.uMotionSpeedScale.value).toBe(1.5);
        expect(uniforms.uMotionAmplitudeScale.value).toBe(0.8);
        expect(manager.plan).toBe(plan);
    });

    it('packs whole-body motion into row 0 of the texture', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);
        const plan = createTestPlan();

        manager.setMotionPlan(plan);

        const texData = uniforms.tMotionPlan.value.image.data as Float32Array;
        // Row 0, pixel 0: [primitiveId, phase, startTime, duration]
        expect(texData[0]).toBe(PRIMITIVE_IDS.OSCILLATE_TRANSLATE);  // primitiveId
        expect(texData[1]).toBe(0);  // phase
        expect(texData[3]).toBe(0);  // duration (looping)

        // Row 0, pixel 1: params [0,1,0, 0.5]
        expect(texData[4]).toBe(0);   // p0
        expect(texData[5]).toBe(1);   // p1
        expect(texData[6]).toBe(0);   // p2
        expect(texData[7]).toBe(0.5); // p3
    });

    it('packs per-part motion into the correct row', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);
        const plan = createTestPlan();

        manager.setMotionPlan(plan);

        const texData = uniforms.tMotionPlan.value.image.data as Float32Array;
        // Part 1 is in row 1 (row = partId)
        const row1Base = 1 * MOTION_PLAN_TEX_WIDTH * 4;
        expect(texData[row1Base + 0]).toBe(PRIMITIVE_IDS.OSCILLATE_BEND); // primitiveId
        // Params start at offset 4 within the row
        expect(texData[row1Base + 4]).toBe(0);   // p0 (axis x)
        expect(texData[row1Base + 5]).toBe(0);   // p1 (axis y)
        expect(texData[row1Base + 6]).toBe(1);   // p2 (axis z)
        expect(texData[row1Base + 7]).toBeCloseTo(0.3, 5); // p3 (amplitude)
    });

    it('marks inactive parts with primitiveId = -1', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);
        const plan = createTestPlan();

        manager.setMotionPlan(plan);

        const texData = uniforms.tMotionPlan.value.image.data as Float32Array;
        // Row 2 (part 2) should be inactive
        const row2Base = 2 * MOTION_PLAN_TEX_WIDTH * 4;
        expect(texData[row2Base]).toBe(-1.0);
    });
});

describe('MotionPlanManager — Crossfade', () => {
    it('starts a crossfade with blend factor at 0', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);

        const planA = createTestPlan();
        manager.setMotionPlan(planA);

        const planB = createEmptyMotionPlan();
        planB.wholeBody = createPartMotion(PRIMITIVE_IDS.SPIRAL, [0, 0, 0, 0, 1, 0, 2, 0.3]);

        manager.crossfadeTo(planB, 1000);

        expect(manager.isBlending).toBe(true);
        expect(manager.blendFactor).toBe(0.0);
    });

    it('progresses blend factor over time', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);
        const plan = createTestPlan();
        manager.setMotionPlan(plan);

        const planB = createEmptyMotionPlan();
        planB.wholeBody = createPartMotion(PRIMITIVE_IDS.WAVE_PROPAGATE, [1, 0, 0, 2, 0.3, 2]);

        // Mock performance.now to control time
        const startTime = 1000;
        vi.spyOn(performance, 'now').mockReturnValue(startTime);
        manager.crossfadeTo(planB, 500);

        // 250ms later = 50% progress
        vi.spyOn(performance, 'now').mockReturnValue(startTime + 250);
        manager.update();
        expect(manager.blendFactor).toBeCloseTo(0.5, 1);
        expect(manager.isBlending).toBe(true);

        vi.restoreAllMocks();
    });

    it('completes crossfade: swaps plan B → A, resets blend to 0', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);
        const plan = createTestPlan();
        manager.setMotionPlan(plan);

        const planB = createEmptyMotionPlan();
        planB.wholeBody = createPartMotion(PRIMITIVE_IDS.TWIST, [0, 1, 0, 1.5, 0.5]);

        const startTime = 1000;
        vi.spyOn(performance, 'now').mockReturnValue(startTime);
        manager.crossfadeTo(planB, 500);

        // 600ms later = past completion
        vi.spyOn(performance, 'now').mockReturnValue(startTime + 600);
        manager.update();

        expect(manager.isBlending).toBe(false);
        expect(manager.blendFactor).toBe(0.0);
        // Plan A should now contain plan B's data
        const texData = uniforms.tMotionPlan.value.image.data as Float32Array;
        expect(texData[0]).toBe(PRIMITIVE_IDS.TWIST);

        vi.restoreAllMocks();
    });
});

describe('MotionPlanManager — Clear', () => {
    it('clears the motion plan and deactivates', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 64);
        manager.setMotionPlan(createTestPlan());

        expect(manager.isActive).toBe(true);

        manager.clearMotionPlan();

        expect(manager.isActive).toBe(false);
        expect(manager.isBlending).toBe(false);
        expect(manager.plan).toBeNull();
        expect(uniforms.uMotionPlanActive.value).toBe(0.0);
    });
});

describe('MotionPlanManager — Part Attributes', () => {
    it('creates a part attribute texture with correct layout', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 4); // 4×4 = 16 particles

        const partIds = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0, 1, 2, 3];
        const weights = [1, 1, 0.5, 0.8, 0.3, 0.9, 0.4, 0.7, 0.2, 0.6, 0.1, 0.5, 1, 0.5, 0.3, 0.4];

        const texture = manager.createPartAttributeTexture(partIds, weights);

        expect(texture).toBeDefined();
        expect(uniforms.tPartAttr.value).toBe(texture);

        const data = texture.image.data as Float32Array;
        // First particle: partId=0, weight=1.0
        expect(data[0]).toBe(0);
        expect(data[1]).toBe(1);
        // Third particle: partId=1, weight=0.5
        expect(data[8]).toBe(1);
        expect(data[9]).toBe(0.5);
    });
});


// ── SHADER CONCATENATION TESTS ──────────────────────────────────────

describe('buildMotionPlanShader', () => {
    it('replaces the marker with motion plan functions', () => {
        const mockShader = `
uniform float uTime;
// __MOTION_PLAN_FUNCTIONS_MARKER__
void main() { }
`;
        const result = buildMotionPlanShader(mockShader);

        expect(result).toContain('#define MOTION_PLAN_ENABLED');
        expect(result).toContain('dispatchPrimitive');
        expect(result).toContain('evaluateMotionPlan');
        expect(result).not.toContain('__MOTION_PLAN_FUNCTIONS_MARKER__');
    });

    it('preserves non-marker shader code', () => {
        const mockShader = `
uniform float uTime;
uniform float uDrag;
// __MOTION_PLAN_FUNCTIONS_MARKER__
void main() {
    float x = uTime + uDrag;
}
`;
        const result = buildMotionPlanShader(mockShader);

        expect(result).toContain('uniform float uTime;');
        expect(result).toContain('uniform float uDrag;');
        expect(result).toContain('float x = uTime + uDrag;');
    });

    it('returns original shader if marker is missing', () => {
        const noMarker = 'void main() { gl_FragColor = vec4(1.0); }';
        const result = buildMotionPlanShader(noMarker);
        // Should still contain the original code (marker just won't be found)
        expect(result).toContain('void main()');
    });
});
