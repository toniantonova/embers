/**
 * MotionPlanManager.dispose.test.ts — Tests for resource cleanup and edge cases.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * 1. dispose() frees GPU textures (calls .dispose() on internal DataTextures)
 * 2. Multiple setMotionPlan() calls don't leak textures
 * 3. Edge case: dispose() after clearing a plan
 * 4. Edge case: update() when not blending is a no-op
 */

import { describe, it, expect, vi } from 'vitest';
import {
    MotionPlanManager,
} from '../engine/particle-system-extensions';
import {
    PRIMITIVE_IDS,
    createEmptyMotionPlan,
} from '../renderer/types';
import type { PartMotionData } from '../renderer/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        primitiveId: primitiveId as any,
        params: paddedParams,
        phase: 0,
        startTime: 0,
        duration,
        active,
    };
}


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: DISPOSE
// ══════════════════════════════════════════════════════════════════════

describe('MotionPlanManager — dispose()', () => {
    it('calls dispose on internal textures', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 4);

        // Spy on the texture dispose methods
        const planTexDispose = vi.spyOn(uniforms.tMotionPlan.value, 'dispose');
        const planTexBDispose = vi.spyOn(uniforms.tMotionPlanB.value, 'dispose');

        manager.dispose();

        expect(planTexDispose).toHaveBeenCalled();
        expect(planTexBDispose).toHaveBeenCalled();
    });

    it('disposes part attribute texture if it exists', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 4);

        // Create a part attribute texture
        const partIds = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
        const weights = new Array(16).fill(1.0);
        const tex = manager.createPartAttributeTexture(partIds, weights);
        const texDispose = vi.spyOn(tex, 'dispose');

        manager.dispose();

        expect(texDispose).toHaveBeenCalled();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: UPDATE NO-OP WHEN NOT BLENDING
// ══════════════════════════════════════════════════════════════════════

describe('MotionPlanManager — update() no-op', () => {
    it('does nothing when not blending', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 4);

        // Set a plan (not crossfading)
        const plan = createEmptyMotionPlan();
        plan.wholeBody = createPartMotion(PRIMITIVE_IDS.SPIRAL, [0, 0, 0, 0, 1, 0, 2, 0.3]);
        manager.setMotionPlan(plan);

        const blendBefore = manager.blendFactor;
        manager.update();
        const blendAfter = manager.blendFactor;

        expect(blendBefore).toBe(0);
        expect(blendAfter).toBe(0);
        expect(manager.isBlending).toBe(false);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: OVERWRITE PLAN
// ══════════════════════════════════════════════════════════════════════

describe('MotionPlanManager — Overwrite Plan', () => {
    it('setMotionPlan replaces previous plan cleanly', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 4);

        const plan1 = createEmptyMotionPlan();
        plan1.wholeBody = createPartMotion(PRIMITIVE_IDS.SPIRAL, [0, 0, 0, 0, 1]);
        plan1.speedScale = 1.0;
        manager.setMotionPlan(plan1);

        expect(manager.isActive).toBe(true);
        expect(uniforms.uMotionSpeedScale.value).toBe(1.0);

        const plan2 = createEmptyMotionPlan();
        plan2.wholeBody = createPartMotion(PRIMITIVE_IDS.TWIST, [0, 1, 0, 2.0]);
        plan2.speedScale = 2.5;
        manager.setMotionPlan(plan2);

        expect(manager.isActive).toBe(true);
        expect(manager.plan).toBe(plan2);
        expect(uniforms.uMotionSpeedScale.value).toBe(2.5);
        expect(manager.isBlending).toBe(false); // not blending, just replaced
    });

    it('clearing then setting a new plan works', () => {
        const uniforms = createMockUniforms();
        const manager = new MotionPlanManager(uniforms, 4);

        const plan1 = createEmptyMotionPlan();
        plan1.wholeBody = createPartMotion(PRIMITIVE_IDS.SPIRAL);
        manager.setMotionPlan(plan1);
        manager.clearMotionPlan();

        expect(manager.isActive).toBe(false);

        const plan2 = createEmptyMotionPlan();
        plan2.wholeBody = createPartMotion(PRIMITIVE_IDS.TWIST);
        manager.setMotionPlan(plan2);

        expect(manager.isActive).toBe(true);
        expect(manager.plan).toBe(plan2);
    });
});
