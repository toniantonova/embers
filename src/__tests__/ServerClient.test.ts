import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerClient } from '../services/ServerClient';
import type { ServerShapeResponse } from '../services/ServerClient';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a mock server JSON response (pre-decode — base64 encoded)
// ─────────────────────────────────────────────────────────────────────────────
function makeRawResponse() {
    // 4 points × 3 floats = 12 floats → 48 bytes
    const positions = new Float32Array([
        0.1, 0.2, 0.3,
        0.4, 0.5, 0.6,
        0.7, 0.8, 0.9,
        1.0, 1.1, 1.2,
    ]);
    const partIds = new Uint8Array([0, 1, 2, 0]);

    // Encode to base64
    const posBase64 = btoa(
        String.fromCharCode(...new Uint8Array(positions.buffer)),
    );
    const partBase64 = btoa(String.fromCharCode(...partIds));

    return {
        positions: posBase64,
        part_ids: partBase64,
        part_names: ['head', 'body', 'tail'],
        template_type: 'quadruped',
        bounding_box: { min: [-1, -1, -1], max: [1, 1, 1] },
        cached: false,
        generation_time_ms: 1500,
        pipeline: 'partcrafter',
    };
}

describe('ServerClient', () => {
    const BASE_URL = 'https://test-server.example.com';
    const API_KEY = 'test-key-123';

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('sends POST /generate with correct headers and body', async () => {
        const raw = makeRawResponse();
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(raw),
        });
        vi.stubGlobal('fetch', mockFetch);

        const client = new ServerClient(BASE_URL, API_KEY);
        await client.generateShape('horse', 'running');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe(`${BASE_URL}/generate`);
        expect(opts.method).toBe('POST');
        expect(opts.headers['X-API-Key']).toBe(API_KEY);
        expect(opts.headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(opts.body);
        expect(body.text).toBe('horse');
        expect(body.verb).toBe('running');
    });

    it('decodes base64 positions to Float32Array', async () => {
        const raw = makeRawResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(raw),
        }));

        const client = new ServerClient(BASE_URL);
        const result = await client.generateShape('test');

        expect(result).not.toBeNull();
        const r = result as ServerShapeResponse;
        expect(r.positions).toBeInstanceOf(Float32Array);
        expect(r.positions.length).toBe(12); // 4 points × 3
        expect(r.positions[0]).toBeCloseTo(0.1);
        expect(r.positions[3]).toBeCloseTo(0.4);
    });

    it('decodes base64 partIds to Uint8Array', async () => {
        const raw = makeRawResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(raw),
        }));

        const client = new ServerClient(BASE_URL);
        const result = await client.generateShape('test');

        expect(result).not.toBeNull();
        const r = result as ServerShapeResponse;
        expect(r.partIds).toBeInstanceOf(Uint8Array);
        expect(r.partIds.length).toBe(4);
        expect(r.partIds[0]).toBe(0);
        expect(r.partIds[1]).toBe(1);
    });

    it('returns null on server error (500)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
        }));

        const client = new ServerClient(BASE_URL);
        const result = await client.generateShape('test');
        expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

        const client = new ServerClient(BASE_URL);
        const result = await client.generateShape('test');
        expect(result).toBeNull();
    });

    it('cancels previous request when a new one is made', async () => {
        let aborted = false;
        vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
            return new Promise((_resolve, reject) => {
                opts.signal?.addEventListener('abort', () => {
                    aborted = true;
                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                });
            });
        }));

        const client = new ServerClient(BASE_URL);
        // First request — will hang until aborted
        const p1 = client.generateShape('horse');
        // Second request — should abort the first
        client.generateShape('bird');

        // Wait for the first request to return null (aborted)
        const result = await p1;
        expect(result).toBeNull();
        expect(aborted).toBe(true);
    });

    it('warmUp calls GET /health', () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        const client = new ServerClient(BASE_URL, API_KEY);
        client.warmUp();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe(`${BASE_URL}/health`);
        expect(opts.headers['X-API-Key']).toBe(API_KEY);
    });

    it('isConnected starts false', () => {
        const client = new ServerClient(BASE_URL, API_KEY);
        expect(client.isConnected).toBe(false);
    });

    it('isConnected becomes true after successful warmUp', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        const client = new ServerClient(BASE_URL, API_KEY);
        client.warmUp();

        // Wait for the fire-and-forget promise to resolve
        await vi.waitFor(() => {
            expect(client.isConnected).toBe(true);
        });
    });

    it('isConnected becomes true after successful generateShape', async () => {
        const raw = makeRawResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(raw),
        }));

        const client = new ServerClient(BASE_URL, API_KEY);
        expect(client.isConnected).toBe(false);

        await client.generateShape('horse');
        expect(client.isConnected).toBe(true);
    });

    it('preserves metadata fields from response', async () => {
        const raw = makeRawResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(raw),
        }));

        const client = new ServerClient(BASE_URL);
        const result = await client.generateShape('test');

        expect(result).not.toBeNull();
        const r = result as ServerShapeResponse;
        expect(r.partNames).toEqual(['head', 'body', 'tail']);
        expect(r.templateType).toBe('quadruped');
        expect(r.cached).toBe(false);
        expect(r.generationTimeMs).toBe(1500);
        expect(r.pipeline).toBe('partcrafter');
        expect(r.boundingBox.min).toEqual([-1, -1, -1]);
    });
});
