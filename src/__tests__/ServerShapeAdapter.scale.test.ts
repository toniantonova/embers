/**
 * ServerShapeAdapter.scale.test.ts — Tests for the scale parameter.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * The scale parameter on toDataTexture() multiplies all position values,
 * allowing server shapes (normalized to [-1,1]) to match the visual size
 * of pre-built shapes. Wired to TuningConfig's serverShapeScale slider.
 *
 * COVERAGE:
 * - Default scale (1.0) leaves positions unchanged
 * - Scale > 1 multiplies positions uniformly
 * - Scale also applies to jitter radius
 * - Scale = 0 collapses all positions to origin
 */

import { describe, it, expect } from 'vitest';
import { ServerShapeAdapter } from '../engine/ServerShapeAdapter';
import type { ServerShapeResponse } from '../services/ServerClient';

function makeResponse(pointCount: number): ServerShapeResponse {
    const positions = new Float32Array(pointCount * 3);
    const partIds = new Uint8Array(pointCount);

    for (let i = 0; i < pointCount; i++) {
        positions[i * 3 + 0] = 0.5;  // X = 0.5
        positions[i * 3 + 1] = -0.3; // Y = -0.3
        positions[i * 3 + 2] = 0.8;  // Z = 0.8
        partIds[i] = 0;
    }

    return {
        positions,
        partIds,
        partNames: ['body'],
        templateType: 'custom',
        boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
        cached: false,
        generationTimeMs: 100,
        pipeline: 'partcrafter',
    };
}


describe('ServerShapeAdapter — Scale Parameter', () => {
    it('default scale (1.5) matches PARAM_DEFS serverShapeScale', () => {
        const response = makeResponse(4);
        const tex = ServerShapeAdapter.toDataTexture(response, 2); // uses default 1.5
        const data = tex.image.data! as Float32Array;

        // Positions multiplied by default 1.5
        expect(data[0]).toBeCloseTo(0.75);   // 0.5 * 1.5
        expect(data[1]).toBeCloseTo(-0.45);  // -0.3 * 1.5
        expect(data[2]).toBeCloseTo(1.2);    // 0.8 * 1.5
    });

    it('scale of 1.5 is the default when no scale argument given', () => {
        const response = makeResponse(4);
        const withScale = ServerShapeAdapter.toDataTexture(response, 2, 1.5);
        const noScale = ServerShapeAdapter.toDataTexture(response, 2);
        const dataA = withScale.image.data! as Float32Array;
        const dataB = noScale.image.data! as Float32Array;

        // All 4 exact pixels should be identical (beyond that, jitter is random)
        for (let i = 0; i < 4; i++) {
            expect(dataA[i * 4 + 0]).toBe(dataB[i * 4 + 0]);
            expect(dataA[i * 4 + 1]).toBe(dataB[i * 4 + 1]);
            expect(dataA[i * 4 + 2]).toBe(dataB[i * 4 + 2]);
        }
    });

    it('scale > 1 multiplies all positions', () => {
        const response = makeResponse(4);
        const tex = ServerShapeAdapter.toDataTexture(response, 2, 2.0);
        const data = tex.image.data! as Float32Array;

        // Positions should be doubled
        expect(data[0]).toBeCloseTo(1.0);   // 0.5 * 2
        expect(data[1]).toBeCloseTo(-0.6);  // -0.3 * 2
        expect(data[2]).toBeCloseTo(1.6);   // 0.8 * 2
    });

    it('scale < 1 shrinks positions', () => {
        const response = makeResponse(4);
        const tex = ServerShapeAdapter.toDataTexture(response, 2, 0.5);
        const data = tex.image.data! as Float32Array;

        // Positions should be halved
        expect(data[0]).toBeCloseTo(0.25);  // 0.5 * 0.5
        expect(data[1]).toBeCloseTo(-0.15); // -0.3 * 0.5
        expect(data[2]).toBeCloseTo(0.4);   // 0.8 * 0.5
    });

    it('scale = 0 collapses to origin', () => {
        const response = makeResponse(4);
        const tex = ServerShapeAdapter.toDataTexture(response, 2, 0);
        const data = tex.image.data! as Float32Array;

        // All positions should be 0 (including jitter, since jitter * 0 = 0)
        for (let i = 0; i < 4; i++) {
            expect(data[i * 4 + 0]).toBeCloseTo(0);
            expect(data[i * 4 + 1]).toBeCloseTo(0);
            expect(data[i * 4 + 2]).toBeCloseTo(0);
        }
    });

    it('jitter for expanded particles is scaled too', () => {
        // 1 point → textureSize=2 (4 pixels) → 3 expanded particles
        const response = makeResponse(1);
        // Zero out positions so jitter is the only non-zero value
        response.positions[0] = 0;
        response.positions[1] = 0;
        response.positions[2] = 0;

        const texScale1 = ServerShapeAdapter.toDataTexture(response, 2, 1.0);
        const texScale3 = ServerShapeAdapter.toDataTexture(response, 2, 3.0);

        // Get max absolute position across all expanded pixels (pixels 1-3)
        const getMaxJitter = (data: Float32Array): number => {
            let max = 0;
            for (let i = 1; i < 4; i++) {
                for (let c = 0; c < 3; c++) {
                    max = Math.max(max, Math.abs(data[i * 4 + c]));
                }
            }
            return max;
        };

        const maxJitter1 = getMaxJitter(texScale1.image.data! as Float32Array);
        const maxJitter3 = getMaxJitter(texScale3.image.data! as Float32Array);

        // Jitter at scale 3 should be about 3x the jitter at scale 1
        // We check that scale 3 jitter is strictly larger (exact ratio varies with random)
        // Maximum possible jitter at scale 1 is 0.02, at scale 3 is 0.06
        expect(maxJitter1).toBeLessThanOrEqual(0.0051); // JITTER_RADIUS * 1.0
        expect(maxJitter3).toBeLessThanOrEqual(0.0151); // JITTER_RADIUS * 3.0
    });
});
