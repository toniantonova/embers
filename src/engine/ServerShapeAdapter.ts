// ─────────────────────────────────────────────────────────────────────────────
// ServerShapeAdapter — Convert server shapes to GPU-ready DataTextures
// ─────────────────────────────────────────────────────────────────────────────
// The server sends 2,048 sampled points. The particle system has 16,384
// particles (128×128 texture). This adapter expands the 2,048 points into
// 16,384 by assigning each excess particle to a source point with a tiny
// random offset, creating a dense cloud around each attractor.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { ServerShapeResponse } from '../services/ServerClient';

export class ServerShapeAdapter {
    /**
     * Convert server response (2048 points) into a DataTexture
     * compatible with the existing particle system (16,384 particles).
     *
     * Strategy:
     * - First 2,048 pixels: exact server positions
     * - Remaining 14,336 pixels: each maps to serverPoint[i % 2048]
     *   with a small random offset (±0.02 units) to avoid clumping
     *
     * @param response - Decoded server response
     * @param textureSize - Texture dimension (e.g. 128 for 128×128 = 16,384)
     * @param scale - Position multiplier (default 1.5, matching TuningConfig's
     *   `serverShapeScale` default). Server normalizes to [-1,1] which appears
     *   smaller than pre-built shapes. Wired to TuningConfig slider.
     */
    static toDataTexture(
        response: ServerShapeResponse,
        textureSize: number,
        scale: number = 1.5,
    ): THREE.DataTexture {
        const totalPixels = textureSize * textureSize;
        const data = new Float32Array(totalPixels * 4); // RGBA per pixel
        const serverCount = response.positions.length / 3;
        const positions = response.positions;
        const JITTER_RADIUS = 0.005;

        for (let i = 0; i < totalPixels; i++) {
            const srcIdx = i % serverCount;
            const px = i * 4;
            const sx = srcIdx * 3;

            // Copy source position with scale applied
            data[px + 0] = positions[sx + 0] * scale; // X
            data[px + 1] = positions[sx + 1] * scale; // Y
            data[px + 2] = positions[sx + 2] * scale; // Z
            data[px + 3] = 0; // A (unused)

            // Add jitter for expanded particles (beyond the original 2048)
            if (i >= serverCount) {
                data[px + 0] += (Math.random() - 0.5) * 2 * JITTER_RADIUS * scale;
                data[px + 1] += (Math.random() - 0.5) * 2 * JITTER_RADIUS * scale;
                data[px + 2] += (Math.random() - 0.5) * 2 * JITTER_RADIUS * scale;
            }
        }

        const texture = new THREE.DataTexture(
            data,
            textureSize,
            textureSize,
            THREE.RGBAFormat,
            THREE.FloatType,
        );
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * Create a part ID texture — a DataTexture where each pixel's
     * R channel contains the part ID for that particle.
     *
     * The particle system doesn't use this yet, but it's infrastructure
     * for per-part animation templates later.
     *
     * @param response - Decoded server response
     * @param textureSize - Texture dimension (e.g. 128)
     */
    static toPartIdTexture(
        response: ServerShapeResponse,
        textureSize: number,
    ): THREE.DataTexture {
        const totalPixels = textureSize * textureSize;
        const data = new Float32Array(totalPixels * 4);
        const serverCount = response.partIds.length;
        const partIds = response.partIds;

        for (let i = 0; i < totalPixels; i++) {
            const srcIdx = i % serverCount;
            const px = i * 4;

            // R = partId as integer-valued float (0–31)
            // The motion-plan shader reads: int partId = int(attr.r + 0.5)
            // so we store the raw integer, NOT normalized to [0, 1]
            data[px + 0] = partIds[srcIdx];
            data[px + 1] = 0;
            data[px + 2] = 0;
            data[px + 3] = 0;
        }

        const texture = new THREE.DataTexture(
            data,
            textureSize,
            textureSize,
            THREE.RGBAFormat,
            THREE.FloatType,
        );
        texture.needsUpdate = true;
        return texture;
    }
}
