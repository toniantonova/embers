// ═══════════════════════════════════════════════════════════════════════
// PRIMITIVES.GLSL — 15 Parametric Motion Primitives + 3 Modifiers
//
// Each primitive computes a DISPLACEMENT vector from a particle's rest
// position. The displacement is fed into the existing spring-damper
// system: targetPos = restPos + displacement, then springs pull
// particles toward this animated target (free overshoot/settle).
//
// SIGNATURE:
//   vec3 prim_*(vec3 pos, vec3 restPos, float t, float attWeight, params...)
//     pos       — current world position
//     restPos   — static rest position (from morph target)
//     t         — normalized time [0,1] for one-shots, raw time for loopers
//     attWeight — attachment weight (0=joint, 1=extremity), scales displacement
//
// CATEGORIES:
//   Looping:  oscillate_bend, oscillate_translate, rigid_rotate, spiral,
//             laminar_flow, curl_noise_flow, wave_propagate,
//             stretch_along_axis, twist, pendulum
//   One-shot: arc_translate, spring_settle, radial_burst,
//             radial_contract, brownian_scatter
// ═══════════════════════════════════════════════════════════════════════


// ── CONSTANTS ─────────────────────────────────────────────────────────
#ifndef PI
#define PI 3.14159265359
#endif
#define TWO_PI 6.28318530718


// ── MODIFIERS ─────────────────────────────────────────────────────────

// Power-curve easing: t^exp for ease-in, 1-(1-t)^exp for ease-out,
// blended via smoothstep for ease-in-out.
float ease_in_out(float t, float exponent) {
    float tClamped = clamp(t, 0.0, 1.0);
    float easeIn = pow(tClamped, exponent);
    float easeOut = 1.0 - pow(1.0 - tClamped, exponent);
    return mix(easeIn, easeOut, tClamped);
}

// Overshoot then settle: displacement overshoots by `amount` then
// decays to 1.0 over time. Models elastic deformation.
vec3 apply_overshoot(vec3 displacement, float amount, float settle, float t) {
    float overshoot = 1.0 + amount * sin(t * PI) * exp(-settle * t);
    return displacement * overshoot;
}

// Per-cycle micro-variation: adds high-frequency noise to prevent
// robotic repetition. Uses a pseudo-random hash for determinism.
float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

vec3 apply_jitter(vec3 displacement, float amplitude, float frequency, float seed) {
    float jx = hash11(seed * 127.1 + frequency * 311.7) - 0.5;
    float jy = hash11(seed * 269.5 + frequency * 183.3) - 0.5;
    float jz = hash11(seed * 419.2 + frequency * 571.1) - 0.5;
    return displacement + vec3(jx, jy, jz) * amplitude;
}


// ── PRIMITIVE 0: OSCILLATE_BEND ───────────────────────────────────────
// Limb bending, nodding, tail wagging.
// Displacement perpendicular to the bend axis, amplitude scaled by
// attachment weight (tip moves more than joint).
//
// p0-p2: axis (vec3)
// p3: amplitude (radians)
// p4: frequency (Hz)
// p5: phase offset (0–1)
vec3 prim_oscillate_bend(vec3 pos, vec3 restPos, float t, float attWeight,
                          float p0, float p1, float p2, float p3,
                          float p4, float p5) {
    vec3 axis = normalize(vec3(p0, p1, p2));
    float angle = sin(t * p4 * TWO_PI + p5 * TWO_PI) * p3 * attWeight;

    // Displacement perpendicular to axis, proportional to distance from axis
    vec3 toPos = restPos - dot(restPos, axis) * axis;
    float dist = length(toPos);
    vec3 perpDir = dist > 0.001 ? normalize(toPos) : vec3(0.0, 1.0, 0.0);

    // Cross product gives the bend direction
    vec3 bendDir = cross(axis, perpDir);
    return bendDir * sin(angle) * dist;
}


// ── PRIMITIVE 1: OSCILLATE_TRANSLATE ──────────────────────────────────
// Side-to-side sway, bobbing, breathing-like motion.
// Simple sinusoidal displacement along a direction.
//
// p0-p2: direction (vec3)
// p3: amplitude
// p4: frequency (Hz)
// p5: phase offset (0–1)
vec3 prim_oscillate_translate(vec3 pos, vec3 restPos, float t, float attWeight,
                               float p0, float p1, float p2, float p3,
                               float p4, float p5) {
    vec3 dir = normalize(vec3(p0, p1, p2));
    float disp = sin(t * p4 * TWO_PI + p5 * TWO_PI) * p3 * attWeight;
    return dir * disp;
}


// ── PRIMITIVE 2: ARC_TRANSLATE (ONE-SHOT) ─────────────────────────────
// Jumping arc: parabolic trajectory.
// x = forward × t, y = 4h × t × (1-t) where t is normalized time.
//
// p0: apex height
// p1: forward distance
// p2-p4: forward direction (vec3)
vec3 prim_arc_translate(vec3 pos, vec3 restPos, float t, float attWeight,
                         float p0, float p1, float p2, float p3, float p4) {
    float tc = clamp(t, 0.0, 1.0);
    vec3 fwd = normalize(vec3(p2, p3, p4));
    float height = 4.0 * p0 * tc * (1.0 - tc); // parabola peaks at t=0.5
    float forward = p1 * tc;
    return (fwd * forward + vec3(0.0, height, 0.0)) * attWeight;
}


// ── PRIMITIVE 3: RIGID_ROTATE ─────────────────────────────────────────
// Head turning, spinning. Applies a rotation matrix around a pivot.
// Displacement = rotated(pos - pivot) - (pos - pivot).
//
// p0-p2: pivot point (vec3)
// p3-p5: rotation axis (vec3)
// p6: amplitude (radians)
// p7: frequency (Hz)
vec3 prim_rigid_rotate(vec3 pos, vec3 restPos, float t, float attWeight,
                        float p0, float p1, float p2, float p3,
                        float p4, float p5, float p6, float p7) {
    vec3 pivot = vec3(p0, p1, p2);
    vec3 axis = normalize(vec3(p3, p4, p5));
    float angle = sin(t * p7 * TWO_PI) * p6 * attWeight;

    // Rodrigues' rotation formula
    vec3 v = restPos - pivot;
    float cosA = cos(angle);
    float sinA = sin(angle);
    vec3 rotated = v * cosA + cross(axis, v) * sinA + axis * dot(axis, v) * (1.0 - cosA);
    return rotated - v; // displacement from rest
}


// ── PRIMITIVE 4: SPRING_SETTLE (ONE-SHOT) ─────────────────────────────
// Bouncing landing. Critically damped spring toward target offset.
// Uses the analytic solution: x(t) = offset × (1 - (1 + wt) × e^(-wt))
//
// p0-p2: target offset (vec3)
// p3: stiffness (omega)
// p4: damping ratio
vec3 prim_spring_settle(vec3 pos, vec3 restPos, float t, float attWeight,
                         float p0, float p1, float p2, float p3, float p4) {
    vec3 target = vec3(p0, p1, p2);
    float tc = clamp(t, 0.0, 1.0);
    float w = p3;
    float d = p4;

    // Critically damped response: approaches target with overshoot
    float decay = exp(-w * d * tc * 5.0);
    float settle = 1.0 - (1.0 + w * tc * 5.0) * decay;

    return target * settle * attWeight;
}


// ── PRIMITIVE 5: RADIAL_BURST (ONE-SHOT) ──────────────────────────────
// Explosion: particles fly outward from origin, energy decays.
// displacement = normalize(pos - origin) × strength × e^(-decay × t)
//
// p0-p2: origin (vec3)
// p3: strength
// p4: decay rate
vec3 prim_radial_burst(vec3 pos, vec3 restPos, float t, float attWeight,
                        float p0, float p1, float p2, float p3, float p4) {
    vec3 origin = vec3(p0, p1, p2);
    vec3 dir = restPos - origin;
    float dist = length(dir);
    if (dist < 0.001) dir = vec3(0.0, 1.0, 0.0); else dir = dir / dist;

    float tc = clamp(t, 0.0, 1.0);
    float energy = p3 * exp(-p4 * tc * 5.0);
    return dir * energy * attWeight;
}


// ── PRIMITIVE 6: RADIAL_CONTRACT (ONE-SHOT) ───────────────────────────
// Gathering: particles contract toward a target center.
// displacement = toward_center × strength, decaying over time.
//
// p0-p2: target center (vec3)
// p3: strength
// p4: decay rate
vec3 prim_radial_contract(vec3 pos, vec3 restPos, float t, float attWeight,
                           float p0, float p1, float p2, float p3, float p4) {
    vec3 center = vec3(p0, p1, p2);
    vec3 toCenter = center - restPos;
    float tc = clamp(t, 0.0, 1.0);
    float strength = p3 * (1.0 - exp(-p4 * tc * 3.0));
    return toCenter * strength * attWeight;
}


// ── PRIMITIVE 7: SPIRAL ───────────────────────────────────────────────
// Tornado: rotational + radial displacement around an axis.
//
// p0-p2: center (vec3)
// p3-p5: axis (vec3)
// p6: angular speed (rad/s)
// p7: radial speed
vec3 prim_spiral(vec3 pos, vec3 restPos, float t, float attWeight,
                  float p0, float p1, float p2, float p3,
                  float p4, float p5, float p6, float p7) {
    vec3 center = vec3(p0, p1, p2);
    vec3 axis = normalize(vec3(p3, p4, p5));

    vec3 v = restPos - center;
    // Project out the axis component
    vec3 radial = v - dot(v, axis) * axis;
    float r = length(radial);

    float angle = t * p6 * attWeight;

    // Rodrigues' rotation for the angular component
    float cosA = cos(angle);
    float sinA = sin(angle);
    vec3 rotated = radial * cosA + cross(axis, radial) * sinA;

    // Radial expansion/contraction
    float radialScale = 1.0 + p7 * sin(t * 0.5) * attWeight;

    return (rotated * radialScale - radial);
}


// ── PRIMITIVE 8: LAMINAR_FLOW ─────────────────────────────────────────
// Flowing, streaming: constant displacement along direction.
// Uses fract() for wrapping so particles cycle through.
//
// p0-p2: direction (vec3)
// p3: speed
vec3 prim_laminar_flow(vec3 pos, vec3 restPos, float t, float attWeight,
                        float p0, float p1, float p2, float p3) {
    vec3 dir = normalize(vec3(p0, p1, p2));
    // Wrap displacement so particles recycle
    float progress = fract(t * p3 * 0.1) * 2.0 - 1.0; // [-1, 1]
    return dir * progress * attWeight * 3.0;
}


// ── PRIMITIVE 9: CURL_NOISE_FLOW ──────────────────────────────────────
// Organic drift using curl noise displacement.
// This reuses the existing curlNoise() function from velocity.frag.glsl.
// NOTE: curlNoise() must be defined before this file is included.
//
// p0: scale (spatial frequency)
// p1: speed (temporal frequency)
// p2: amplitude
vec3 prim_curl_noise_flow(vec3 pos, vec3 restPos, float t, float attWeight,
                           float p0, float p1, float p2) {
    vec3 samplePos = restPos * p0 + t * p1;
    vec3 curl = curlNoise(samplePos);
    return curl * p2 * attWeight;
}


// ── PRIMITIVE 10: BROWNIAN_SCATTER (ONE-SHOT) ─────────────────────────
// Dissolving: pseudo-random displacement that grows over time.
// Uses hash of particle position for deterministic randomness.
//
// p0: diffusion rate
// p1: seed (from particle UV / position hash)
vec3 prim_brownian_scatter(vec3 pos, vec3 restPos, float t, float attWeight,
                            float p0, float p1) {
    float tc = clamp(t, 0.0, 1.0);
    float h1 = hash11(p1 * 127.1 + restPos.x * 311.7);
    float h2 = hash11(p1 * 269.5 + restPos.y * 183.3);
    float h3 = hash11(p1 * 419.2 + restPos.z * 571.1);
    vec3 randomDir = normalize(vec3(h1 - 0.5, h2 - 0.5, h3 - 0.5));
    return randomDir * p0 * tc * tc * attWeight; // quadratic ramp
}


// ── PRIMITIVE 11: WAVE_PROPAGATE ──────────────────────────────────────
// Ripple: displacement perpendicular to wave direction.
// sin(dot(pos, dir) × 2π/wavelength − time × speed) × amplitude
//
// p0-p2: direction (vec3)
// p3: wavelength
// p4: amplitude
// p5: speed
vec3 prim_wave_propagate(vec3 pos, vec3 restPos, float t, float attWeight,
                          float p0, float p1, float p2, float p3,
                          float p4, float p5) {
    vec3 dir = normalize(vec3(p0, p1, p2));
    float spatial = dot(restPos, dir);
    float wave = sin(spatial * TWO_PI / max(p3, 0.01) - t * p5) * p4;

    // Displacement perpendicular to wave direction (upward bias)
    vec3 perpDir = vec3(0.0, 1.0, 0.0);
    if (abs(dot(dir, perpDir)) > 0.99) perpDir = vec3(1.0, 0.0, 0.0);
    perpDir = normalize(perpDir - dot(perpDir, dir) * dir);

    return perpDir * wave * attWeight;
}


// ── PRIMITIVE 12: STRETCH_ALONG_AXIS ──────────────────────────────────
// Growing, pulsing: displacement along axis proportional to distance
// from center × (scale - 1) × sin modulation.
//
// p0-p2: axis (vec3)
// p3: scale factor
// p4: frequency (Hz)
vec3 prim_stretch_along_axis(vec3 pos, vec3 restPos, float t, float attWeight,
                              float p0, float p1, float p2, float p3, float p4) {
    vec3 axis = normalize(vec3(p0, p1, p2));
    float distAlongAxis = dot(restPos, axis);
    float scaleMod = sin(t * p4 * TWO_PI) * (p3 - 1.0) * 0.5 + (p3 - 1.0) * 0.5;
    return axis * distAlongAxis * scaleMod * attWeight;
}


// ── PRIMITIVE 13: TWIST ───────────────────────────────────────────────
// Wringing, coiling: rotation angle increases along the axis direction.
// Particles further along the axis rotate more.
//
// p0-p2: axis (vec3)
// p3: angle per unit distance (radians)
// p4: frequency (Hz)
vec3 prim_twist(vec3 pos, vec3 restPos, float t, float attWeight,
                 float p0, float p1, float p2, float p3, float p4) {
    vec3 axis = normalize(vec3(p0, p1, p2));
    float distAlongAxis = dot(restPos, axis);
    float angle = distAlongAxis * p3 * sin(t * p4 * TWO_PI) * attWeight;

    // Rodrigues' rotation on the radial component
    vec3 radial = restPos - distAlongAxis * axis;
    float cosA = cos(angle);
    float sinA = sin(angle);
    vec3 rotated = radial * cosA + cross(axis, radial) * sinA;
    return rotated - radial;
}


// ── PRIMITIVE 14: PENDULUM ────────────────────────────────────────────
// Swinging: damped pendulum from a pivot point.
// Uses the small-angle approximation: θ(t) = A × e^(-d×t) × cos(ω×t)
//
// p0-p2: pivot point (vec3)
// p3: length (distance from pivot to restPos, used for period)
// p4: amplitude (radians)
// p5: damping
vec3 prim_pendulum(vec3 pos, vec3 restPos, float t, float attWeight,
                    float p0, float p1, float p2, float p3,
                    float p4, float p5) {
    vec3 pivot = vec3(p0, p1, p2);
    vec3 arm = restPos - pivot;
    float armLen = length(arm);
    if (armLen < 0.001) return vec3(0.0);

    // Natural frequency from pendulum length (ω = √(g/L))
    float omega = sqrt(9.81 / max(p3, 0.01));
    float theta = p4 * exp(-p5 * t) * cos(omega * t);

    // Swing in the XZ plane relative to the arm direction
    vec3 swingAxis = vec3(0.0, 0.0, 1.0);
    float cosT = cos(theta * attWeight);
    float sinT = sin(theta * attWeight);
    vec3 rotated = arm * cosT + cross(swingAxis, arm) * sinT
                 + swingAxis * dot(swingAxis, arm) * (1.0 - cosT);
    return rotated - arm;
}


// ── DISPATCH ──────────────────────────────────────────────────────────
// Calls the correct primitive based on primitiveId.
// Parameters p0–p11 are read from the motion plan data texture.
// Cascaded 4-way branches to minimize GPU branch divergence.
vec3 dispatchPrimitive(int primId, vec3 pos, vec3 restPos, float t,
                        float attWeight, float p0, float p1, float p2,
                        float p3, float p4, float p5, float p6,
                        float p7, float p8, float p9, float p10, float p11) {
    vec3 disp = vec3(0.0);

    if (primId < 4) {
        if (primId == 0) {
            disp = prim_oscillate_bend(pos, restPos, t, attWeight, p0, p1, p2, p3, p4, p5);
        } else if (primId == 1) {
            disp = prim_oscillate_translate(pos, restPos, t, attWeight, p0, p1, p2, p3, p4, p5);
        } else if (primId == 2) {
            disp = prim_arc_translate(pos, restPos, t, attWeight, p0, p1, p2, p3, p4);
        } else {
            disp = prim_rigid_rotate(pos, restPos, t, attWeight, p0, p1, p2, p3, p4, p5, p6, p7);
        }
    } else if (primId < 8) {
        if (primId == 4) {
            disp = prim_spring_settle(pos, restPos, t, attWeight, p0, p1, p2, p3, p4);
        } else if (primId == 5) {
            disp = prim_radial_burst(pos, restPos, t, attWeight, p0, p1, p2, p3, p4);
        } else if (primId == 6) {
            disp = prim_radial_contract(pos, restPos, t, attWeight, p0, p1, p2, p3, p4);
        } else {
            disp = prim_spiral(pos, restPos, t, attWeight, p0, p1, p2, p3, p4, p5, p6, p7);
        }
    } else if (primId < 12) {
        if (primId == 8) {
            disp = prim_laminar_flow(pos, restPos, t, attWeight, p0, p1, p2, p3);
        } else if (primId == 9) {
            disp = prim_curl_noise_flow(pos, restPos, t, attWeight, p0, p1, p2);
        } else if (primId == 10) {
            disp = prim_brownian_scatter(pos, restPos, t, attWeight, p0, p1);
        } else {
            disp = prim_wave_propagate(pos, restPos, t, attWeight, p0, p1, p2, p3, p4, p5);
        }
    } else {
        if (primId == 12) {
            disp = prim_stretch_along_axis(pos, restPos, t, attWeight, p0, p1, p2, p3, p4);
        } else if (primId == 13) {
            disp = prim_twist(pos, restPos, t, attWeight, p0, p1, p2, p3, p4);
        } else {
            disp = prim_pendulum(pos, restPos, t, attWeight, p0, p1, p2, p3, p4, p5);
        }
    }

    return disp;
}
