// ═══════════════════════════════════════════════════════════════════════
// MOTION-PLAN.GLSL — Motion plan data texture reads + evaluation.
//
// The motion plan is stored in a DataTexture (33×4 RGBA Float32):
//   Row 0:     whole-body motion
//   Rows 1–32: per-part motion (indexed by partId)
//
// Each row has 4 pixels × 4 channels = 16 floats:
//   Pixel 0: [primitiveId, phase, startTime, duration]
//   Pixel 1: [p0, p1, p2, p3]
//   Pixel 2: [p4, p5, p6, p7]
//   Pixel 3: [p8, p9, p10, p11]
//
// Part attributes are in tPartAttr (same size as position texture):
//   R = partId (integer-valued float, 0–31)
//   G = attachmentWeight (0.0 at joint, 1.0 at extremity)
//
// Crossfade: tMotionPlanB holds a second plan. uBlendFactor[0,1]
// interpolates between plan A and plan B.
// ═══════════════════════════════════════════════════════════════════════

uniform sampler2D tPartAttr;
uniform sampler2D tMotionPlan;
uniform sampler2D tMotionPlanB;
uniform float uMotionPlanActive;
uniform float uMotionSpeedScale;
uniform float uMotionAmplitudeScale;
uniform float uBlendFactor;

// A1 audio uniforms for motion modulation
uniform float uPitchDeviation;
uniform float uPitchConfidence;
uniform float uEmotionArousal;
uniform float uEmotionValence;


// ── READ PART MOTION FROM DATA TEXTURE ────────────────────────────────
// Reads the 16 floats for a given row in the motion plan texture.
// The texture is 33 pixels wide × 4 pixels tall... actually let's
// lay it out as 4 columns × 33 rows for easier row-based lookup.
//
// With a 4×33 texture:
//   u = column / 4.0 (which of the 4 pixels in the row)
//   v = row / 33.0

struct PartMotionGPU {
    int primitiveId;
    float phase;
    float startTime;
    float duration;
    float params[12];
    bool isActive;
};

PartMotionGPU readPartMotion(sampler2D planTex, int partRow) {
    PartMotionGPU pm;

    // Texture coordinates for each of the 4 pixels in this row
    // Add 0.5 to sample pixel centers
    float v = (float(partRow) + 0.5) / 33.0;
    vec4 px0 = texture2D(planTex, vec2(0.125, v)); // col 0
    vec4 px1 = texture2D(planTex, vec2(0.375, v)); // col 1
    vec4 px2 = texture2D(planTex, vec2(0.625, v)); // col 2
    vec4 px3 = texture2D(planTex, vec2(0.875, v)); // col 3

    pm.primitiveId = int(px0.r + 0.5);
    pm.phase = px0.g;
    pm.startTime = px0.b;
    pm.duration = px0.a;

    pm.params[0] = px1.r;  pm.params[1] = px1.g;
    pm.params[2] = px1.b;  pm.params[3] = px1.a;
    pm.params[4] = px2.r;  pm.params[5] = px2.g;
    pm.params[6] = px2.b;  pm.params[7] = px2.a;
    pm.params[8] = px3.r;  pm.params[9] = px3.g;
    pm.params[10] = px3.b; pm.params[11] = px3.a;

    // primitiveId < 0 or duration < 0 means inactive
    pm.isActive = (pm.primitiveId >= 0);

    return pm;
}


// ── COMPUTE TIME PARAMETER ────────────────────────────────────────────
// For looping primitives: raw time (caller uses fract or sin internally)
// For one-shot primitives: normalized t = clamp((now - start) / dur, 0, 1)
float computeTime(PartMotionGPU pm, float currentTime, float speedScale) {
    float t;
    if (pm.duration > 0.0) {
        // One-shot: normalized progress [0, 1]
        t = clamp((currentTime - pm.startTime) / pm.duration, 0.0, 1.0);
    } else {
        // Looping: raw time scaled by speed
        t = (currentTime - pm.startTime) * speedScale + pm.phase;
    }
    return t;
}


// ── EVALUATE SINGLE PLAN ──────────────────────────────────────────────
vec3 evaluateSinglePlan(sampler2D planTex, vec2 uv, vec3 pos, vec3 restPos,
                         float currentTime, float speedScale, float ampScale) {
    // Read part attributes for this particle
    vec4 attr = texture2D(tPartAttr, uv);
    int partId = int(attr.r + 0.5);
    float attWeight = attr.g;

    vec3 totalDisp = vec3(0.0);

    // 1. Whole-body motion (row 0)
    PartMotionGPU wb = readPartMotion(planTex, 0);
    if (wb.isActive) {
        float t = computeTime(wb, currentTime, speedScale);
        // Whole-body uses attWeight = 1.0 (uniform effect on all particles)
        vec3 wbDisp = dispatchPrimitive(
            wb.primitiveId, pos, restPos, t, 1.0,
            wb.params[0], wb.params[1], wb.params[2], wb.params[3],
            wb.params[4], wb.params[5], wb.params[6], wb.params[7],
            wb.params[8], wb.params[9], wb.params[10], wb.params[11]
        );
        totalDisp += wbDisp * ampScale;
    }

    // 2. Per-part motion (row = partId, 1-indexed in texture)
    // partId 0 = unassigned → no per-part motion, whole-body only
    if (partId > 0 && partId <= 32) {
        PartMotionGPU pm = readPartMotion(planTex, partId);
        if (pm.isActive) {
            float t = computeTime(pm, currentTime, speedScale);
            vec3 partDisp = dispatchPrimitive(
                pm.primitiveId, pos, restPos, t, attWeight,
                pm.params[0], pm.params[1], pm.params[2], pm.params[3],
                pm.params[4], pm.params[5], pm.params[6], pm.params[7],
                pm.params[8], pm.params[9], pm.params[10], pm.params[11]
            );
            totalDisp += partDisp * ampScale;
        }
    }

    return totalDisp;
}


// ── EVALUATE FULL MOTION PLAN (with crossfade) ────────────────────────
vec3 evaluateMotionPlan(vec2 uv, vec3 pos, vec3 restPos, float currentTime) {
    vec3 dispA = evaluateSinglePlan(
        tMotionPlan, uv, pos, restPos, currentTime,
        uMotionSpeedScale, uMotionAmplitudeScale
    );

    if (uBlendFactor > 0.001) {
        vec3 dispB = evaluateSinglePlan(
            tMotionPlanB, uv, pos, restPos, currentTime,
            uMotionSpeedScale, uMotionAmplitudeScale
        );
        return mix(dispA, dispB, uBlendFactor);
    }

    return dispA;
}
