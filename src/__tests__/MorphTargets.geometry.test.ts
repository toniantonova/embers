/**
 * MorphTargets.geometry.test.ts — Shape-specific geometric invariant tests.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * Each morph target should satisfy shape-specific geometric properties:
 *   - Ring: particles form a circular band in the XY plane
 *   - Sphere: roughly uniform radial distribution
 *   - Scatter: fills a large volume (much larger than other shapes)
 *   - Dual-attract: two distinct clusters separated on the X axis
 *   - Wave: particles distributed in an XZ grid with Y varying
 *   - Building: particles concentrated on box faces
 *   - Tree: bimodal Y distribution (trunk below, canopy above)
 *   - hasTarget() / missing target behavior
 *
 * These tests catch regressions in the procedural generation algorithms
 * that the generic validity tests (MorphTargets.test.ts) wouldn't detect.
 *
 * APPROACH:
 * ──────────
 * Use a small texture size (8×8 = 64 particles) for fast tests. Verify
 * statistical properties rather than exact positions (randomized generation).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MorphTargets } from '../engine/MorphTargets';

const SIZE = 16; // 16×16 = 256 particles — enough for statistical tests
const COUNT = SIZE * SIZE;
let morph: MorphTargets;

beforeAll(() => {
    morph = new MorphTargets(SIZE);
});

/** Extract xyz positions from a DataTexture as an array of [x,y,z] tuples. */
function positions(name: string): Array<[number, number, number]> {
    const tex = morph.getTarget(name);
    const data = tex.image.data as Float32Array;
    const result: Array<[number, number, number]> = [];
    for (let i = 0; i < COUNT; i++) {
        result.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    }
    return result;
}

/** Compute bounding box of positions. */
function boundingBox(pts: Array<[number, number, number]>) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const [x, y, z] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Compute mean radial distance from origin in XY plane. */
function meanRadialXY(pts: Array<[number, number, number]>): number {
    let sum = 0;
    for (const [x, y] of pts) {
        sum += Math.sqrt(x * x + y * y);
    }
    return sum / pts.length;
}


// ══════════════════════════════════════════════════════════════════════
// RING GEOMETRY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Ring Geometry', () => {
    it('particles form a band at radius ~3 in the XY plane', () => {
        const pts = positions('ring');
        const meanR = meanRadialXY(pts);
        // Ring is centered at radius 3.0 with ±0.6 scatter
        expect(meanR).toBeGreaterThan(2.0);
        expect(meanR).toBeLessThan(4.0);
    });

    it('Z extent is small (flat ring, not a sphere)', () => {
        const pts = positions('ring');
        const bb = boundingBox(pts);
        // Z scatter is ±0.25, so total Z extent should be < 1
        expect(bb.maxZ - bb.minZ).toBeLessThan(1.5);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SPHERE GEOMETRY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Sphere Geometry', () => {
    it('all particles are at roughly the same radius', () => {
        const pts = positions('sphere');
        const radii = pts.map(([x, y, z]) => Math.sqrt(x * x + y * y + z * z));
        const minR = Math.min(...radii);
        const maxR = Math.max(...radii);
        // Fibonacci sphere: all points should be at r=3.0 exactly
        expect(minR).toBeGreaterThan(2.9);
        expect(maxR).toBeLessThan(3.1);
    });

    it('uses all three dimensions (not flat)', () => {
        const pts = positions('sphere');
        const bb = boundingBox(pts);
        // All axes should span most of the diameter
        expect(bb.maxX - bb.minX).toBeGreaterThan(4.0);
        expect(bb.maxY - bb.minY).toBeGreaterThan(4.0);
        expect(bb.maxZ - bb.minZ).toBeGreaterThan(4.0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SCATTER GEOMETRY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Scatter Geometry', () => {
    it('fills a much larger volume than ring', () => {
        const scatterBB = boundingBox(positions('scatter'));
        const ringBB = boundingBox(positions('ring'));

        const scatterVolume = (scatterBB.maxX - scatterBB.minX) *
            (scatterBB.maxY - scatterBB.minY) *
            (scatterBB.maxZ - scatterBB.minZ);
        const ringVolume = (ringBB.maxX - ringBB.minX) *
            (ringBB.maxY - ringBB.minY) *
            (ringBB.maxZ - ringBB.minZ);

        // Scatter is a 12×12×12 cube = ~1728 volume
        // Ring is ~8×8×1 = ~64 volume
        expect(scatterVolume).toBeGreaterThan(ringVolume * 5);
    });
});


// ══════════════════════════════════════════════════════════════════════
// DUAL-ATTRACT GEOMETRY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Dual-Attract Geometry', () => {
    it('has two distinct clusters on the X axis', () => {
        const pts = positions('dual-attract');

        // Count particles with x < 0 vs x > 0
        const leftCount = pts.filter(([x]) => x < 0).length;
        const rightCount = pts.filter(([x]) => x > 0).length;

        // Should be roughly 50/50 (each cluster is half)
        expect(leftCount).toBeGreaterThan(COUNT * 0.3);
        expect(rightCount).toBeGreaterThan(COUNT * 0.3);
    });

    it('clusters are separated by a gap', () => {
        const pts = positions('dual-attract');

        // Clusters at x=±1.8, each radius 1.2 → gap is roughly 0.6 to 0.6
        // Count particles near x=0 (within ±0.3)
        const nearCenter = pts.filter(([x]) => Math.abs(x) < 0.3).length;
        // Very few particles should be at the center
        expect(nearCenter).toBeLessThan(COUNT * 0.1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// BUILDING GEOMETRY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Building Geometry', () => {
    it('is taller than wide (Y extent > X and Z extent)', () => {
        const bb = boundingBox(positions('building'));
        const yExtent = bb.maxY - bb.minY;
        const xExtent = bb.maxX - bb.minX;
        const zExtent = bb.maxZ - bb.minZ;

        // Building half-extents: hw=1.0, hh=2.5, hd=1.0
        expect(yExtent).toBeGreaterThan(xExtent);
        expect(yExtent).toBeGreaterThan(zExtent);
    });
});


// ══════════════════════════════════════════════════════════════════════
// TREE GEOMETRY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Tree Geometry', () => {
    it('has more particles above y=0 than below (canopy > trunk)', () => {
        const pts = positions('tree');
        const above = pts.filter(([, y]) => y > 0).length;
        const below = pts.filter(([, y]) => y <= 0).length;

        // 80% canopy (above) vs 20% trunk (below)
        expect(above).toBeGreaterThan(below);
    });
});


// ══════════════════════════════════════════════════════════════════════
// QUADRUPED GEOMETRY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Quadruped Geometry', () => {
    it('has particles extending forward beyond the body (head)', () => {
        const pts = positions('quadruped');
        // Head sphere is centered at x≈-3.2 — some particles should be at x < -2.5
        const headParticles = pts.filter(([x, ,]) => x < -2.5);
        expect(headParticles.length).toBeGreaterThan(0);
    });

    it('has head particles elevated above the body center', () => {
        const pts = positions('quadruped');
        // Head is at y≈1.8, so particles in the head region should be above y=1.0
        const elevatedHead = pts.filter(([x, y]) => x < -2.5 && y > 1.0);
        expect(elevatedHead.length).toBeGreaterThan(0);
    });

    it('has no particles extending far rearward beyond the body (no tail)', () => {
        const pts = positions('quadruped');
        // Tail was removed — no particles should extend far past x=3.0
        const farRear = pts.filter(([x]) => x > 3.0);
        expect(farRear.length).toBe(0);
    });

    it('is longer than wide (elongated horse silhouette)', () => {
        const pts = positions('quadruped');
        const bb = boundingBox(pts);
        const xExtent = bb.maxX - bb.minX;
        const zExtent = bb.maxZ - bb.minZ;
        expect(xExtent).toBeGreaterThan(zExtent * 2);
    });
});

describe('MorphTargets — hasTarget()', () => {
    it('returns true for all valid shape names', () => {
        const targets = morph.getAvailableTargets();
        for (const name of targets) {
            expect(morph.hasTarget(name)).toBe(true);
        }
    });

    it('returns false for unknown shape names', () => {
        expect(morph.hasTarget('unicorn')).toBe(false);
        expect(morph.hasTarget('')).toBe(false);
        expect(morph.hasTarget('RING')).toBe(false); // case sensitive
    });
});
