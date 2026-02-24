/**
 * WebSocketSTTClient — Real-time speech-to-text via Deepgram's streaming WebSocket API.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Provides a WebSocket-based speech recognition fallback for browsers where
 * the Web Speech API is unavailable (Firefox, Brave, PWAs) or broken (iOS Safari
 * in certain modes). Connects directly to Deepgram's Nova-2 streaming endpoint.
 *
 * ARCHITECTURE:
 * ─────────────
 * 1. getUserMedia() → AudioContext → AudioWorkletNode (stt-capture-worklet)
 * 2. Worklet resamples to 16kHz Int16 PCM → posts chunks to main thread
 * 3. Main thread forwards binary PCM chunks over WebSocket to Deepgram
 * 4. Deepgram returns JSON with interim/final transcripts
 * 5. Client emits TranscriptEvent (same interface as SpeechEngine)
 *
 * KEY DESIGN DECISIONS:
 * ─────────────────────
 * - KeepAlive every 5s: Deepgram kills connections after 10s of silence
 * - Explicit encoding params on URL: don't let Deepgram guess the format
 * - Drop audio on reconnect: buffering introduces latency spikes
 * - PCM via AudioWorklet (not MediaRecorder): avoids iOS mp4/AAC codec mismatch
 *
 * COST:
 * ─────
 * Deepgram Nova-2: $0.0077/min pay-as-you-go, $200 free credit to start.
 */

import type { TranscriptEvent } from './types';

// ── TYPES ────────────────────────────────────────────────────────────

export type WebSocketSTTStatus =
    | 'idle'
    | 'connecting'
    | 'listening'
    | 'reconnecting'
    | 'error'
    | 'closed';

type TranscriptCallback = (event: TranscriptEvent) => void;
type StatusCallback = (status: WebSocketSTTStatus, detail?: string) => void;

/** Shape of Deepgram's streaming transcript response. */
interface DeepgramResponse {
    type: 'Results';
    channel: {
        alternatives: Array<{
            transcript: string;
            confidence: number;
        }>;
    };
    is_final: boolean;
    speech_final: boolean;
}

// ── CONSTANTS ────────────────────────────────────────────────────────

/** Deepgram streaming endpoint with explicit encoding params. */
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen'
    + '?encoding=linear16'
    + '&sample_rate=16000'
    + '&channels=1'
    + '&interim_results=true'
    + '&model=nova-3'
    + '&smart_format=true'
    + '&punctuate=true'
    + '&endpointing=300'; // 300ms silence = utterance boundary

/** KeepAlive interval in ms. Deepgram kills after 10s silence. */
const KEEPALIVE_INTERVAL_MS = 5000;

/** Max reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Base delay for exponential backoff on reconnect (ms). */
const RECONNECT_BASE_DELAY_MS = 500;

// ── CLIENT CLASS ────────────────────────────────────────────────────

export class WebSocketSTTClient {
    // ── State ────────────────────────────────────────────────────────
    private ws: WebSocket | null = null;
    private _status: WebSocketSTTStatus = 'idle';
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    // ── Audio capture ────────────────────────────────────────────────
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;

    // ── Subscribers ──────────────────────────────────────────────────
    private transcriptListeners: Set<TranscriptCallback> = new Set();
    private statusListeners: Set<StatusCallback> = new Set();

    // ── API Key ──────────────────────────────────────────────────────
    private apiKey: string;

    // ── Running flag ─────────────────────────────────────────────────
    private _isRunning = false;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    // ── PUBLIC API ───────────────────────────────────────────────────

    get status(): WebSocketSTTStatus {
        return this._status;
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * Start the WebSocket STT pipeline:
     * 1. Request mic access
     * 2. Set up AudioWorklet for PCM capture
     * 3. Open WebSocket to Deepgram
     * 4. Begin streaming audio
     */
    async start(): Promise<void> {
        if (this._isRunning) return;
        this._isRunning = true;
        this.reconnectAttempts = 0;

        try {
            // ── Mic access ───────────────────────────────────────────
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            // ── AudioContext + Worklet ───────────────────────────────
            // IMPORTANT: We inline the worklet code as a Blob URL because
            // AudioWorklets require same-origin scripts. When serving from
            // GCS/CDN, external worklet files fail with CORS errors.
            // Blob URLs are always same-origin, bypassing this restriction.
            this.audioContext = new AudioContext();

            const workletCode = `
const TARGET_SAMPLE_RATE = 16000;
const CHUNK_INTERVAL_SEC = 0.1;

class STTCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.nativeSampleRate = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
        this.chunkSizeNative = Math.floor(this.nativeSampleRate * CHUNK_INTERVAL_SEC);
        this.buffer = new Float32Array(this.chunkSizeNative);
        this.bufferOffset = 0;
    }

    process(inputs, _outputs, _parameters) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        const channelData = input[0];
        if (!channelData || channelData.length === 0) return true;

        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferOffset++] = channelData[i];
            if (this.bufferOffset >= this.chunkSizeNative) {
                const int16Chunk = this.resampleAndConvert(this.buffer);
                this.port.postMessage(
                    { type: 'stt-chunk', samples: int16Chunk },
                    [int16Chunk.buffer]
                );
                this.buffer = new Float32Array(this.chunkSizeNative);
                this.bufferOffset = 0;
            }
        }
        return true;
    }

    resampleAndConvert(input) {
        const ratio = this.nativeSampleRate / TARGET_SAMPLE_RATE;
        const outputLength = Math.floor(input.length / ratio);
        const output = new Int16Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const srcFloor = Math.floor(srcIndex);
            const srcCeil = Math.min(srcFloor + 1, input.length - 1);
            const frac = srcIndex - srcFloor;
            const sample = input[srcFloor] * (1 - frac) + input[srcCeil] * frac;
            output[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
        }
        return output;
    }
}

registerProcessor('stt-capture-processor', STTCaptureProcessor);
`;
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);

            await this.audioContext.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl); // Clean up — module is loaded

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.workletNode = new AudioWorkletNode(this.audioContext, 'stt-capture-processor');

            // When the worklet sends a PCM chunk, forward it to the WebSocket
            this.workletNode.port.onmessage = (event: MessageEvent) => {
                if (event.data?.type === 'stt-chunk' && this.ws?.readyState === WebSocket.OPEN) {
                    // Send raw Int16 PCM as binary frame
                    this.ws.send(event.data.samples.buffer);
                }
            };

            this.sourceNode.connect(this.workletNode);
            // WorkletNode doesn't need to connect to destination (no playback)

            // ── WebSocket ────────────────────────────────────────────
            this.connectWebSocket();

        } catch (err) {
            console.error('[WebSocketSTT] Failed to start:', err);
            this.setStatus('error', err instanceof Error ? err.message : 'mic-access-failed');
            this._isRunning = false;
            throw err;
        }
    }

    /**
     * Stop the WebSocket STT pipeline. Cleans up mic, worklet, and WebSocket.
     */
    stop(): void {
        this._isRunning = false;

        // Cancel pending reconnect
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Stop KeepAlive
        this.stopKeepAlive();

        // Close WebSocket gracefully
        if (this.ws) {
            try {
                // Send CloseStream message to Deepgram before closing
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'CloseStream' }));
                }
                this.ws.close(1000, 'Client stopped');
            } catch {
                // Ignore close errors
            }
            this.ws = null;
        }

        // Disconnect audio nodes
        if (this.workletNode) {
            this.workletNode.port.onmessage = null;
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        // Release mic
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }

        // Close AudioContext
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.setStatus('closed');
        console.log('[WebSocketSTT] Stopped');
    }

    /**
     * Fully destroy — stop + clear all listeners.
     */
    destroy(): void {
        this.stop();
        this.transcriptListeners.clear();
        this.statusListeners.clear();
    }

    /**
     * Subscribe to transcript events. Returns unsubscribe function.
     */
    onTranscript(callback: TranscriptCallback): () => void {
        this.transcriptListeners.add(callback);
        return () => this.transcriptListeners.delete(callback);
    }

    /**
     * Subscribe to status changes. Returns unsubscribe function.
     */
    onStatusChange(callback: StatusCallback): () => void {
        this.statusListeners.add(callback);
        return () => this.statusListeners.delete(callback);
    }

    // ── WEBSOCKET MANAGEMENT ────────────────────────────────────────

    /**
     * Open a WebSocket connection to Deepgram.
     * Called on initial start and on reconnection attempts.
     */
    private connectWebSocket(): void {
        if (!this._isRunning) return;

        this.setStatus('connecting');
        console.log('[WebSocketSTT] Connecting to Deepgram...');

        const ws = new WebSocket(DEEPGRAM_WS_URL, ['token', this.apiKey]);

        ws.onopen = () => {
            console.log('[WebSocketSTT] ✅ Connected to Deepgram');
            this.reconnectAttempts = 0;
            this.setStatus('listening');
            this.startKeepAlive();
        };

        ws.onmessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data as string);

                if (data.type === 'Results') {
                    this.handleDeepgramResult(data as DeepgramResponse);
                }
            } catch (err) {
                console.warn('[WebSocketSTT] Failed to parse message:', err);
            }
        };

        ws.onerror = (event: Event) => {
            console.error('[WebSocketSTT] WebSocket error:', event);
        };

        ws.onclose = (event: CloseEvent) => {
            console.log(`[WebSocketSTT] WebSocket closed: code=${event.code} reason="${event.reason}"`);
            this.stopKeepAlive();

            // Only reconnect if we're still supposed to be running
            if (this._isRunning) {
                this.attemptReconnect();
            } else {
                this.setStatus('closed');
            }
        };

        this.ws = ws;
    }

    /**
     * Handle a Deepgram streaming result.
     * Emits TranscriptEvent matching SpeechEngine's interface.
     */
    private handleDeepgramResult(result: DeepgramResponse): void {
        const alt = result.channel?.alternatives?.[0];
        if (!alt || !alt.transcript) return;

        const text = alt.transcript.trim();
        if (!text) return;

        const event: TranscriptEvent = {
            text,
            isFinal: result.is_final,
            timestamp: Date.now(),
        };

        this.emitTranscript(event);
    }

    /**
     * Attempt to reconnect with exponential backoff.
     * Drop audio during reconnect — don't buffer.
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.warn(`[WebSocketSTT] ⛔ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
            this.setStatus('error', 'max-reconnects');
            this._isRunning = false;
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
            10000
        );

        console.log(
            `[WebSocketSTT] Reconnecting in ${delay}ms ` +
            `(attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
        );
        this.setStatus('reconnecting');

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this._isRunning) {
                this.connectWebSocket();
            }
        }, delay);
    }

    // ── KEEPALIVE ───────────────────────────────────────────────────

    /**
     * Start sending KeepAlive messages every 5 seconds.
     * Deepgram closes connections after 10 seconds of silence.
     */
    private startKeepAlive(): void {
        this.stopKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private stopKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    // ── INTERNAL ────────────────────────────────────────────────────

    private emitTranscript(event: TranscriptEvent): void {
        const prefix = event.isFinal ? '✅ FINAL' : '💬 interim';
        console.log(`[WebSocketSTT] ${prefix}: "${event.text}"`);

        for (const listener of this.transcriptListeners) {
            try {
                listener(event);
            } catch (err) {
                console.error('[WebSocketSTT] Listener threw:', err);
            }
        }
    }

    private setStatus(status: WebSocketSTTStatus, detail?: string): void {
        this._status = status;
        for (const listener of this.statusListeners) {
            try {
                listener(status, detail);
            } catch (err) {
                console.error('[WebSocketSTT] Status listener threw:', err);
            }
        }
    }
}
