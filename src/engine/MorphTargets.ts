import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// MORPH TARGET NAMES
// ─────────────────────────────────────────────────────────────────────────────
// All valid morph target keys, exported so other modules (KeywordClassifier,
// SemanticBackend) can reference them without hardcoding strings.
// ─────────────────────────────────────────────────────────────────────────────
export const MORPH_TARGET_NAMES = [
    'ring',
    'sphere',
    'quadruped',
    'humanoid',
    'scatter',
    'dual-attract',
    'wave',
    'starburst',
    'tree',
    'mountain',
    'building',
    'bird',
] as const;

export type MorphTargetName = (typeof MORPH_TARGET_NAMES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// MorphTargets — Procedural shape library for the particle system.
//
// Each shape is a DataTexture where every pixel stores an (x, y, z, 0)
// position. The velocity shader reads tMorphTarget and applies spring forces
// to pull particles toward those positions. Swapping the texture is all that's
// needed for a shape transition — the spring physics handles the animation.
//
// WHY PRE-BAKE? Generating 16,384 positions involves trig, random, and
// branching. Doing this once at startup and caching the textures in a Map
// avoids any per-frame cost when switching shapes.
// ─────────────────────────────────────────────────────────────────────────────
export class MorphTargets {
    /** Texture dimension (e.g. 128 → 128×128 = 16,384 particles) */
    size: number;

    /** Pre-baked cache of all morph target textures, keyed by shape name. */
    private cache: Map<MorphTargetName, THREE.DataTexture> = new Map();

    constructor(size: number) {
        this.size = size;
        // Pre-generate all 12 shapes at construction time.
        this.generateAll();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Get a pre-cached morph target texture by name.
     * Returns the ring (default) if the name isn't found.
     */
    getTarget(name: string): THREE.DataTexture {
        const tex = this.cache.get(name as MorphTargetName);
        if (!tex) {
            console.warn(`[MorphTargets] Unknown target "${name}", falling back to "ring"`);
            return this.cache.get('ring')!;
        }
        return tex;
    }

    /**
     * Check if a local procedural shape exists for the given name.
     * Used to decide whether to query the server for a shape.
     */
    hasTarget(name: string): boolean {
        return this.cache.has(name as MorphTargetName);
    }

    /**
     * Create a blended texture by linearly interpolating between two shapes.
     *
     * This is used for the abstraction spectrum: as abstractionLevel changes,
     * you can smoothly blend between a concrete shape (e.g. quadruped) and
     * a fluid shape (e.g. scatter). The shader's spring forces then pull
     * particles toward the blended positions.
     *
     * @param nameA - First shape name (blend=0 → 100% this shape)
     * @param nameB - Second shape name (blend=1 → 100% this shape)
     * @param blend - Interpolation factor [0, 1]
     * @returns A new DataTexture with lerped positions
     */
    blendTargets(nameA: string, nameB: string, blend: number): THREE.DataTexture {
        const texA = this.getTarget(nameA);
        const texB = this.getTarget(nameB);
        const count = this.size * this.size;
        const result = new Float32Array(count * 4);

        // TypeScript: the DataTexture's image.data is a typed array
        const dataA = texA.image.data as Float32Array;
        const dataB = texB.image.data as Float32Array;
        const clampedBlend = Math.max(0, Math.min(1, blend));

        // Lerp every position: result = A * (1 - blend) + B * blend
        for (let i = 0; i < count * 4; i++) {
            result[i] = dataA[i] * (1 - clampedBlend) + dataB[i] * clampedBlend;
        }

        const texture = new THREE.DataTexture(
            result, this.size, this.size,
            THREE.RGBAFormat, THREE.FloatType
        );
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * Get all available target names (useful for UI dropdowns or cycling).
     */
    getAvailableTargets(): readonly string[] {
        return MORPH_TARGET_NAMES;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // INTERNAL — GENERATION
    // ═════════════════════════════════════════════════════════════════════════

    /** Generate all shapes and store them in the cache. */
    private generateAll() {
        const count = this.size * this.size;
        console.log(`[MorphTargets] Generating ${MORPH_TARGET_NAMES.length} shapes for ${count} particles...`);

        // Each generator fills a Float32Array with (x, y, z, 0) per particle.
        // The helper makeTexture() wraps the array in a DataTexture.
        this.cache.set('ring', this.makeTexture((d, n) => this.generateRing(d, n)));
        this.cache.set('sphere', this.makeTexture((d, n) => this.generateSphere(d, n)));
        this.cache.set('quadruped', this.makeTexture((d, n) => this.generateQuadruped(d, n)));
        this.cache.set('humanoid', this.makeTexture((d, n) => this.generateHumanoid(d, n)));
        this.cache.set('scatter', this.makeTexture((d, n) => this.generateScatter(d, n)));
        this.cache.set('dual-attract', this.makeTexture((d, n) => this.generateDualAttract(d, n)));
        this.cache.set('wave', this.makeTexture((d, n) => this.generateWave(d, n)));
        this.cache.set('starburst', this.makeTexture((d, n) => this.generateStarburst(d, n)));
        this.cache.set('tree', this.makeTexture((d, n) => this.generateTree(d, n)));
        this.cache.set('mountain', this.makeTexture((d, n) => this.generateMountain(d, n)));
        this.cache.set('building', this.makeTexture((d, n) => this.generateBuilding(d, n)));
        this.cache.set('bird', this.makeTexture((d, n) => this.generateBird(d, n)));

        console.log(`[MorphTargets] All ${this.cache.size} shapes generated ✓`);
    }

    /** Helper: allocate Float32Array, call the generator, wrap as DataTexture. */
    private makeTexture(generator: (data: Float32Array, count: number) => void): THREE.DataTexture {
        const count = this.size * this.size;
        const data = new Float32Array(count * 4);
        generator(data, count);
        const texture = new THREE.DataTexture(
            data, this.size, this.size,
            THREE.RGBAFormat, THREE.FloatType
        );
        texture.needsUpdate = true;
        return texture;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SHAPE GENERATORS
    // ═════════════════════════════════════════════════════════════════════════
    // Each method fills a Float32Array where every 4 floats = one particle:
    //   [x, y, z, 0]
    //
    // All shapes are centered at the origin and fit within ~3 unit radius.
    // The 4th component (w) is always 0 — it's padding required by RGBA textures.
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * RING — circle in the XY plane with organic scatter.
     * The default idle shape. Jitter prevents the "solid circle" look.
     */
    private generateRing(data: Float32Array, count: number) {
        for (let i = 0; i < count; i++) {
            // Angular jitter breaks the uniform spacing
            const theta = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;
            // Radial scatter ±0.6 around radius 3.0
            const r = 3.0 + (Math.random() - 0.5) * 1.2;
            const x = r * Math.cos(theta);
            const y = r * Math.sin(theta);
            // Small depth scatter for subtle 3D
            const z = (Math.random() - 0.5) * 0.5;

            const stride = i * 4;
            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * SPHERE — fibonacci spiral distribution on a sphere surface.
     * The golden-ratio spiral gives near-uniform coverage without
     * the polar clustering that simple (θ, φ) sampling produces.
     */
    private generateSphere(data: Float32Array, count: number) {
        const goldenRatio = (1 + Math.sqrt(5)) / 2;
        for (let i = 0; i < count; i++) {
            const theta = 2 * Math.PI * i / goldenRatio;
            const phi = Math.acos(1 - 2 * (i + 0.5) / count);
            const r = 3.0;

            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);

            const stride = i * 4;
            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * QUADRUPED — horse-like four-legged animal silhouette.
     *
     * Body: elongated ellipsoid (53%) stretched along X.
     * Head: small sphere (10%) at the front-top, angled upward.
     * Neck: short connecting cylinder (5%) bridging body to head.
     * Legs: 4 short cylinders pointing downward (8% each = 32%).
     *
     * The silhouette is designed to read as "horse" when formed
     * from glowing particles — the head points forward and up.
     */
    private generateQuadruped(data: Float32Array, count: number) {
        const bodyCount = Math.floor(count * 0.53);
        const headCount = Math.floor(count * 0.10);
        const neckCount = Math.floor(count * 0.05);
        const legCount = Math.floor(count * 0.08);
        // Boundaries for part assignment
        const bodyEnd = bodyCount;
        const headEnd = bodyEnd + headCount;
        const neckEnd = headEnd + neckCount;

        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            let x = 0, y = 0, z = 0;

            if (i < bodyEnd) {
                // ── BODY: elongated ellipsoid ──────────────────────────
                x = (Math.random() - 0.5) * 5.0;       // -2.5 to 2.5
                y = (Math.random() - 0.5) * 1.5 + 0.5;
                z = (Math.random() - 0.5) * 1.5;
                const ex = x / 2.5, ey = (y - 0.5) / 0.75, ez = z / 0.75;
                const dist = ex * ex + ey * ey + ez * ez;
                if (dist > 1.0) {
                    const scale = 1.0 / Math.sqrt(dist);
                    x *= scale;
                    y = (y - 0.5) * scale + 0.5;
                    z *= scale;
                }
            } else if (i < headEnd) {
                // ── HEAD: sphere at front, angled upward ──────────────
                // Positioned at front of body (-X), elevated above neck
                const r = 0.5;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                x = r * Math.sin(phi) * Math.cos(theta) - 3.2;  // forward of body
                y = r * Math.sin(phi) * Math.sin(theta) + 1.8;  // elevated
                z = r * Math.cos(phi);
            } else if (i < neckEnd) {
                // ── NECK: angled cylinder connecting body to head ─────
                // Interpolate from shoulder (-2.0, 0.8) to head base (-3.0, 1.6)
                const t = Math.random();
                x = -2.0 - t * 1.0;                                // shoulder → head
                y = 0.8 + t * 0.8;                                 // angling upward
                z = (Math.random() - 0.5) * 0.35;                  // thin cylinder
                x += (Math.random() - 0.5) * 0.25;                 // radial scatter
                y += (Math.random() - 0.5) * 0.2;
            } else {
                // ── LEGS: 4 cylinders pointing down ───────────────────
                const legIndex = Math.floor((i - neckEnd) / legCount);
                const legPositions = [
                    { lx: -1.5, lz: -0.5 },  // front-left
                    { lx: -1.5, lz: 0.5 },   // front-right
                    { lx: 1.5, lz: -0.5 },   // back-left
                    { lx: 1.5, lz: 0.5 },    // back-right
                ];
                const leg = legPositions[Math.min(legIndex, 3)];
                x = leg.lx + (Math.random() - 0.5) * 0.3;
                y = -Math.random() * 1.8;
                z = leg.lz + (Math.random() - 0.5) * 0.3;
            }

            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * HUMANOID — simple human figure made of geometric primitives.
     *
     * Particle budget: head (8%), torso (32%), arms (30%), legs (30%).
     * All proportions are normalized to fit within ~3 unit radius.
     */
    private generateHumanoid(data: Float32Array, count: number) {
        const headCount = Math.floor(count * 0.08);
        const torsoCount = Math.floor(count * 0.32);
        const armCount = Math.floor(count * 0.15); // per arm
        const legCount = Math.floor(count * 0.15); // per leg

        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            let x = 0, y = 0, z = 0;

            if (i < headCount) {
                // ── HEAD: small sphere at top ─────────────────────────
                const r = 0.4;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                x = r * Math.sin(phi) * Math.cos(theta);
                y = r * Math.sin(phi) * Math.sin(theta) + 2.5;  // above torso
                z = r * Math.cos(phi);
            } else if (i < headCount + torsoCount) {
                // ── TORSO: cylinder ───────────────────────────────────
                const angle = Math.random() * Math.PI * 2;
                const r = 0.5 + Math.random() * 0.15;  // slightly varied radius
                x = r * Math.cos(angle);
                y = Math.random() * 2.0 + 0.3;  // y from 0.3 to 2.3
                z = r * Math.sin(angle);
            } else if (i < headCount + torsoCount + armCount) {
                // ── LEFT ARM: angled cylinder ─────────────────────────
                const t = Math.random();  // 0 at shoulder, 1 at hand
                x = -0.6 - t * 1.2;       // extends left
                y = 2.0 - t * 0.8;        // slopes downward
                z = (Math.random() - 0.5) * 0.25;
                // Add small radial scatter
                x += (Math.random() - 0.5) * 0.2;
                y += (Math.random() - 0.5) * 0.2;
            } else if (i < headCount + torsoCount + armCount * 2) {
                // ── RIGHT ARM: mirrored ───────────────────────────────
                const t = Math.random();
                x = 0.6 + t * 1.2;
                y = 2.0 - t * 0.8;
                z = (Math.random() - 0.5) * 0.25;
                x += (Math.random() - 0.5) * 0.2;
                y += (Math.random() - 0.5) * 0.2;
            } else if (i < headCount + torsoCount + armCount * 2 + legCount) {
                // ── LEFT LEG: downward cylinder ───────────────────────
                const t = Math.random();
                x = -0.3 + (Math.random() - 0.5) * 0.2;
                y = 0.3 - t * 2.5;  // from hip down
                z = (Math.random() - 0.5) * 0.25;
            } else {
                // ── RIGHT LEG: mirrored ───────────────────────────────
                const t = Math.random();
                x = 0.3 + (Math.random() - 0.5) * 0.2;
                y = 0.3 - t * 2.5;
                z = (Math.random() - 0.5) * 0.25;
            }

            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * SCATTER — random positions in a large cube.
     *
     * Much larger than other shapes (radius ~6) to create an explosive,
     * chaotic effect. Triggered by words like "explosion", "chaos", "destroy".
     */
    private generateScatter(data: Float32Array, count: number) {
        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            // Random positions in a [-6, 6] cube
            data[stride] = (Math.random() - 0.5) * 12;
            data[stride + 1] = (Math.random() - 0.5) * 12;
            data[stride + 2] = (Math.random() - 0.5) * 12;
            data[stride + 3] = 0;
        }
    }

    /**
     * DUAL-ATTRACT — two sphere clusters separated by a gap.
     *
     * Represents connection/attraction (love, togetherness). Two clusters
     * at x=±1.8, each a small sphere of particles. The gap between them
     * creates visual tension.
     */
    private generateDualAttract(data: Float32Array, count: number) {
        const halfCount = Math.floor(count / 2);
        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            // Fibonacci sphere for each cluster (good distribution)
            const clusterIndex = i < halfCount ? i : i - halfCount;
            const clusterCount = i < halfCount ? halfCount : count - halfCount;
            const goldenRatio = (1 + Math.sqrt(5)) / 2;
            const theta = 2 * Math.PI * clusterIndex / goldenRatio;
            const phi = Math.acos(1 - 2 * (clusterIndex + 0.5) / clusterCount);
            const r = 1.2;  // each cluster radius

            let x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);

            // Offset: cluster A at x=-1.8, cluster B at x=+1.8
            x += i < halfCount ? -1.8 : 1.8;

            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * WAVE — sinusoidal plane in XZ, with Y determined by a sine function.
     *
     * Creates a rolling ocean surface. Particles are arranged in a grid
     * in the XZ plane, with Y = sin(x·freq) · amp. Multiple wave crests
     * give a convincing water effect.
     */
    private generateWave(data: Float32Array, count: number) {
        // Grid resolution: approximate square root for XZ distribution
        const gridSize = Math.ceil(Math.sqrt(count));
        const spacing = 6.0 / gridSize;  // total width ~6 units

        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            // Grid position in XZ
            const gx = (i % gridSize);
            const gz = Math.floor(i / gridSize);

            const x = (gx - gridSize / 2) * spacing;
            const z = (gz - gridSize / 2) * spacing;

            // Multiple overlapping sine waves for organic feel
            const y = Math.sin(x * 1.5) * 0.8
                + Math.sin(z * 1.2 + 0.5) * 0.5
                + Math.sin((x + z) * 0.8) * 0.3;

            // Small random perturbation for organic feel
            data[stride] = x + (Math.random() - 0.5) * 0.1;
            data[stride + 1] = y + (Math.random() - 0.5) * 0.1;
            data[stride + 2] = z + (Math.random() - 0.5) * 0.1;
            data[stride + 3] = 0;
        }
    }

    /**
     * STARBURST — radial rays emanating from the origin.
     *
     * 14 rays spread evenly around a sphere. Particles are distributed
     * along each ray with more particles near the tips for a bright-end effect.
     * Triggered by words like "star", "sun", "light", "fire".
     */
    private generateStarburst(data: Float32Array, count: number) {
        const numRays = 14;
        const particlesPerRay = Math.floor(count / numRays);

        // Generate ray directions using fibonacci sphere
        const goldenRatio = (1 + Math.sqrt(5)) / 2;
        const rayDirs: THREE.Vector3[] = [];
        for (let r = 0; r < numRays; r++) {
            const theta = 2 * Math.PI * r / goldenRatio;
            const phi = Math.acos(1 - 2 * (r + 0.5) / numRays);
            rayDirs.push(new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            ));
        }

        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            const rayIndex = Math.floor(i / particlesPerRay) % numRays;
            const dir = rayDirs[rayIndex];

            // Distribute along the ray: bias toward the tip (quadratic distribution)
            // t^0.5 biases particles toward the far end
            const t = Math.pow(Math.random(), 0.5) * 3.5;

            // Small perpendicular scatter so rays have width
            const scatter = 0.12;
            const perpX = (Math.random() - 0.5) * scatter;
            const perpY = (Math.random() - 0.5) * scatter;
            const perpZ = (Math.random() - 0.5) * scatter;

            data[stride] = dir.x * t + perpX;
            data[stride + 1] = dir.y * t + perpY;
            data[stride + 2] = dir.z * t + perpZ;
            data[stride + 3] = 0;
        }
    }

    /**
     * TREE — trunk cylinder below, spherical canopy above.
     *
     * 20% trunk (narrow cylinder), 80% canopy (sphere on top).
     * The sphere sits tangent to the top of the trunk.
     */
    private generateTree(data: Float32Array, count: number) {
        const trunkCount = Math.floor(count * 0.2);

        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            let x = 0, y = 0, z = 0;

            if (i < trunkCount) {
                // ── TRUNK: narrow cylinder ────────────────────────────
                const angle = Math.random() * Math.PI * 2;
                const r = 0.2 + Math.random() * 0.1;  // thin trunk
                x = r * Math.cos(angle);
                y = Math.random() * 2.5 - 1.5;  // below canopy center
                z = r * Math.sin(angle);
            } else {
                // ── CANOPY: sphere on top ─────────────────────────────
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r = 1.5 + (Math.random() - 0.5) * 0.3;  // sphere radius with variation
                x = r * Math.sin(phi) * Math.cos(theta);
                y = r * Math.sin(phi) * Math.sin(theta) + 1.5;  // elevated above trunk
                z = r * Math.cos(phi);
            }

            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * MOUNTAIN — cone/pyramid shape, wider at the base.
     *
     * Particles are distributed on the surface of a cone. The cone
     * points upward with its base in the XZ plane. Height from base
     * determines the radius at that level (linear taper).
     */
    private generateMountain(data: Float32Array, count: number) {
        const height = 4.0;
        const baseRadius = 3.0;

        for (let i = 0; i < count; i++) {
            const stride = i * 4;

            // Random height on the cone surface (bias toward base for more particles there)
            // Using sqrt for uniform area distribution on cone surface
            const t = Math.sqrt(Math.random());  // 0=tip, 1=base
            const y = height * (1 - t) - 1.0;    // top at 3.0, base at -1.0

            // Radius at this height (linearly tapers to 0 at the tip)
            const radiusAtHeight = baseRadius * t;

            // Random angle around the cone
            const angle = Math.random() * Math.PI * 2;

            // Place on cone surface (with small radial perturbation)
            const r = radiusAtHeight * (0.95 + Math.random() * 0.1);
            const x = r * Math.cos(angle);
            const z = r * Math.sin(angle);

            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * BUILDING — rectangular prism (box) with particles on the surface.
     *
     * Particles are distributed on the 6 faces of a box, weighted by
     * face area so density is roughly uniform across all faces.
     */
    private generateBuilding(data: Float32Array, count: number) {
        // Box dimensions (half-extents)
        const hw = 1.0;  // half-width (X)
        const hh = 2.5;  // half-height (Y) — tall building
        const hd = 1.0;  // half-depth (Z)

        // Face areas for weighted distribution (6 faces)
        const areaFront = 2 * hw * 2 * hh;    // XY face at z=+hd
        const areaTop = 2 * hw * 2 * hd;       // XZ face at y=+hh
        const areaSide = 2 * hh * 2 * hd;      // YZ face at x=+hw
        const totalArea = 2 * (areaFront + areaTop + areaSide);  // all 6 faces

        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            let x = 0, y = 0, z = 0;

            // Pick a random face weighted by area
            const r = Math.random() * totalArea;
            if (r < areaFront) {
                // Front face (z = +hd)
                x = (Math.random() - 0.5) * 2 * hw;
                y = (Math.random() - 0.5) * 2 * hh;
                z = hd;
            } else if (r < areaFront * 2) {
                // Back face (z = -hd)
                x = (Math.random() - 0.5) * 2 * hw;
                y = (Math.random() - 0.5) * 2 * hh;
                z = -hd;
            } else if (r < areaFront * 2 + areaSide) {
                // Right face (x = +hw)
                x = hw;
                y = (Math.random() - 0.5) * 2 * hh;
                z = (Math.random() - 0.5) * 2 * hd;
            } else if (r < areaFront * 2 + areaSide * 2) {
                // Left face (x = -hw)
                x = -hw;
                y = (Math.random() - 0.5) * 2 * hh;
                z = (Math.random() - 0.5) * 2 * hd;
            } else if (r < areaFront * 2 + areaSide * 2 + areaTop) {
                // Top face (y = +hh)
                x = (Math.random() - 0.5) * 2 * hw;
                y = hh;
                z = (Math.random() - 0.5) * 2 * hd;
            } else {
                // Bottom face (y = -hh)
                x = (Math.random() - 0.5) * 2 * hw;
                y = -hh;
                z = (Math.random() - 0.5) * 2 * hd;
            }

            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }

    /**
     * BIRD — V-shape wings with a small body cluster.
     *
     * Two angled lines meeting at the center form the wings.
     * A small cluster at the junction forms the body. The V opens
     * slightly backward in Z for a soaring appearance.
     */
    private generateBird(data: Float32Array, count: number) {
        const bodyCount = Math.floor(count * 0.15);
        const wingCount = Math.floor((count - bodyCount) / 2);

        for (let i = 0; i < count; i++) {
            const stride = i * 4;
            let x = 0, y = 0, z = 0;

            if (i < bodyCount) {
                // ── BODY: small ellipsoid cluster at center ────────────
                x = (Math.random() - 0.5) * 0.5;
                y = (Math.random() - 0.5) * 0.3;
                z = (Math.random() - 0.5) * 0.8;
            } else if (i < bodyCount + wingCount) {
                // ── LEFT WING ─────────────────────────────────────────
                const t = Math.random();  // 0=body, 1=wingtip
                x = -t * 3.0;            // extends left
                y = t * 1.0 + (Math.random() - 0.5) * 0.15;  // slight upswept
                z = -t * 0.5 + (Math.random() - 0.5) * 0.1;  // swept back
            } else {
                // ── RIGHT WING (mirrored) ─────────────────────────────
                const t = Math.random();
                x = t * 3.0;             // extends right
                y = t * 1.0 + (Math.random() - 0.5) * 0.15;
                z = -t * 0.5 + (Math.random() - 0.5) * 0.1;
            }

            data[stride] = x;
            data[stride + 1] = y;
            data[stride + 2] = z;
            data[stride + 3] = 0;
        }
    }
}
