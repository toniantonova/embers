/**
 * MotionPlanManager — Companion class for ParticleSystem that manages
 * motion plan data textures and crossfade state.
 *
 * ARCHITECTURE:
 * ─────────────
 * This class does NOT subclass ParticleSystem. It takes a reference to
 * the velocity shader uniform object and manages the motion-plan-specific
 * uniforms: tPartAttr, tMotionPlan, tMotionPlanB, uBlendFactor, etc.
 *
 * It also handles:
 *   - Packing MotionPlanData into RGBA Float32 DataTextures
 *   - Crossfade animation (dual motion plan buffers)
 *   - Part ID + attachment weight texture management
 *   - Shader source concatenation (prepends primitives.glsl + motion-plan.glsl)
 *
 * USAGE:
 * ──────
 * const manager = new MotionPlanManager(particleSystem);
 * manager.setMotionPlan(planData);
 * manager.crossfadeTo(newPlanData, 1000); // 1s crossfade
 * manager.clearMotionPlan(); // revert to spring-only
 */

import * as THREE from 'three';
import type {
    MotionPlanData,
    PartMotionData,
} from '../renderer/types';
import {
    MOTION_PLAN_TEX_WIDTH,
    MOTION_PLAN_TEX_HEIGHT,
    MAX_PARTS,
    PARAMS_PER_PART,
} from '../renderer/types';

// Import GLSL shader sources for concatenation
import primitivesGlsl from '../shaders/primitives.glsl?raw';
import motionPlanGlsl from '../shaders/motion-plan.glsl?raw';


/**
 * Prepend motion plan GLSL functions to the velocity shader source.
 * Inserts primitives.glsl + motion-plan.glsl before the
 * __MOTION_PLAN_FUNCTIONS_MARKER__ comment, and adds #define
 * MOTION_PLAN_ENABLED so the motion plan code path is compiled.
 *
 * @param velocityShaderSource - Raw velocity.frag.glsl source
 * @returns Modified shader source with motion plan functions injected
 */
export function buildMotionPlanShader(velocityShaderSource: string): string {
    const motionPlanFunctions = `
// ══════════════════════════════════════════════════════════════════
// BEGIN A2 MOTION PLAN FUNCTIONS (auto-injected by MotionPlanManager)
// ══════════════════════════════════════════════════════════════════
#define MOTION_PLAN_ENABLED

${primitivesGlsl}

${motionPlanGlsl}

// ══════════════════════════════════════════════════════════════════
// END A2 MOTION PLAN FUNCTIONS
// ══════════════════════════════════════════════════════════════════
`;

    return velocityShaderSource.replace(
        '// __MOTION_PLAN_FUNCTIONS_MARKER__',
        motionPlanFunctions
    );
}


export class MotionPlanManager {
    /** Reference to the velocity shader uniforms. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- uniform values are heterogeneous (number, Vector3, Texture, etc.)
    private uniforms: Record<string, { value: any }>;

    /** Current plan A data texture. */
    private planTexture: THREE.DataTexture;

    /** Plan B data texture (for crossfade). */
    private planTextureB: THREE.DataTexture;

    /** Part attribute texture (partId + attachmentWeight). */
    private partAttrTexture: THREE.DataTexture | null = null;

    /** Crossfade state. */
    private blending = false;
    private blendStartTime = 0;
    private blendDuration = 0;

    /** Current motion plan (CPU copy for inspection). */
    private currentPlan: MotionPlanData | null = null;

    /** Texture size (matches ParticleSystem's texture size, e.g. 128). */
    private textureSize: number;

    constructor(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches getVelocityUniforms() return type
        uniforms: Record<string, { value: any }>,
        textureSize: number = 128
    ) {
        this.uniforms = uniforms;
        this.textureSize = textureSize;

        // Create empty motion plan textures
        this.planTexture = this.createPlanTexture();
        this.planTextureB = this.createPlanTexture();

        // Initialize uniforms (these are added to the velocity shader)
        this.uniforms.tPartAttr = { value: null };
        this.uniforms.tMotionPlan = { value: this.planTexture };
        this.uniforms.tMotionPlanB = { value: this.planTextureB };
        this.uniforms.uMotionPlanActive = { value: 0.0 };
        this.uniforms.uMotionSpeedScale = { value: 1.0 };
        this.uniforms.uMotionAmplitudeScale = { value: 1.0 };
        this.uniforms.uBlendFactor = { value: 0.0 };

        // A1 audio uniforms for motion modulation
        this.uniforms.uPitchDeviation = this.uniforms.uPitchDeviation || { value: 0.0 };
        this.uniforms.uPitchConfidence = this.uniforms.uPitchConfidence || { value: 0.0 };
        this.uniforms.uEmotionArousal = this.uniforms.uEmotionArousal || { value: 0.0 };
        this.uniforms.uEmotionValence = this.uniforms.uEmotionValence || { value: 0.0 };
    }


    // ── MOTION PLAN MANAGEMENT ────────────────────────────────────────

    /**
     * Activate a motion plan. Packs the plan data into a DataTexture
     * and sets the shader to use it.
     */
    setMotionPlan(plan: MotionPlanData): void {
        this.currentPlan = plan;
        this.packPlanIntoTexture(plan, this.planTexture);
        this.uniforms.tMotionPlan.value = this.planTexture;
        this.uniforms.uMotionPlanActive.value = 1.0;
        this.uniforms.uMotionSpeedScale.value = plan.speedScale;
        this.uniforms.uMotionAmplitudeScale.value = plan.amplitudeScale;
        this.uniforms.uBlendFactor.value = 0.0;
        this.blending = false;

        console.log('[MotionPlanManager] Motion plan activated');
    }

    /**
     * Begin a crossfade from the current plan to a new plan.
     *
     * @param plan - The new plan (becomes plan B during crossfade)
     * @param durationMs - Crossfade duration in milliseconds
     */
    crossfadeTo(plan: MotionPlanData, durationMs: number): void {
        // Upload new plan as plan B
        this.packPlanIntoTexture(plan, this.planTextureB);
        this.uniforms.tMotionPlanB.value = this.planTextureB;

        // Start blending
        this.blending = true;
        this.blendStartTime = performance.now();
        this.blendDuration = durationMs;
        this.uniforms.uBlendFactor.value = 0.0;

        // Store the incoming plan for the swap at completion
        this.currentPlan = plan;

        console.log(`[MotionPlanManager] Crossfade started (${durationMs}ms)`);
    }

    /**
     * Clear the motion plan — reverts to existing spring-only behavior.
     */
    clearMotionPlan(): void {
        this.currentPlan = null;
        this.uniforms.uMotionPlanActive.value = 0.0;
        this.uniforms.uBlendFactor.value = 0.0;
        this.blending = false;

        console.log('[MotionPlanManager] Motion plan cleared');
    }

    /**
     * Called every frame to update crossfade animation.
     * Should be called from ParticleSystem.update() or Canvas.tsx's loop.
     */
    update(): void {
        if (!this.blending) return;

        const elapsed = performance.now() - this.blendStartTime;
        const progress = Math.min(1.0, elapsed / this.blendDuration);
        this.uniforms.uBlendFactor.value = progress;

        // Crossfade complete — swap plan B → plan A
        if (progress >= 1.0) {
            this.completeCrossfade();
        }
    }

    /**
     * Complete the crossfade: copy plan B data into plan A, reset blend.
     * At this point blendFactor=1.0 (100% plan B), and after the swap
     * plan A contains plan B's data with blendFactor=0.0 (100% plan A).
     * The output is identical — no visual pop.
     */
    private completeCrossfade(): void {
        // Swap: copy plan B's texture data into plan A
        const srcData = this.planTextureB.image.data;
        const dstData = this.planTexture.image.data;
        (dstData as Float32Array).set(srcData as Float32Array);
        this.planTexture.needsUpdate = true;

        // Reset blend
        this.uniforms.uBlendFactor.value = 0.0;
        this.uniforms.tMotionPlan.value = this.planTexture;
        this.blending = false;

        console.log('[MotionPlanManager] Crossfade complete — plan B → plan A swap');
    }


    // ── PART ATTRIBUTES ───────────────────────────────────────────────

    /**
     * Set the part attribute texture (partId + attachmentWeight).
     *
     * @param texture - DataTexture where R=partId (int float), G=attachmentWeight
     */
    setPartAttributes(texture: THREE.DataTexture): void {
        this.partAttrTexture = texture;
        this.uniforms.tPartAttr.value = texture;
    }

    /**
     * Create a part attribute texture from arrays of part IDs and
     * attachment weights (one entry per particle).
     *
     * @param partIds - Part ID per particle (0–31)
     * @param attachmentWeights - Attachment weight per particle (0.0–1.0)
     * @returns The created DataTexture
     */
    createPartAttributeTexture(
        partIds: number[] | Uint8Array,
        attachmentWeights: number[] | Float32Array
    ): THREE.DataTexture {
        const count = this.textureSize * this.textureSize;
        const data = new Float32Array(count * 4); // RGBA

        for (let i = 0; i < count; i++) {
            data[i * 4 + 0] = i < partIds.length ? partIds[i] : 0;           // R = partId
            data[i * 4 + 1] = i < attachmentWeights.length ? attachmentWeights[i] : 1.0; // G = attWeight
            data[i * 4 + 2] = 0; // B unused
            data[i * 4 + 3] = 0; // A unused
        }

        const texture = new THREE.DataTexture(
            data,
            this.textureSize,
            this.textureSize,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        texture.needsUpdate = true;

        this.setPartAttributes(texture);
        return texture;
    }


    // ── GETTERS ─────────────────────────────────────────────────────────

    /** Whether a motion plan is currently active. */
    get isActive(): boolean {
        return this.uniforms.uMotionPlanActive.value > 0.5;
    }

    /** Whether a crossfade is in progress. */
    get isBlending(): boolean {
        return this.blending;
    }

    /** Current blend factor (0.0 = plan A, 1.0 = plan B). */
    get blendFactor(): number {
        return this.uniforms.uBlendFactor.value;
    }

    /** The current motion plan data (CPU copy), or null if inactive. */
    get plan(): MotionPlanData | null {
        return this.currentPlan;
    }


    // ── INTERNAL ────────────────────────────────────────────────────────

    /**
     * Create an empty motion plan DataTexture (4×33 RGBA Float32).
     * All primitiveIds are set to -1 (inactive marker).
     */
    private createPlanTexture(): THREE.DataTexture {
        const data = new Float32Array(
            MOTION_PLAN_TEX_WIDTH * MOTION_PLAN_TEX_HEIGHT * 4
        );
        // Set all primitiveIds to -1 (inactive)
        for (let row = 0; row < MOTION_PLAN_TEX_HEIGHT; row++) {
            data[row * MOTION_PLAN_TEX_WIDTH * 4] = -1.0;
        }

        const texture = new THREE.DataTexture(
            data,
            MOTION_PLAN_TEX_WIDTH,
            MOTION_PLAN_TEX_HEIGHT,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * Pack a MotionPlanData into an existing DataTexture.
     *
     * Layout per row (16 floats = 4 pixels × RGBA):
     *   [primitiveId, phase, startTime, duration, p0-p11]
     */
    private packPlanIntoTexture(plan: MotionPlanData, texture: THREE.DataTexture): void {
        const data = texture.image.data as Float32Array;
        data.fill(0);

        // Row 0: whole body
        this.packPartMotion(data, 0, plan.wholeBody);

        // Rows 1–32: per-part
        for (let i = 0; i < MAX_PARTS; i++) {
            const partMotion = plan.parts[i + 1] ?? null;
            if (partMotion) {
                this.packPartMotion(data, i + 1, partMotion);
            } else {
                // Inactive: primitiveId = -1
                data[(i + 1) * MOTION_PLAN_TEX_WIDTH * 4] = -1.0;
            }
        }

        texture.needsUpdate = true;
    }

    /**
     * Pack a single PartMotionData into the data array at the given row.
     */
    private packPartMotion(data: Float32Array, row: number, pm: PartMotionData): void {
        const base = row * MOTION_PLAN_TEX_WIDTH * 4;

        // Pixel 0: [primitiveId, phase, startTime, duration]
        data[base + 0] = pm.active ? pm.primitiveId : -1.0;
        data[base + 1] = pm.phase;
        data[base + 2] = pm.startTime;
        data[base + 3] = pm.duration;

        // Pixels 1–3: params p0–p11
        const params = pm.params;
        for (let i = 0; i < PARAMS_PER_PART; i++) {
            data[base + 4 + i] = i < params.length ? params[i] : 0;
        }
    }

    /**
     * Clean up GPU resources.
     */
    dispose(): void {
        this.planTexture.dispose();
        this.planTextureB.dispose();
        if (this.partAttrTexture) {
            this.partAttrTexture.dispose();
        }
    }
}
