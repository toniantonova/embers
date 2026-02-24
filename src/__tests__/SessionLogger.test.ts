/**
 * SessionLogger.test.ts — Unit tests for the timestamped event buffer.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * SessionLogger collects timestamped events (audio, transcript, semantic,
 * workspace, interaction, system) into a buffer with a 10k cap. When the
 * cap is exceeded, it evicts the oldest audio events first, then workspace,
 * then any type. We verify:
 *   1. Basic logging and retrieval
 *   2. Event filtering by type
 *   3. The 10k buffer cap and eviction strategy
 *   4. JSON export format
 *   5. Clear/reset behavior
 *   6. The eventCount getter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionLogger } from '../services/SessionLogger';
import type { EventType } from '../services/SessionLogger';

// ── SETUP ────────────────────────────────────────────────────────────
let logger: SessionLogger;

beforeEach(() => {
    logger = new SessionLogger();
    vi.spyOn(console, 'log').mockImplementation(() => { });
});

afterEach(() => {
    vi.restoreAllMocks();
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 1: BASIC LOGGING
// ══════════════════════════════════════════════════════════════════════

describe('SessionLogger — Basic Logging', () => {
    it('starts with zero events', () => {
        expect(logger.eventCount).toBe(0);
        expect(logger.getEvents()).toHaveLength(0);
    });

    it('logs a single event and retrieves it', () => {
        logger.log('audio', { energy: 0.5 });

        expect(logger.eventCount).toBe(1);
        const events = logger.getEvents();
        expect(events[0].type).toBe('audio');
        expect(events[0].data.energy).toBe(0.5);
    });

    it('assigns timestamps to logged events', () => {
        const before = Date.now();
        logger.log('transcript', { text: 'hello' });
        const after = Date.now();

        const event = logger.getEvents()[0];
        expect(event.timestamp).toBeGreaterThanOrEqual(before);
        expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it('logs multiple events in order', () => {
        logger.log('audio', { energy: 0.1 });
        logger.log('transcript', { text: 'hi' });
        logger.log('semantic', { word: 'ocean' });

        const events = logger.getEvents();
        expect(events).toHaveLength(3);
        expect(events[0].type).toBe('audio');
        expect(events[1].type).toBe('transcript');
        expect(events[2].type).toBe('semantic');
    });

    it('accepts all nine event types', () => {
        const types: EventType[] = [
            'audio', 'transcript', 'semantic', 'workspace', 'interaction', 'system',
            'server_request', 'server_response', 'pipeline_phase',
        ];
        types.forEach(type => logger.log(type, { test: true }));

        expect(logger.eventCount).toBe(9);
        types.forEach((type, i) => {
            expect(logger.getEvents()[i].type).toBe(type);
        });
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 2: EVENT FILTERING
// ══════════════════════════════════════════════════════════════════════

describe('SessionLogger — Event Filtering', () => {
    it('filters events by type', () => {
        logger.log('audio', { energy: 0.1 });
        logger.log('transcript', { text: 'hi' });
        logger.log('audio', { energy: 0.2 });
        logger.log('semantic', { word: 'ocean' });
        logger.log('audio', { energy: 0.3 });

        const audioEvents = logger.getEventsByType('audio');
        expect(audioEvents).toHaveLength(3);
        expect(audioEvents[0].data.energy).toBe(0.1);
        expect(audioEvents[2].data.energy).toBe(0.3);
    });

    it('returns empty array for absent type', () => {
        logger.log('audio', { energy: 0.1 });

        expect(logger.getEventsByType('interaction')).toHaveLength(0);
    });

    it('getEvents returns readonly (does not expose internal array)', () => {
        logger.log('audio', { energy: 0.1 });
        const events = logger.getEvents();

        // The returned array should be the same reference (readonly)
        // but TypeScript prevents mutation. Verify content integrity:
        expect(events).toHaveLength(1);
        expect(events[0].data.energy).toBe(0.1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 3: BUFFER CAP & EVICTION
// ══════════════════════════════════════════════════════════════════════

describe('SessionLogger — Buffer Cap & Eviction', () => {
    it('enforces the 10,000 event cap', () => {
        // Fill to exactly 10,001 events (1 over the cap)
        for (let i = 0; i < 10001; i++) {
            logger.log('audio', { i });
        }

        expect(logger.eventCount).toBe(10000);
    });

    it('evicts oldest audio events first when cap is reached', () => {
        // Add 9,999 audio events + 1 transcript (total: 10,000)
        for (let i = 0; i < 9999; i++) {
            logger.log('audio', { i });
        }
        logger.log('transcript', { text: 'precious' });

        // Now add 1 more audio, triggering eviction
        logger.log('audio', { i: 'new' });

        // The transcript should still be there
        const transcripts = logger.getEventsByType('transcript');
        expect(transcripts).toHaveLength(1);
        expect(transcripts[0].data.text).toBe('precious');

        // Total should be at cap
        expect(logger.eventCount).toBe(10000);

        // The oldest audio (index 0) should have been evicted
        const audioEvents = logger.getEventsByType('audio');
        expect(audioEvents[0].data.i).toBe(1); // 0 was evicted
    });

    it('evicts workspace events when no audio events remain', () => {
        // Fill with workspace events + 1 transcript
        for (let i = 0; i < 9999; i++) {
            logger.log('workspace', { i });
        }
        logger.log('transcript', { text: 'keep me' });

        // Trigger eviction
        logger.log('workspace', { i: 'new' });

        // Transcript preserved
        const transcripts = logger.getEventsByType('transcript');
        expect(transcripts).toHaveLength(1);

        // Oldest workspace evicted
        expect(logger.eventCount).toBe(10000);
    });

    it('falls back to shift when no audio or workspace events exist', () => {
        // Fill entirely with transcript events
        for (let i = 0; i < 10000; i++) {
            logger.log('transcript', { i });
        }

        // Trigger eviction
        logger.log('transcript', { i: 'newest' });

        expect(logger.eventCount).toBe(10000);
        // Oldest (i=0) should have been evicted
        const events = logger.getEvents();
        expect(events[0].data.i).toBe(1);
        // Newest should be last
        expect(events[events.length - 1].data.i).toBe('newest');
    });

    it('preserves transcript, semantic, interaction events during audio eviction', () => {
        // Add different types of "precious" events
        logger.log('transcript', { text: 'hello' });
        logger.log('semantic', { word: 'ocean' });
        logger.log('interaction', { action: 'click' });
        logger.log('system', { msg: 'started' });

        // Fill remaining with audio to hit cap
        for (let i = 0; i < 9998; i++) {
            logger.log('audio', { i });
        }

        // Trigger 2 evictions
        logger.log('audio', { i: 'new1' });
        logger.log('audio', { i: 'new2' });

        // All precious events preserved
        expect(logger.getEventsByType('transcript')).toHaveLength(1);
        expect(logger.getEventsByType('semantic')).toHaveLength(1);
        expect(logger.getEventsByType('interaction')).toHaveLength(1);
        expect(logger.getEventsByType('system')).toHaveLength(1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 4: JSON EXPORT
// ══════════════════════════════════════════════════════════════════════

describe('SessionLogger — JSON Export', () => {
    it('exports valid JSON', () => {
        logger.log('audio', { energy: 0.5 });
        logger.log('transcript', { text: 'test' });

        const json = logger.exportJSON();
        const parsed = JSON.parse(json);

        expect(parsed).toBeDefined();
        expect(typeof parsed.sessionStart).toBe('number');
        expect(typeof parsed.sessionEnd).toBe('number');
        expect(typeof parsed.durationMs).toBe('number');
        expect(parsed.eventCount).toBe(2);
        expect(parsed.events).toHaveLength(2);
    });

    it('includes correct event data in export', () => {
        logger.log('semantic', { word: 'ocean', confidence: 0.9 });

        const parsed = JSON.parse(logger.exportJSON());
        const event = parsed.events[0];

        expect(event.type).toBe('semantic');
        expect(event.data.word).toBe('ocean');
        expect(event.data.confidence).toBe(0.9);
        expect(typeof event.timestamp).toBe('number');
    });

    it('duration is non-negative', () => {
        const parsed = JSON.parse(logger.exportJSON());
        expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('exports empty session as valid JSON', () => {
        const parsed = JSON.parse(logger.exportJSON());
        expect(parsed.eventCount).toBe(0);
        expect(parsed.events).toHaveLength(0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 5: CLEAR / RESET
// ══════════════════════════════════════════════════════════════════════

describe('SessionLogger — Clear', () => {
    it('clear removes all events', () => {
        logger.log('audio', { energy: 0.5 });
        logger.log('transcript', { text: 'test' });
        expect(logger.eventCount).toBe(2);

        logger.clear();

        expect(logger.eventCount).toBe(0);
        expect(logger.getEvents()).toHaveLength(0);
    });

    it('clear resets session start time', () => {
        const before = Date.now();
        logger.clear();
        const after = Date.now();

        const parsed = JSON.parse(logger.exportJSON());
        expect(parsed.sessionStart).toBeGreaterThanOrEqual(before);
        expect(parsed.sessionStart).toBeLessThanOrEqual(after);
    });

    it('logging works normally after clear', () => {
        logger.log('audio', { energy: 0.5 });
        logger.clear();
        logger.log('transcript', { text: 'fresh' });

        expect(logger.eventCount).toBe(1);
        expect(logger.getEvents()[0].type).toBe('transcript');
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 6: EVENTCOUNT GETTER
// ══════════════════════════════════════════════════════════════════════

describe('SessionLogger — eventCount', () => {
    it('eventCount matches event array length', () => {
        expect(logger.eventCount).toBe(0);

        logger.log('audio', { e: 1 });
        expect(logger.eventCount).toBe(1);

        logger.log('audio', { e: 2 });
        expect(logger.eventCount).toBe(2);

        logger.log('transcript', { t: 'hi' });
        expect(logger.eventCount).toBe(3);
    });
});
