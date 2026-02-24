/**
 * MorphTargets.test.ts — Unit tests for procedural shape generation
 * and texture blending.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * MorphTargets generates Float32Arrays of particle positions for 12 shapes
 * and wraps them as THREE.DataTexture. We verify:
 *   1. Every shape generates valid data (no NaN/Infinity)
 *   2. getTarget() returns textures and handles fallback
 *   3. blendTargets() correctly interpolates positions
 *   4. Shapes fit within expected bounds
 *
 * MOCK STRATEGY:
 * ──────────────
 * THREE.DataTexture in jsdom has no WebGL context, but MorphTargets only
 * uses it as a data container (never renders in tests). THREE.js's
 * DataTexture constructor works fine in Node — it stores the Float32Array
 * in .image.data without needing a GPU.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MorphTargets, MORPH_TARGET_NAMES } from '../engine/MorphTargets';

// ── SHARED FIXTURE ───────────────────────────────────────────────────
// Use a small texture size (8×8 = 64 particles) to keep tests fast.
// Shape generation algorithms are size-independent — they just divide
// the particle count into proportional buckets.
const SIZE = 8;
const PARTICLE_COUNT = SIZE * SIZE; // 64
let morph: MorphTargets;

// Construct once — generation is expensive relative to assertions.
beforeAll(() => {
    morph = new MorphTargets(SIZE);
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: SHAPE GENERATION — VALIDITY
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — Shape Validity', () => {
    it.each(MORPH_TARGET_NAMES.map(n => [n]))(
        'shape "%s" produces a DataTexture with correct dimensions',
        (name) => {
            const tex = morph.getTarget(name);
            expect(tex).toBeDefined();
            // DataTexture.image.data is the raw Float32Array
            const data = tex.image.data as Float32Array;
            expect(data).toBeInstanceOf(Float32Array);
            expect(data.length).toBe(PARTICLE_COUNT * 4); // x,y,z,w per particle
        }
    );

    it.each(MORPH_TARGET_NAMES.map(n => [n]))(
        'shape "%s" has no NaN or Infinity values',
        (name) => {
            const tex = morph.getTarget(name);
            const data = tex.image.data as Float32Array;
            for (let i = 0; i < data.length; i++) {
                expect(Number.isFinite(data[i])).toBe(true);
            }
        }
    );

    it.each(MORPH_TARGET_NAMES.map(n => [n]))(
        'shape "%s" has all particles within radius 10',
        (name) => {
            const tex = morph.getTarget(name);
            const data = tex.image.data as Float32Array;
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const x = data[i * 4];
                const y = data[i * 4 + 1];
                const z = data[i * 4 + 2];
                const r = Math.sqrt(x * x + y * y + z * z);
                // scatter is the largest (~radius 6), allow generous margin
                expect(r).toBeLessThan(10);
            }
        }
    );
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: getTarget()
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — getTarget()', () => {
    it('returns a texture for every valid name', () => {
        for (const name of MORPH_TARGET_NAMES) {
            expect(morph.getTarget(name)).toBeDefined();
        }
    });

    it('falls back to "ring" for unknown name', () => {
        const ring = morph.getTarget('ring');
        const fallback = morph.getTarget('nonexistent');
        expect(fallback).toBe(ring);
    });

    it('falls back to "ring" for empty string', () => {
        const ring = morph.getTarget('ring');
        const fallback = morph.getTarget('');
        expect(fallback).toBe(ring);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: getAvailableTargets()
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — getAvailableTargets()', () => {
    it('returns exactly 12 target names', () => {
        expect(morph.getAvailableTargets()).toHaveLength(12);
    });

    it('includes all expected shape names', () => {
        const targets = morph.getAvailableTargets();
        const expected = [
            'ring', 'sphere', 'quadruped', 'humanoid', 'scatter',
            'dual-attract', 'wave', 'starburst', 'tree', 'mountain',
            'building', 'bird'
        ];
        for (const name of expected) {
            expect(targets).toContain(name);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: blendTargets()
// ══════════════════════════════════════════════════════════════════════

describe('MorphTargets — blendTargets()', () => {
    it('blend=0 produces positions identical to target A', () => {
        const blended = morph.blendTargets('ring', 'sphere', 0);
        const original = morph.getTarget('ring');

        const blendData = blended.image.data as Float32Array;
        const origData = original.image.data as Float32Array;

        for (let i = 0; i < blendData.length; i++) {
            expect(blendData[i]).toBeCloseTo(origData[i], 5);
        }
    });

    it('blend=1 produces positions identical to target B', () => {
        const blended = morph.blendTargets('ring', 'sphere', 1);
        const original = morph.getTarget('sphere');

        const blendData = blended.image.data as Float32Array;
        const origData = original.image.data as Float32Array;

        for (let i = 0; i < blendData.length; i++) {
            expect(blendData[i]).toBeCloseTo(origData[i], 5);
        }
    });

    it('blend=0.5 produces midpoint positions', () => {
        const blended = morph.blendTargets('ring', 'sphere', 0.5);
        const ringData = (morph.getTarget('ring').image.data) as Float32Array;
        const sphereData = (morph.getTarget('sphere').image.data) as Float32Array;
        const blendData = blended.image.data as Float32Array;

        for (let i = 0; i < blendData.length; i++) {
            const expected = ringData[i] * 0.5 + sphereData[i] * 0.5;
            expect(blendData[i]).toBeCloseTo(expected, 5);
        }
    });

    it('blend value is clamped to [0, 1]', () => {
        // Blend > 1 should act as 1
        const blendHigh = morph.blendTargets('ring', 'sphere', 5.0);
        const sphere = morph.getTarget('sphere');
        const highData = blendHigh.image.data as Float32Array;
        const sphereData = sphere.image.data as Float32Array;

        for (let i = 0; i < highData.length; i++) {
            expect(highData[i]).toBeCloseTo(sphereData[i], 5);
        }
    });

    it('blended texture has no NaN values', () => {
        const blended = morph.blendTargets('starburst', 'scatter', 0.3);
        const data = blended.image.data as Float32Array;
        for (let i = 0; i < data.length; i++) {
            expect(Number.isFinite(data[i])).toBe(true);
        }
    });
});
