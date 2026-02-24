> **Mirror repo (read-only).**  
> Primary repo: https://github.com/toni-antonova/embers  
> Live demo: https://embers.camp  
> Status: This repo is a temporary snapshot for reference and will be archived.
>
> # Dots — Speech-to-Visualization

A real-time 3D particle visualizer that reacts to audio input. Particles are driven by GPU-accelerated physics (GPGPU via `GPUComputationRenderer`) and respond to energy, tension, urgency, and breathiness extracted from the microphone.

## Demo

![Particles rendering](file:///Users/antoniaantonova/.gemini/antigravity/brain/59ba2635-0cec-4ef4-994a-bdcd1b9a401b/final_verification_dots_1771567023294.webp)

> Ring of 16,384 GPU-simulated particles with motion blur trail effect.

## Stack

| Layer | Tech |
|-------|------|
| Rendering | [Three.js](https://threejs.org) + `GPUComputationRenderer` (WebGL2) |
| Audio analysis | [Meyda](https://meyda.js.org) + Web Audio API |
| Framework | React + TypeScript + Vite |
| Physics | Curl-noise GPGPU in GLSL fragment shaders |

## Architecture

```
src/
├── components/
│   ├── Canvas.tsx         # Three.js scene, render loop, WebGL lifecycle
│   └── UIOverlay.tsx      # Audio controls + parameter sliders
├── engine/
│   ├── ParticleSystem.ts  # GPGPU particle setup, uniforms, render material
│   ├── UniformBridge.ts   # Connects AudioEngine analysis → shader uniforms
│   └── MorphTargets.ts    # Ring / sphere position texture generators
├── services/
│   └── AudioEngine.ts     # Meyda feature extraction (energy, MFCC, etc.)
└── shaders/
    ├── position.frag.glsl # GPU position integrator
    ├── velocity.frag.glsl # Curl noise + spring + repulsion forces
    ├── render.vert.glsl   # Particle vertex shader (perspective point sizing)
    └── render.frag.glsl   # Particle fragment shader (soft disc, glow)
```

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Click **Start Listening** to enable microphone input and watch particles react to your voice.

## WebGL notes

- `StrictMode` is intentionally **disabled** in `main.tsx` — React's double-mount in dev consumes 2 GPU context slots on the same canvas, which hits the browser's limit quickly.
- The `Canvas` component uses a `canvasKey` state. On any WebGL context error it bumps the key, causing React to mount a **fresh `<canvas>` DOM element** rather than reusing a context-poisoned one.
- The render loop uses `autoClear = false` with an explicit `renderer.clearDepth()` between the motion-blur fade pass and the particle pass — without this, the orthographic fade quad's depth values block all particles via depth test.

## Debug logs

Debug `console.log` statements are left in intentionally during development. They'll be removed before final release.
