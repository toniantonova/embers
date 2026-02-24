// ─────────────────────────────────────────────────────────────────────────────
// ServerClient — HTTP client for the Lumen Pipeline API
// ─────────────────────────────────────────────────────────────────────────────
// Handles fetching server-generated shapes from the deployed Cloud Run
// service. Supports request cancellation (latest-wins), timeout, and
// graceful error handling (never throws — returns null on failure).
// ─────────────────────────────────────────────────────────────────────────────

/** Decoded shape response from the server. */
export interface ServerShapeResponse {
    /** XYZ positions decoded from base64 Float32Array — 2048 × 3 floats */
    positions: Float32Array;
    /** Part IDs decoded from base64 Uint8Array — 2048 bytes */
    partIds: Uint8Array;
    /** Human-readable part names (e.g. ["head", "body", "tail"]) */
    partNames: string[];
    /** Template type (e.g. "quadruped", "humanoid") */
    templateType: string;
    /** Axis-aligned bounding box */
    boundingBox: { min: number[]; max: number[] };
    /** Whether this result was served from cache */
    cached: boolean;
    /** Server-side generation time in milliseconds */
    generationTimeMs: number;
    /** Pipeline that generated this shape (e.g. "partcrafter") */
    pipeline: string;
}

/** Raw JSON response from the server (before base64 decoding).
 *  Field names match the Python backend's snake_case convention.
 */
interface RawServerResponse {
    positions: string;
    part_ids: string;
    part_names: string[];
    template_type: string;
    bounding_box: { min: number[]; max: number[] };
    cached: boolean;
    generation_time_ms: number;
    pipeline: string;
}

const REQUEST_TIMEOUT_MS = 300_000;

export class ServerClient {
    private baseUrl: string;
    private apiKey: string;
    private pendingRequest: AbortController | null = null;

    /** Whether the last warmUp/generateShape call succeeded. */
    private _connected: boolean = false;

    constructor(baseUrl: string, apiKey: string = '') {
        // Strip trailing slash
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;

        // Log what URL this bundle was built with (helps diagnose localhost vs Cloud Run)
        const maskedUrl = this.baseUrl.replace(/\/\/(.+?)@/, '//*****@');
        console.log(
            `[ServerClient] Initialized → ${maskedUrl}` +
            (this.apiKey ? ' (API key set)' : ' (⚠️ no API key — requests will be rejected by auth middleware)')
        );
    }

    /** Whether the server has been reached at least once. */
    get isConnected(): boolean {
        return this._connected;
    }

    /**
     * Request a shape from the server. Cancels any pending request.
     * Returns null if the request was cancelled, timed out, or failed.
     */
    async generateShape(
        text: string,
        // TODO: Wire up for Tier 2 — server supports verb-based prompt
        // augmentation but no caller passes it yet. Remove or integrate
        // when Tier 2 action-word routing is implemented.
        verb?: string,
        quality: 'fast' | 'standard' = 'standard',
    ): Promise<ServerShapeResponse | null> {
        // Cancel any in-flight request (latest-wins)
        if (this.pendingRequest) {
            this.pendingRequest.abort();
            this.pendingRequest = null;
        }

        const controller = new AbortController();
        this.pendingRequest = controller;

        // Timeout: abort after REQUEST_TIMEOUT_MS
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const body: Record<string, string> = { text };
            if (verb) body.verb = verb;
            if (quality) body.quality = quality;

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (this.apiKey) {
                headers['X-API-Key'] = this.apiKey;
            }

            const response = await fetch(`${this.baseUrl}/generate`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!response.ok) {
                console.warn(
                    `[ServerClient] Server error ${response.status} for "${text}"`,
                );
                return null;
            }

            const raw: RawServerResponse = await response.json();
            this._connected = true;
            return this.decodeResponse(raw);
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                // Request was cancelled (either by timeout or by a newer request)
                console.log(`[ServerClient] Request for "${text}" was cancelled`);
            } else {
                console.warn(`[ServerClient] Request failed for "${text}":`, err);
            }
            return null;
        } finally {
            clearTimeout(timeoutId);
            if (this.pendingRequest === controller) {
                this.pendingRequest = null;
            }
        }
    }

    /**
     * Preflight ping to wake the server (Cloud Run cold start).
     * Fire-and-forget — doesn't block anything.
     */
    warmUp(): void {
        const headers: Record<string, string> = {};
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }

        fetch(`${this.baseUrl}/health`, { headers }).then((res) => {
            if (res.ok) {
                this._connected = true;
                console.log('[ServerClient] ✅ Backend warm-up succeeded');
            } else {
                console.warn(`[ServerClient] ⚠️ Backend warm-up returned ${res.status}`);
            }
        }).catch(() => {
            console.warn('[ServerClient] ⚠️ Backend warm-up failed (network error)');
        });
    }

    /** Decode the raw JSON response into typed arrays.
     *  Returns null if base64 decoding fails (malformed server response).
     */
    private decodeResponse(raw: RawServerResponse): ServerShapeResponse | null {
        try {
            return {
                positions: this.decodeFloat32(raw.positions),
                partIds: this.decodeUint8(raw.part_ids),
                partNames: raw.part_names,
                templateType: raw.template_type,
                boundingBox: raw.bounding_box,
                cached: raw.cached,
                generationTimeMs: raw.generation_time_ms,
                pipeline: raw.pipeline,
            };
        } catch (err) {
            console.warn('[ServerClient] Failed to decode server response:', err);
            return null;
        }
    }

    /** Decode a base64 string to Float32Array. */
    private decodeFloat32(base64: string): Float32Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Float32Array(bytes.buffer);
    }

    /** Decode a base64 string to Uint8Array. */
    private decodeUint8(base64: string): Uint8Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
}
