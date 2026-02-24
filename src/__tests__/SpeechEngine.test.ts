/**
 * SpeechEngine.test.ts — Unit tests for the speech recognition service.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * SpeechEngine wraps the Web Speech API and provides:
 *   1. Subscribe/unsubscribe for transcript events
 *   2. Text-input fallback via submitText()
 *   3. Graceful error handling (bad listeners, unsupported browsers)
 *   4. State management (isRunning, isSupported)
 *   5. Cleanup on stop()
 *
 * MOCK STRATEGY:
 * ──────────────
 * We mock window.webkitSpeechRecognition since the real Web Speech API
 * isn't available in Node.js / jsdom. We test the SpeechEngine's own
 * logic (subscriber management, submitText, error isolation) rather
 * than the browser's recognition accuracy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechEngine } from '../services/SpeechEngine';

// ── MOCK WEB SPEECH API ──────────────────────────────────────────────

/** Minimal mock SpeechRecognition class usable with `new`. */
let lastMockInstance: any = null;

function createMockRecognitionClass() {
    class MockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = '';
        onresult: any = null;
        onend: any = null;
        onerror: any = null;
        onstart: any = null;
        start = vi.fn(function (this: any) {
            if (this.onstart) this.onstart();
        });
        stop = vi.fn();
        abort = vi.fn();

        constructor() {
            lastMockInstance = this;
        }
    }
    return MockSpeechRecognition;
}


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: SUBSCRIPTION MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Subscriptions', () => {
    let engine: SpeechEngine;

    beforeEach(() => {
        // Ensure no SpeechRecognition exists → unsupported mode
        delete (window as any).SpeechRecognition;
        delete (window as any).webkitSpeechRecognition;
        engine = new SpeechEngine();
    });

    it('onTranscript returns an unsubscribe function', () => {
        const cb = vi.fn();
        const unsub = engine.onTranscript(cb);
        expect(typeof unsub).toBe('function');
    });

    it('subscriber receives events from submitText', () => {
        const cb = vi.fn();
        engine.onTranscript(cb);

        engine.submitText('hello');

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(
            expect.objectContaining({
                text: 'hello',
                isFinal: true,
            })
        );
    });

    it('unsubscribed listener no longer receives events', () => {
        const cb = vi.fn();
        const unsub = engine.onTranscript(cb);

        engine.submitText('first');
        expect(cb).toHaveBeenCalledTimes(1);

        unsub();
        engine.submitText('second');
        expect(cb).toHaveBeenCalledTimes(1); // still 1, not 2
    });

    it('multiple listeners all receive the same event', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const cb3 = vi.fn();

        engine.onTranscript(cb1);
        engine.onTranscript(cb2);
        engine.onTranscript(cb3);

        engine.submitText('test');

        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
        expect(cb3).toHaveBeenCalledTimes(1);
    });

    it('a throwing listener does not crash other listeners', () => {
        const badCb = vi.fn().mockImplementation(() => {
            throw new Error('Listener exploded!');
        });
        const goodCb = vi.fn();

        engine.onTranscript(badCb);
        engine.onTranscript(goodCb);

        // Should NOT throw
        expect(() => engine.submitText('test')).not.toThrow();

        // Bad listener was called (and threw)
        expect(badCb).toHaveBeenCalledTimes(1);
        // Good listener was still called after the bad one
        expect(goodCb).toHaveBeenCalledTimes(1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: submitText
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — submitText()', () => {
    let engine: SpeechEngine;

    beforeEach(() => {
        delete (window as any).SpeechRecognition;
        delete (window as any).webkitSpeechRecognition;
        engine = new SpeechEngine();
    });

    it('emits a TranscriptEvent with isFinal=true', () => {
        const cb = vi.fn();
        engine.onTranscript(cb);

        engine.submitText('ocean');

        expect(cb).toHaveBeenCalledWith(
            expect.objectContaining({
                text: 'ocean',
                isFinal: true,
                timestamp: expect.any(Number),
            })
        );
    });

    it('trims whitespace from submitted text', () => {
        const cb = vi.fn();
        engine.onTranscript(cb);

        engine.submitText('  horse  ');

        expect(cb).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'horse' })
        );
    });

    it('ignores empty string', () => {
        const cb = vi.fn();
        engine.onTranscript(cb);

        engine.submitText('');
        engine.submitText('   ');
        engine.submitText('\t\n');

        expect(cb).not.toHaveBeenCalled();
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: UNSUPPORTED BROWSER FALLBACK
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Unsupported Browser', () => {
    it('isSupported is false when no SpeechRecognition in window', () => {
        delete (window as any).SpeechRecognition;
        delete (window as any).webkitSpeechRecognition;

        const engine = new SpeechEngine();
        expect(engine.isSupported).toBe(false);
    });

    it('start() still sets isRunning to true in fallback mode', () => {
        delete (window as any).SpeechRecognition;
        delete (window as any).webkitSpeechRecognition;

        const engine = new SpeechEngine();
        engine.start();
        expect(engine.isRunning).toBe(true);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: SUPPORTED BROWSER — START/STOP
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — With Web Speech API', () => {
    beforeEach(() => {
        lastMockInstance = null;
        (window as any).webkitSpeechRecognition = createMockRecognitionClass();
        delete (window as any).SpeechRecognition;
    });

    afterEach(() => {
        delete (window as any).webkitSpeechRecognition;
    });

    it('isSupported is true when webkitSpeechRecognition exists', () => {
        const engine = new SpeechEngine();
        expect(engine.isSupported).toBe(true);
    });

    it('start() creates a recognition instance and starts it', () => {
        lastMockInstance = null;
        const engine = new SpeechEngine();
        engine.start();

        expect(lastMockInstance).not.toBeNull();
        expect(lastMockInstance.start).toHaveBeenCalled();
        expect(lastMockInstance.continuous).toBe(true);
        expect(lastMockInstance.interimResults).toBe(true);
        expect(lastMockInstance.lang).toBe('en-US');
    });

    it('start() is a no-op when already running', () => {
        lastMockInstance = null;
        const engine = new SpeechEngine();
        engine.start();
        const firstInstance = lastMockInstance;

        engine.start(); // second call
        // Same instance — no new construction happened
        expect(lastMockInstance).toBe(firstInstance);
    });

    it('stop() aborts recognition and resets isRunning', () => {
        const engine = new SpeechEngine();
        engine.start();

        const instance = lastMockInstance;
        engine.stop();

        expect(instance.abort).toHaveBeenCalled();
        expect(engine.isRunning).toBe(false);
    });

    it('isRunning tracks state correctly across start/stop', () => {
        const engine = new SpeechEngine();

        expect(engine.isRunning).toBe(false);

        engine.start();
        expect(engine.isRunning).toBe(true);

        engine.stop();
        expect(engine.isRunning).toBe(false);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: FATAL vs RECOVERABLE ERROR HANDLING
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Error Classification', () => {
    let savedKey: string | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        lastMockInstance = null;
        (window as any).webkitSpeechRecognition = createMockRecognitionClass();
        delete (window as any).SpeechRecognition;
        // Remove Deepgram key so fatal errors go to unsupported mode,
        // not WebSocket fallback.
        savedKey = import.meta.env.VITE_DEEPGRAM_API_KEY;
        delete import.meta.env.VITE_DEEPGRAM_API_KEY;
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (window as any).webkitSpeechRecognition;
        if (savedKey !== undefined) {
            import.meta.env.VITE_DEEPGRAM_API_KEY = savedKey;
        }
    });

    it('fatal error "service-not-allowed" switches to unsupported mode', () => {
        const engine = new SpeechEngine();
        const statusCb = vi.fn();
        engine.onStatusChange(statusCb);
        engine.start();
        const instance = lastMockInstance;

        // Simulate the fatal error (mobile browsers)
        instance.onerror({ error: 'service-not-allowed' });

        // Engine switches to "unsupported" fallback mode (like Firefox)
        expect(engine.isRunning).toBe(true);   // stays running in fallback
        expect(engine.isSupported).toBe(false); // triggers text input UI
        expect(engine.status).toBe('unsupported');

        // Advance timers — should NOT restart
        const startCallsBefore = instance.start.mock.calls.length;
        vi.advanceTimersByTime(10000);
        expect(instance.start.mock.calls.length).toBe(startCallsBefore);
    });

    it('fatal error "not-allowed" switches to unsupported mode', () => {
        const engine = new SpeechEngine();
        engine.start();
        const instance = lastMockInstance;

        instance.onerror({ error: 'not-allowed' });

        expect(engine.isRunning).toBe(true);   // stays running in fallback
        expect(engine.isSupported).toBe(false);
        expect(engine.status).toBe('unsupported');
    });

    it('recoverable error "network" triggers retry', () => {
        const engine = new SpeechEngine();
        engine.start();

        // Fire a recoverable error
        lastMockInstance.onerror({ error: 'network' });

        expect(engine.status).toBe('error');

        // Advance past the first retry delay (1s)
        vi.advanceTimersByTime(1100);

        // A new instance should have been created (retry happened)
        expect(lastMockInstance).not.toBeNull();
        expect(lastMockInstance.start).toHaveBeenCalled();
    });

    it('stops retrying after MAX_RETRIES recoverable errors', () => {
        const engine = new SpeechEngine();
        engine.start(); // initial start — onstart fires, isRunning = true

        // After the initial successful start, override the mock class so
        // subsequent instances' start() does NOT auto-fire onstart.
        // This simulates retries that fail to establish a connection.
        (window as any).webkitSpeechRecognition = class {
            continuous = false;
            interimResults = false;
            lang = '';
            onresult: any = null;
            onend: any = null;
            onerror: any = null;
            onstart: any = null;
            start = vi.fn(); // does NOT call onstart
            stop = vi.fn();
            abort = vi.fn();
            constructor() { lastMockInstance = this; }
        };

        // Fire 5 recoverable errors (MAX_RETRIES = 5)
        for (let i = 0; i < 5; i++) {
            lastMockInstance.onerror({ error: 'network' });
            vi.advanceTimersByTime(20000); // advance past exponential delay
        }

        // After 5 retries, fire one more error — engine should give up
        lastMockInstance.onerror({ error: 'network' });
        vi.advanceTimersByTime(60000);

        // Engine gave up — isRunning should be false
        expect(engine.isRunning).toBe(false);
    });

    it('retry counter resets on successful restart', () => {
        const engine = new SpeechEngine();
        engine.start();

        // Simulate 3 recoverable errors
        for (let i = 0; i < 3; i++) {
            lastMockInstance.onerror({ error: 'network' });
            vi.advanceTimersByTime(20000);
        }

        // Now simulate a successful start (onstart fires)
        lastMockInstance.onstart();

        // After a successful start, we should still be able to retry 5 more
        // times — the counter was reset
        expect(engine.isRunning).toBe(true);
        expect(engine.status).toBe('listening');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: WEBSOCKET FALLBACK PATH
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — WebSocket Fallback', () => {
    // We need to mock import.meta.env for the Deepgram API key.
    // Vitest already supports this via vi.stubEnv or import.meta.env.
    let originalEnv: string | undefined;

    beforeEach(() => {
        delete (window as any).SpeechRecognition;
        delete (window as any).webkitSpeechRecognition;
        originalEnv = import.meta.env.VITE_DEEPGRAM_API_KEY;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            import.meta.env.VITE_DEEPGRAM_API_KEY = originalEnv;
        } else {
            delete import.meta.env.VITE_DEEPGRAM_API_KEY;
        }
    });

    it('without Deepgram key + no Web Speech: enters text-input fallback', () => {
        delete import.meta.env.VITE_DEEPGRAM_API_KEY;
        const engine = new SpeechEngine();
        engine.start();

        expect(engine.isRunning).toBe(true);
        expect(engine.isSupported).toBe(false);
        expect(engine.status).toBe('unsupported');
    });

    it('submitText still works in text-input fallback mode', () => {
        delete import.meta.env.VITE_DEEPGRAM_API_KEY;
        const engine = new SpeechEngine();
        const cb = vi.fn();
        engine.onTranscript(cb);
        engine.start();

        engine.submitText('typed text');

        expect(cb).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'typed text', isFinal: true })
        );
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 7: LAZY DETECTION CACHE
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Lazy Detection Cache', () => {
    beforeEach(() => {
        lastMockInstance = null;
        (window as any).webkitSpeechRecognition = createMockRecognitionClass();
        delete (window as any).SpeechRecognition;
    });

    afterEach(() => {
        delete (window as any).webkitSpeechRecognition;
    });

    it('caches "works" on first successful start', () => {
        const engine = new SpeechEngine();

        // First start — probe is "untested"
        engine.start();
        expect(engine.status).toBe('listening');

        // Stop and start again — uses cached result
        engine.stop();
        engine.start();

        // Should still work without re-probing
        expect(engine.isRunning).toBe(true);
        expect(engine.status).toBe('listening');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 8: FATAL ERROR → WEBSOCKET FALLBACK
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Fatal Error with Deepgram Key', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        lastMockInstance = null;
        (window as any).webkitSpeechRecognition = createMockRecognitionClass();
        delete (window as any).SpeechRecognition;
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (window as any).webkitSpeechRecognition;
    });

    it('fatal error caches probe as "broken"', () => {
        // No Deepgram key → can't fall to WS, but probe is still cached
        delete import.meta.env.VITE_DEEPGRAM_API_KEY;
        const engine = new SpeechEngine();
        engine.start();

        lastMockInstance.onerror({ error: 'service-not-allowed' });

        // isSupported is now false (probe cached as broken)
        expect(engine.isSupported).toBe(false);
        expect(engine.status).toBe('unsupported');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 9: SAFARI isFinal TIMEOUT WORKAROUND
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Safari isFinal Workaround', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        lastMockInstance = null;
        (window as any).webkitSpeechRecognition = createMockRecognitionClass();
        delete (window as any).SpeechRecognition;
        // Fake Safari user agent
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            writable: true,
            configurable: true,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (window as any).webkitSpeechRecognition;
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (jsdom)',
            writable: true,
            configurable: true,
        });
    });

    it('force-finalizes after 750ms of no isFinal on Safari', () => {
        const engine = new SpeechEngine();
        const cb = vi.fn();
        engine.onTranscript(cb);
        engine.start();

        // Simulate an interim result with isFinal=false
        const mockResult = {
            0: { transcript: 'hello world', confidence: 0.9 },
            isFinal: false,
            length: 1,
        };
        lastMockInstance.onresult({
            resultIndex: 0,
            results: { 0: mockResult, length: 1 },
        });

        // Should have emitted interim
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0].isFinal).toBe(false);

        // Advance 750ms — Safari workaround kicks in
        vi.advanceTimersByTime(750);

        // Should now have a force-finalized event
        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb.mock.calls[1][0].isFinal).toBe(true);
        expect(cb.mock.calls[1][0].text).toBe('hello world');
    });

    it('cancels force-finalize when a real isFinal arrives', () => {
        const engine = new SpeechEngine();
        const cb = vi.fn();
        engine.onTranscript(cb);
        engine.start();

        // Interim result
        const interimResult = {
            0: { transcript: 'hello', confidence: 0.9 },
            isFinal: false,
            length: 1,
        };
        lastMockInstance.onresult({
            resultIndex: 0,
            results: { 0: interimResult, length: 1 },
        });

        // Before 750ms, a real final arrives
        vi.advanceTimersByTime(300);
        const finalResult = {
            0: { transcript: 'hello world', confidence: 0.95 },
            isFinal: true,
            length: 1,
        };
        lastMockInstance.onresult({
            resultIndex: 0,
            results: { 0: finalResult, length: 1 },
        });

        // Advance past the timeout — should NOT double-finalize
        vi.advanceTimersByTime(500);

        // Expected: interim + final = 2 calls, not 3
        expect(cb).toHaveBeenCalledTimes(2);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 10: SAFARI DEDUPLICATION
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Safari Deduplication', () => {
    beforeEach(() => {
        lastMockInstance = null;
        (window as any).webkitSpeechRecognition = createMockRecognitionClass();
        delete (window as any).SpeechRecognition;
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            writable: true,
            configurable: true,
        });
    });

    afterEach(() => {
        delete (window as any).webkitSpeechRecognition;
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (jsdom)',
            writable: true,
            configurable: true,
        });
    });

    it('skips duplicate final transcripts on Safari', () => {
        const engine = new SpeechEngine();
        const cb = vi.fn();
        engine.onTranscript(cb);
        engine.start();

        const finalResult = {
            0: { transcript: 'hello', confidence: 0.95 },
            isFinal: true,
            length: 1,
        };

        // First final — should emit
        lastMockInstance.onresult({
            resultIndex: 0,
            results: { 0: finalResult, length: 1 },
        });

        // Duplicate final — should be skipped
        lastMockInstance.onresult({
            resultIndex: 0,
            results: { 0: finalResult, length: 1 },
        });

        expect(cb).toHaveBeenCalledTimes(1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 11: STATUS SUBSCRIPTIONS
// ══════════════════════════════════════════════════════════════════════

describe('SpeechEngine — Status Subscriptions', () => {
    beforeEach(() => {
        lastMockInstance = null;
        (window as any).webkitSpeechRecognition = createMockRecognitionClass();
        delete (window as any).SpeechRecognition;
    });

    afterEach(() => {
        delete (window as any).webkitSpeechRecognition;
    });

    it('onStatusChange immediately fires with current status', () => {
        const engine = new SpeechEngine();
        const cb = vi.fn();

        engine.onStatusChange(cb);

        // Should have been called immediately with current status
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith('off', '');
    });

    it('onStatusChange unsubscribe stops future updates', () => {
        const engine = new SpeechEngine();
        const cb = vi.fn();
        const unsub = engine.onStatusChange(cb);

        // 1 call from immediate fire
        expect(cb).toHaveBeenCalledTimes(1);

        unsub();

        engine.start();
        // Should not receive 'listening' update
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('status transitions through listening → off on start/stop', () => {
        const engine = new SpeechEngine();
        const statuses: string[] = [];
        engine.onStatusChange((s) => statuses.push(s));

        engine.start();
        engine.stop();

        expect(statuses).toContain('listening');
        expect(statuses).toContain('off');
    });
});
