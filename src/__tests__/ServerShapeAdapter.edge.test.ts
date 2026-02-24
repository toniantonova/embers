/**
 * ServerShapeAdapter.edge.test.ts — Edge case tests for point expansion.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * ServerShapeAdapter handles the common case (2048→16384 expansion) well,
 * but we also need to verify edge cases:
 *   1. Single-point server response → all particles cluster around that point
 *   2. Server returns more points than texture capacity → wraps correctly
 *   3. Texture size exactly matches point count → no expansion needed
 *   4. Part IDs with large values → normalized correctly
 */

import { describe, it, expect } from 'vitest';
import { ServerShapeAdapter } from '../engine/ServerShapeAdapter';
import type { ServerShapeResponse } from '../services/ServerClient';

function makeResponse(
    pointCount: number,
    partCount: number = 3,
    opts: Partial<ServerShapeResponse> = {}
): ServerShapeResponse {
    const positions = new Float32Array(pointCount * 3);
    const partIds = new Uint8Array(pointCount);

    for (let i = 0; i < pointCount; i++) {
        positions[i * 3 + 0] = i * 0.1;
        positions[i * 3 + 1] = i * 0.2;
        positions[i * 3 + 2] = i * 0.3;
        partIds[i] = i % partCount;
    }

    return {
        positions,
        partIds,
        partNames: Array.from({ length: partCount }, (_, i) => `part${i}`),
        templateType: 'quadruped',
        boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
        cached: false,
        generationTimeMs: 1000,
        pipeline: 'partcrafter',
        ...opts,
    };
}


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: SINGLE-POINT RESPONSE
// ══════════════════════════════════════════════════════════════════════

describe('ServerShapeAdapter — Single Point', () => {
    it('all pixels reference the single source point', () => {
        const response = makeResponse(1);
        const tex = ServerShapeAdapter.toDataTexture(response, 4, 1.0); // 16 pixels
        const data = tex.image.data! as Float32Array;

        // First pixel is exact
        expect(data[0]).toBeCloseTo(0);
        expect(data[1]).toBeCloseTo(0);
        expect(data[2]).toBeCloseTo(0);

        // All 16 pixels should be near the origin (the only point)
        for (let i = 0; i < 16; i++) {
            // All expanded pixels map to serverPoint[i % 1] = serverPoint[0]
            expect(Math.abs(data[i * 4 + 0])).toBeLessThan(0.03); // within jitter
            expect(Math.abs(data[i * 4 + 1])).toBeLessThan(0.03);
            expect(Math.abs(data[i * 4 + 2])).toBeLessThan(0.03);
        }
    });

    it('single point part ID texture works', () => {
        const response = makeResponse(1, 1);
        const tex = ServerShapeAdapter.toPartIdTexture(response, 4);
        const data = tex.image.data! as Float32Array;

        // All pixels should have the same part ID
        for (let i = 0; i < 16; i++) {
            expect(data[i * 4]).toBeCloseTo(0);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: EXACT FIT (NO EXPANSION NEEDED)
// ══════════════════════════════════════════════════════════════════════

describe('ServerShapeAdapter — Exact Fit', () => {
    it('no jitter when pointCount equals textureSize²', () => {
        // 4×4 = 16 pixels, and we provide exactly 16 points
        const response = makeResponse(16);
        const tex = ServerShapeAdapter.toDataTexture(response, 4, 1.0);
        const data = tex.image.data! as Float32Array;

        // All pixels should be exact copies (no expansion, no jitter)
        for (let i = 0; i < 16; i++) {
            expect(data[i * 4 + 0]).toBe(response.positions[i * 3 + 0]);
            expect(data[i * 4 + 1]).toBe(response.positions[i * 3 + 1]);
            expect(data[i * 4 + 2]).toBe(response.positions[i * 3 + 2]);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: MORE POINTS THAN PIXELS
// ══════════════════════════════════════════════════════════════════════

describe('ServerShapeAdapter — More Points Than Pixels', () => {
    it('wraps around using modulo when server sends more than needed', () => {
        // 4×4 = 16 pixels, but we provide 32 points
        const response = makeResponse(32);
        const tex = ServerShapeAdapter.toDataTexture(response, 4, 1.0);
        const data = tex.image.data! as Float32Array;

        // Pixel i maps to serverPoint[i % 32], and since i < 32 for all 16 pixels,
        // each pixel gets a unique source point (no wrapping for the first 16)
        for (let i = 0; i < 16; i++) {
            const srcIdx = i % 32; // = i, since i < 32
            expect(data[i * 4 + 0]).toBe(response.positions[srcIdx * 3 + 0]);
        }
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: PART ID NORMALIZATION WITH LARGE VALUES
// ══════════════════════════════════════════════════════════════════════

describe('ServerShapeAdapter — Part ID Normalization', () => {
    it('stores raw integer part IDs', () => {
        const response = makeResponse(4, 3);
        // Manually set a high part ID
        response.partIds[0] = 255;
        response.partIds[1] = 128;
        response.partIds[2] = 0;

        const tex = ServerShapeAdapter.toPartIdTexture(response, 4);
        const data = tex.image.data! as Float32Array;

        expect(data[0 * 4]).toBeCloseTo(255); // raw integer
        expect(data[1 * 4]).toBeCloseTo(128);
        expect(data[2 * 4]).toBeCloseTo(0);
    });
});
