# Shader Pipeline Documentation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GPU (per frame)                               │
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │ velocity.frag.glsl│───▶│position.frag.glsl│───▶│ render.vert + │ │
│  │                   │    │                   │    │ render.frag   │ │
│  │ Computes forces:  │    │ Integrates:       │    │               │ │
│  │ • Curl noise      │    │ pos += vel × dt   │    │ Draws points  │ │
│  │ • Spring to target│    │                   │    │ as soft discs │ │
│  │ • Pointer repulse │    │ Reads: velTex     │    │ with glow     │ │
│  │ • Drag            │    │ Writes: posTex    │    │               │ │
│  │ • Sentiment mvmt  │    │                   │    │ Reads: posTex │ │
│  │ • Motion plan     │    └──────────────────┘    └───────────────┘ │
│  │                   │                                               │
│  │ Reads: posTex,    │                                               │
│  │   targetTex,      │                                               │
│  │   audio uniforms  │                                               │
│  │ Writes: velTex    │                                               │
│  └──────────────────┘                                               │
│                                                                      │
│  128×128 textures = 16,384 particles (4 floats per pixel: RGBA)     │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow: CPU → GPU

```
AudioEngine.getFeatures()
        │
        ▼
UniformBridge.update()       ← applies TuningConfig influence multipliers
        │                    ← applies SemanticBackend overrides (abstraction, noise)
        │                    ← applies WorkspaceEngine state (breathing, arousal)
        ▼
ParticleSystem uniforms:
  uEnergy          [0-1]  ← RMS loudness → ring expansion, breathing speed
  uTension         [0-1]  ← spectral centroid → curl noise tightness, color warmth
  uUrgency         [0-1]  ← spectral flux → turbulence/chaos
  uBreathiness     [0-1]  ← ZCR + flatness → drag reduction, airiness
  uTextureComplexity[0-1] ← MFCC variance → noise variation
  uAbstraction     [0-1]  ← SemanticBackend → loose (1.0) vs concrete (0.0)
  uFormationScale  [0-1]  ← formation tightness
  uRepulsionRadius [0-2]  ← pointer interaction radius
  uSentimentColor  [-1,1] ← text sentiment → warm/cool color shift
  uSentimentMovement[-1,1]← emotion → LMA physics (joy=light, anger=heavy)
  uPointerPos      [vec3] ← mouse/touch world position
  uPointerActive   [0/1]  ← is pointer in canvas
  uTime            [float]← elapsed seconds
  uDt              [float]← frame delta time
```

## Force Composition (velocity.frag.glsl)

Forces are computed per-particle, per-frame. Order matters for readability
but not for correctness (they're all summed into a velocity delta):

```
totalForce = vec3(0.0)

1. CURL NOISE (organic ambient motion)
   amplitude = baseNoise × (1.0 + uEnergy × energyBoost)
   frequency modulated by uTension (higher tension = tighter curls)
   → totalForce += curlNoise(pos, time, frequency) × amplitude

2. SPRING FORCE (pulls toward morph target)
   displacement = targetPos - currentPos
   springK scales with (1.0 - uAbstraction)  // concrete = strong spring
   → totalForce += displacement × springK

3. POINTER REPULSION (mouse/touch interaction)
   if distance(pos, pointer) < uRepulsionRadius:
     → totalForce += repulsionDirection × strength

4. DRAG (viscous damping, prevents runaway velocity)
   reduced by uBreathiness (breathy voice = less drag = floatier)
   → totalForce -= velocity × dragCoeff

5. SENTIMENT MOVEMENT (Laban Movement Analysis)
   positive (joy): lighter spring, freer flow, calmer noise
   negative (anger): heavier spring, bound flow, sharper noise
   sad→angry interpolation via smoothstep on intensity
   → totalForce += sentimentModifiers

6. MOTION PLAN (per-part parametric animation)
   if motion plan active:
     reads primitives.glsl dispatch table
     evaluates per-part primitive (oscillate, arc, spiral, etc.)
     blends plan A ↔ plan B during crossfade
     → totalForce += motionPlanDisplacement × attachmentWeight
```

## Motion Plan System

The motion plan injects per-part animation on top of the base physics:

```
particle-system-extensions.ts          primitives.glsl
  MotionPlanManager                      15 parametric primitives:
  ├── setMotionPlan(plan)                 0: oscillate_bend
  ├── crossfadeTo(plan, ms)              1: oscillate_translate
  ├── clearMotionPlan()                  2: arc_translate
  └── update()                           3: rigid_rotate
        │                                4: spring_settle
        ▼                                5: radial_burst
  DataTexture (33 rows × 4px)            6: radial_contract
  Row 0: whole-body motion               7: spiral
  Rows 1-32: per-part motion             8: laminar_flow
                                         9: curl_noise_flow
motion-plan.glsl                        10: brownian_scatter
  readPartMotion(planTex, row)          11: wave_propagate
  computeTime(pm, t, speed)             12: stretch_along_axis
  evaluateSinglePlan(...)               13: twist
  evaluateMotionPlan(...)               14: pendulum
        │
        ▼                              dispatchPrimitive(id, pos, rest, t, ...)
  velocity.frag.glsl                     → vec3 displacement
  __MOTION_PLAN_FUNCTIONS_MARKER__
  (replaced at build time by
   buildMotionPlanShader())
```

## Shader Injection Point

`particle-system-extensions.ts` → `buildMotionPlanShader()` concatenates:
1. `primitives.glsl` (15 primitive functions + `dispatchPrimitive()`)
2. `motion-plan.glsl` (texture reads + evaluation + crossfade)
3. Replaces `__MOTION_PLAN_FUNCTIONS_MARKER__` in `velocity.frag.glsl`

This happens once at ParticleSystem init time, not per-frame.

## Texture Layout

| Texture | Size | Format | Contents |
|---------|------|--------|----------|
| positionTex | 128×128 | RGBA Float32 | xyz = position, w = unused |
| velocityTex | 128×128 | RGBA Float32 | xyz = velocity, w = unused |
| targetTex | 128×128 | RGBA Float32 | xyz = morph target position |
| motionPlanA | 33×4 | RGBA Float32 | per-part primitive params |
| motionPlanB | 33×4 | RGBA Float32 | crossfade destination |
| partAttrTex | 128×128 | RGBA Float32 | r=partId, g=attachWeight |
