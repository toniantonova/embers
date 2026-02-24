import { describe, it, expect } from 'vitest';
import { ServerShapeAdapter } from '../engine/ServerShapeAdapter';
import type { ServerShapeResponse } from '../services/ServerClient';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a minimal ServerShapeResponse for testing
// ─────────────────────────────────────────────────────────────────────────────
function makeResponse(pointCount: number = 8): ServerShapeResponse {
    const positions = new Float32Array(pointCount * 3);
    const partIds = new Uint8Array(pointCount);

    for (let i = 0; i < pointCount; i++) {
        positions[i * 3 + 0] = i * 0.1;       // X
        positions[i * 3 + 1] = i * 0.2;       // Y
        positions[i * 3 + 2] = i * 0.3;       // Z
        partIds[i] = i % 3;                   // 0, 1, 2, 0, 1, 2, ...
    }

    return {
        positions,
        partIds,
        partNames: ['head', 'body', 'tail'],
        templateType: 'quadruped',
        boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
        cached: false,
        generationTimeMs: 1000,
        pipeline: 'partcrafter',
    };
}

describe('ServerShapeAdapter', () => {
    describe('toDataTexture', () => {
        it('produces a texture with correct total pixel count', () => {
            const response = makeResponse(8);
            const tex = ServerShapeAdapter.toDataTexture(response, 4); // 4×4 = 16 pixels
            expect(tex.image.data!.length).toBe(16 * 4); // 16 pixels × RGBA
        });

        it('first N pixels exactly match server positions', () => {
            const response = makeResponse(4);
            const tex = ServerShapeAdapter.toDataTexture(response, 4, 1.0); // 4×4 = 16 pixels
            const data = tex.image.data! as Float32Array;

            // First 4 pixels should be exact (no jitter)
            for (let i = 0; i < 4; i++) {
                expect(data[i * 4 + 0]).toBeCloseTo(response.positions[i * 3 + 0]); // X
                expect(data[i * 4 + 1]).toBeCloseTo(response.positions[i * 3 + 1]); // Y
                expect(data[i * 4 + 2]).toBeCloseTo(response.positions[i * 3 + 2]); // Z
                expect(data[i * 4 + 3]).toBe(0); // A = 0
            }
        });

        it('expanded pixels are near their source point (within jitter radius)', () => {
            const response = makeResponse(4);
            const tex = ServerShapeAdapter.toDataTexture(response, 4, 1.0); // 16 pixels total
            const data = tex.image.data! as Float32Array;
            const JITTER = 0.005;

            // Pixels 4..15 are expanded — each maps to serverPoint[i % 4]
            for (let i = 4; i < 16; i++) {
                const srcIdx = i % 4;
                const dx = Math.abs(data[i * 4 + 0] - response.positions[srcIdx * 3 + 0]);
                const dy = Math.abs(data[i * 4 + 1] - response.positions[srcIdx * 3 + 1]);
                const dz = Math.abs(data[i * 4 + 2] - response.positions[srcIdx * 3 + 2]);

                expect(dx).toBeLessThanOrEqual(JITTER + 1e-6);
                expect(dy).toBeLessThanOrEqual(JITTER + 1e-6);
                expect(dz).toBeLessThanOrEqual(JITTER + 1e-6);
            }
        });

        it('sets texture format to RGBA Float32', () => {
            const response = makeResponse(4);
            const tex = ServerShapeAdapter.toDataTexture(response, 4);
            // THREE.RGBAFormat = 1023, THREE.FloatType = 1015
            expect(tex.format).toBeDefined();
            expect(tex.type).toBeDefined();
            expect(tex.image.data).toBeInstanceOf(Float32Array);
        });

        it('handles textureSize=128 (real particle count)', () => {
            const response = makeResponse(2048);
            const tex = ServerShapeAdapter.toDataTexture(response, 128);
            expect(tex.image.data!.length).toBe(128 * 128 * 4); // 16384 × 4 = 65536
        });
    });

    describe('toPartIdTexture', () => {
        it('produces correct pixel count', () => {
            const response = makeResponse(4);
            const tex = ServerShapeAdapter.toPartIdTexture(response, 4);
            expect(tex.image.data!.length).toBe(16 * 4);
        });

        it('first N pixels have correct normalized part IDs', () => {
            const response = makeResponse(4);
            const tex = ServerShapeAdapter.toPartIdTexture(response, 4);
            const data = tex.image.data! as Float32Array;

            for (let i = 0; i < 4; i++) {
                const expected = response.partIds[i];
                expect(data[i * 4 + 0]).toBeCloseTo(expected); // R = partId (raw integer)
                expect(data[i * 4 + 1]).toBe(0); // G = 0
                expect(data[i * 4 + 2]).toBe(0); // B = 0
            }
        });

        it('expanded pixels inherit source part ID', () => {
            const response = makeResponse(4);
            const tex = ServerShapeAdapter.toPartIdTexture(response, 4);
            const data = tex.image.data as Float32Array;

            for (let i = 4; i < 16; i++) {
                const srcIdx = i % 4;
                const expected = response.partIds[srcIdx];
                expect(data[i * 4 + 0]).toBeCloseTo(expected);
            }
        });
    });
});
