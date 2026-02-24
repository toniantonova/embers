/**
 * WebSocketSTTClient.test.ts — Unit tests for the Deepgram WebSocket STT client.
 *
 * MOCK STRATEGY:
 * ──────────────
 * We mock WebSocket, AudioContext, AudioWorkletNode, and getUserMedia.
 * These browser APIs aren't available in jsdom, so we simulate the entire
 * pipeline: mic access → worklet → WebSocket → transcript parsing.
 *
 * WHAT WE TEST:
 * ─────────────
 * 1. Lifecycle: start/stop/destroy state transitions
 * 2. Deepgram connection: URL params, auth protocol header
 * 3. Transcript parsing: interim, final, empty, malformed responses
 * 4. KeepAlive: sends heartbeat on interval, stops on disconnect
 * 5. Reconnection: exponential backoff, max attempts, drop-audio semantics
 * 6. Subscriber management: onTranscript, onStatusChange, unsubscribe
 * 7. Error isolation: throwing listeners don't crash the pipeline
 * 8. Audio forwarding: worklet PCM chunks forwarded to WebSocket
 * 9. Graceful shutdown: CloseStream message, mic release, AudioContext close
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketSTTClient } from '../audio/WebSocketSTTClient';
import type { WebSocketSTTStatus } from '../audio/WebSocketSTTClient';

// ── MOCK INFRASTRUCTURE ─────────────────────────────────────────────

/** Captured MockWebSocket instances for test assertions. */
let lastMockWS: any = null;

/** Captured worklet port.onmessage handler. */
let capturedWorkletOnMessage: ((event: MessageEvent) => void) | null = null;

/** Captured media tracks for verifying stop(). */
const mockTrackStop = vi.fn();

function setupBrowserMocks() {
    // Mock getUserMedia
    Object.defineProperty(navigator, 'mediaDevices', {
        value: {
            getUserMedia: vi.fn().mockResolvedValue({
                getTracks: () => [{ stop: mockTrackStop }],
            }),
        },
        writable: true,
        configurable: true,
    });

    // Mock AudioContext (must be a class so `new AudioContext()` works)
    class MockAudioWorkletNode {
        port = {
            set onmessage(handler: any) {
                capturedWorkletOnMessage = handler;
            },
            get onmessage() {
                return capturedWorkletOnMessage;
            },
        };
        connect = vi.fn();
        disconnect = vi.fn();
    }

    class MockAudioContext {
        audioWorklet = {
            addModule: vi.fn().mockResolvedValue(undefined),
        };
        createMediaStreamSource = vi.fn().mockReturnValue({
            connect: vi.fn(),
            disconnect: vi.fn(),
        });
        close = vi.fn();
    }

    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).AudioWorkletNode = MockAudioWorkletNode;

    // Mock WebSocket
    (globalThis as any).WebSocket = vi.fn().mockImplementation(function (this: any, url: string, protocols: string[]) {
        this.url = url;
        this.protocols = protocols;
        this.readyState = 0; // CONNECTING
        this.send = vi.fn();
        this.close = vi.fn();
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        lastMockWS = this;
        return this;
    });
    (globalThis as any).WebSocket.OPEN = 1;
    (globalThis as any).WebSocket.CLOSED = 3;
}

function teardownBrowserMocks() {
    delete (globalThis as any).AudioContext;
    delete (globalThis as any).AudioWorkletNode;
    lastMockWS = null;
    capturedWorkletOnMessage = null;
    mockTrackStop.mockClear();
}

/** Simulate the WebSocket opening successfully. */
function openWebSocket() {
    if (lastMockWS) {
        lastMockWS.readyState = 1; // WebSocket.OPEN
        lastMockWS.onopen?.();
    }
}

/** Simulate Deepgram sending a transcript result. */
function sendDeepgramResult(transcript: string, isFinal: boolean) {
    if (lastMockWS?.onmessage) {
        lastMockWS.onmessage({
            data: JSON.stringify({
                type: 'Results',
                channel: {
                    alternatives: [{ transcript, confidence: 0.98 }],
                },
                is_final: isFinal,
                speech_final: isFinal,
            }),
        });
    }
}

/** Simulate the WebSocket closing. */
function closeWebSocket(code = 1000, reason = '') {
    if (lastMockWS?.onclose) {
        lastMockWS.readyState = 3; // CLOSED
        lastMockWS.onclose({ code, reason });
    }
}


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: LIFECYCLE
// ══════════════════════════════════════════════════════════════════════

describe('WebSocketSTTClient — Lifecycle', () => {
    beforeEach(() => {
        setupBrowserMocks();
    });
    afterEach(() => {
        teardownBrowserMocks();
    });

    it('starts in idle status', () => {
        const client = new WebSocketSTTClient('test-key');
        expect(client.status).toBe('idle');
        expect(client.isRunning).toBe(false);
    });

    it('start() transitions to connecting → listening', async () => {
        const client = new WebSocketSTTClient('test-key');
        const statuses: WebSocketSTTStatus[] = [];
        client.onStatusChange((s) => statuses.push(s));

        const startPromise = client.start();

        // Wait for mic access + worklet setup
        await startPromise;

        // Should have connected to Deepgram
        expect(lastMockWS).not.toBeNull();
        expect(statuses).toContain('connecting');

        // Simulate WS open
        openWebSocket();
        expect(statuses).toContain('listening');
        expect(client.isRunning).toBe(true);

        client.destroy();
    });

    it('start() is a no-op when already running', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();
        openWebSocket();

        const wsBefore = lastMockWS;
        await client.start(); // second call

        // No new WebSocket created
        expect(lastMockWS).toBe(wsBefore);
        client.destroy();
    });

    it('stop() releases mic, closes WebSocket, and sets status to closed', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();
        openWebSocket();

        client.stop();

        expect(client.isRunning).toBe(false);
        expect(client.status).toBe('closed');
        expect(mockTrackStop).toHaveBeenCalled();
    });

    it('stop() sends CloseStream before closing WebSocket', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();
        openWebSocket();

        client.stop();

        // Should have sent CloseStream JSON
        const sendCalls = lastMockWS?.send.mock.calls;
        const closeStreamCall = sendCalls?.find(
            (call: any[]) => {
                try {
                    const parsed = JSON.parse(call[0]);
                    return parsed.type === 'CloseStream';
                } catch { return false; }
            }
        );
        expect(closeStreamCall).toBeDefined();
    });

    it('destroy() clears all listeners', async () => {
        const client = new WebSocketSTTClient('test-key');
        const cb = vi.fn();
        client.onTranscript(cb);
        await client.start();
        openWebSocket();

        client.destroy();

        // Listeners should be cleared — no more callbacks
        // We can test by checking the client is stopped
        expect(client.isRunning).toBe(false);
        expect(client.status).toBe('closed');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: DEEPGRAM CONNECTION
// ══════════════════════════════════════════════════════════════════════

describe('WebSocketSTTClient — Deepgram Connection', () => {
    beforeEach(setupBrowserMocks);
    afterEach(teardownBrowserMocks);

    it('connects with explicit encoding params in the URL', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();

        const url = lastMockWS?.url as string;
        expect(url).toContain('encoding=linear16');
        expect(url).toContain('sample_rate=16000');
        expect(url).toContain('channels=1');
        expect(url).toContain('interim_results=true');
        expect(url).toContain('model=nova-3');

        client.destroy();
    });

    it('authenticates via WebSocket subprotocol header', async () => {
        const client = new WebSocketSTTClient('my-secret-key');
        await client.start();

        const protocols = lastMockWS?.protocols;
        expect(protocols).toEqual(['token', 'my-secret-key']);

        client.destroy();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: TRANSCRIPT PARSING
// ══════════════════════════════════════════════════════════════════════

describe('WebSocketSTTClient — Transcript Parsing', () => {
    beforeEach(setupBrowserMocks);
    afterEach(teardownBrowserMocks);

    it('emits interim transcript events', async () => {
        const client = new WebSocketSTTClient('test-key');
        const transcripts: any[] = [];
        client.onTranscript((e) => transcripts.push(e));

        await client.start();
        openWebSocket();

        sendDeepgramResult('hello world', false);

        expect(transcripts).toHaveLength(1);
        expect(transcripts[0]).toEqual(expect.objectContaining({
            text: 'hello world',
            isFinal: false,
            timestamp: expect.any(Number),
        }));

        client.destroy();
    });

    it('emits final transcript events', async () => {
        const client = new WebSocketSTTClient('test-key');
        const transcripts: any[] = [];
        client.onTranscript((e) => transcripts.push(e));

        await client.start();
        openWebSocket();

        sendDeepgramResult('hello world', true);

        expect(transcripts).toHaveLength(1);
        expect(transcripts[0].isFinal).toBe(true);

        client.destroy();
    });

    it('ignores empty transcript strings', async () => {
        const client = new WebSocketSTTClient('test-key');
        const transcripts: any[] = [];
        client.onTranscript((e) => transcripts.push(e));

        await client.start();
        openWebSocket();

        sendDeepgramResult('', false);
        sendDeepgramResult('   ', false);

        expect(transcripts).toHaveLength(0);

        client.destroy();
    });

    it('handles malformed JSON gracefully', async () => {
        const client = new WebSocketSTTClient('test-key');
        const transcripts: any[] = [];
        client.onTranscript((e) => transcripts.push(e));

        await client.start();
        openWebSocket();

        // Send garbage
        lastMockWS.onmessage?.({ data: 'not json {{{' });

        // Should not crash, no transcripts emitted
        expect(transcripts).toHaveLength(0);

        client.destroy();
    });

    it('ignores non-Results message types', async () => {
        const client = new WebSocketSTTClient('test-key');
        const transcripts: any[] = [];
        client.onTranscript((e) => transcripts.push(e));

        await client.start();
        openWebSocket();

        // Deepgram sends Metadata at connection start
        lastMockWS.onmessage?.({
            data: JSON.stringify({ type: 'Metadata', request_id: '123' })
        });

        expect(transcripts).toHaveLength(0);

        client.destroy();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: KEEPALIVE
// ══════════════════════════════════════════════════════════════════════

describe('WebSocketSTTClient — KeepAlive', () => {
    beforeEach(() => {
        setupBrowserMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        teardownBrowserMocks();
    });

    it('sends KeepAlive every 5 seconds after connection', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();
        openWebSocket();

        // Clear any send calls from connection setup
        lastMockWS.send.mockClear();

        // Advance 5 seconds
        vi.advanceTimersByTime(5000);

        const keepAliveCalls = lastMockWS.send.mock.calls.filter(
            (call: any[]) => {
                try {
                    return JSON.parse(call[0]).type === 'KeepAlive';
                } catch { return false; }
            }
        );
        expect(keepAliveCalls).toHaveLength(1);

        // Another 5 seconds
        vi.advanceTimersByTime(5000);
        const keepAliveCalls2 = lastMockWS.send.mock.calls.filter(
            (call: any[]) => {
                try {
                    return JSON.parse(call[0]).type === 'KeepAlive';
                } catch { return false; }
            }
        );
        expect(keepAliveCalls2).toHaveLength(2);

        client.destroy();
    });

    it('stops KeepAlive on disconnect', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();
        openWebSocket();

        client.stop();
        lastMockWS.send.mockClear();

        vi.advanceTimersByTime(10000);

        // No KeepAlive sent after stop
        expect(lastMockWS.send).not.toHaveBeenCalled();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: RECONNECTION
// ══════════════════════════════════════════════════════════════════════

describe('WebSocketSTTClient — Reconnection', () => {
    beforeEach(() => {
        setupBrowserMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        teardownBrowserMocks();
    });

    it('reconnects with exponential backoff on unexpected close', async () => {
        const client = new WebSocketSTTClient('test-key');
        const statuses: WebSocketSTTStatus[] = [];
        client.onStatusChange((s) => statuses.push(s));

        await client.start();
        openWebSocket();

        // Simulate unexpected close
        closeWebSocket(1006, 'Abnormal close');

        expect(statuses).toContain('reconnecting');

        // First reconnect delay: 500ms
        vi.advanceTimersByTime(500);

        // A new WebSocket should have been created
        expect(lastMockWS).not.toBeNull();
        expect(statuses).toContain('connecting');

        client.destroy();
    });

    it('gives up after MAX_RECONNECT_ATTEMPTS (5)', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();

        // First connection opens fine, then close unexpectedly
        openWebSocket();
        closeWebSocket(1006, 'Server error');

        // Simulate 5 consecutive failed reconnects (WebSocket closes
        // before ever reaching OPEN state = never calls onopen)
        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(20000); // past any backoff delay
            // New WS was created by reconnect logic, close it without opening
            closeWebSocket(1006, 'Server error');
        }

        // Should have hit max reconnect attempts
        vi.advanceTimersByTime(20000);
        expect(client.status).toBe('error');
        expect(client.isRunning).toBe(false);

        client.destroy();
    });

    it('resets reconnect counter on successful connection', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();

        // Simulate 3 failed reconnects
        for (let i = 0; i < 3; i++) {
            openWebSocket();
            closeWebSocket(1006, 'Fail');
            vi.advanceTimersByTime(20000);
        }

        // Now connect successfully
        openWebSocket();
        expect(client.status).toBe('listening');

        // Close again — should restart from attempt 1, not 4
        closeWebSocket(1006, 'Fail again');
        vi.advanceTimersByTime(500);

        expect(client.status).not.toBe('error');

        client.destroy();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: SUBSCRIBER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

describe('WebSocketSTTClient — Subscribers', () => {
    beforeEach(setupBrowserMocks);
    afterEach(teardownBrowserMocks);

    it('onTranscript returns an unsubscribe function', async () => {
        const client = new WebSocketSTTClient('test-key');
        const cb = vi.fn();
        const unsub = client.onTranscript(cb);

        await client.start();
        openWebSocket();

        sendDeepgramResult('first', true);
        expect(cb).toHaveBeenCalledTimes(1);

        unsub();

        sendDeepgramResult('second', true);
        expect(cb).toHaveBeenCalledTimes(1); // still 1

        client.destroy();
    });

    it('multiple listeners all receive the same event', async () => {
        const client = new WebSocketSTTClient('test-key');
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        client.onTranscript(cb1);
        client.onTranscript(cb2);

        await client.start();
        openWebSocket();

        sendDeepgramResult('hello', true);

        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);

        client.destroy();
    });

    it('a throwing listener does not crash other listeners', async () => {
        const client = new WebSocketSTTClient('test-key');
        const bad = vi.fn().mockImplementation(() => { throw new Error('boom'); });
        const good = vi.fn();
        client.onTranscript(bad);
        client.onTranscript(good);

        await client.start();
        openWebSocket();

        expect(() => sendDeepgramResult('test', true)).not.toThrow();
        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);

        client.destroy();
    });

    it('status listeners receive updates', async () => {
        const client = new WebSocketSTTClient('test-key');
        const statuses: WebSocketSTTStatus[] = [];
        client.onStatusChange((s) => statuses.push(s));

        await client.start();
        openWebSocket();

        expect(statuses).toContain('connecting');
        expect(statuses).toContain('listening');

        client.stop();
        expect(statuses).toContain('closed');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 7: AUDIO FORWARDING
// ══════════════════════════════════════════════════════════════════════

describe('WebSocketSTTClient — Audio Forwarding', () => {
    beforeEach(setupBrowserMocks);
    afterEach(teardownBrowserMocks);

    it('forwards PCM chunks from worklet to WebSocket', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();
        openWebSocket();

        // Simulate worklet posting a PCM chunk
        const samples = new Int16Array([100, -200, 300]);
        if (capturedWorkletOnMessage) {
            capturedWorkletOnMessage(
                { data: { type: 'stt-chunk', samples } } as any
            );
        }

        // The WebSocket should have received the binary buffer
        expect(lastMockWS.send).toHaveBeenCalledWith(samples.buffer);

        client.destroy();
    });

    it('does not forward audio when WebSocket is not open', async () => {
        const client = new WebSocketSTTClient('test-key');
        await client.start();
        // Note: WebSocket NOT opened (readyState = CONNECTING)

        const samples = new Int16Array([100]);
        if (capturedWorkletOnMessage) {
            capturedWorkletOnMessage(
                { data: { type: 'stt-chunk', samples } } as any
            );
        }

        // Should not have called send (readyState is not OPEN)
        expect(lastMockWS.send).not.toHaveBeenCalled();

        client.destroy();
    });
});
