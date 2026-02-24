/**
 * SessionLogger — Records timestamped events for post-hoc session analysis.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Collects audio snapshots, transcript events, semantic classifications,
 * workspace state, interaction events, and system events into a single
 * time-ordered buffer. The buffer can be exported as JSON for charting
 * (coherence over time, entropy over time, etc.) on a research page.
 *
 * PERFORMANCE:
 * ────────────
 * Audio events fire at 5/sec (200ms interval), workspace at 2/sec (500ms).
 * A 10-minute session ≈ 3,000 audio + 1,200 workspace + sparse others.
 * Hard cap at 10,000 events; when exceeded, oldest audio events are
 * evicted first to preserve all transcript/semantic/interaction records.
 */

// ── TYPES ───────────────────────────────────────────────────────────
export type EventType =
    | 'audio'
    | 'transcript'
    | 'semantic'
    | 'workspace'
    | 'interaction'
    | 'system'
    | 'server_request'
    | 'server_response'
    | 'pipeline_phase';

export interface SessionEvent {
    timestamp: number;   // Date.now()
    type: EventType;
    data: Record<string, unknown>;
}

// ── CONSTANTS ───────────────────────────────────────────────────────
const MAX_EVENTS = 10_000;

// ── SERVICE ─────────────────────────────────────────────────────────
export class SessionLogger {
    private events: SessionEvent[] = [];
    private sessionStart: number = Date.now();

    // ── LOGGING ──────────────────────────────────────────────────────

    /**
     * Record an event. Automatically timestamps and enforces the buffer cap.
     */
    log(type: EventType, data: Record<string, unknown>): void {
        this.events.push({
            timestamp: Date.now(),
            type,
            data,
        });

        // Enforce cap — evict oldest audio events first
        while (this.events.length > MAX_EVENTS) {
            this.evictOldest();
        }
    }

    // ── QUERY ────────────────────────────────────────────────────────

    /**
     * Return all recorded events.
     */
    getEvents(): ReadonlyArray<SessionEvent> {
        return this.events;
    }

    /**
     * Return events filtered by type.
     */
    getEventsByType(type: EventType): SessionEvent[] {
        return this.events.filter(e => e.type === type);
    }

    /**
     * Return event count (useful for UI display).
     */
    get eventCount(): number {
        return this.events.length;
    }

    // ── EXPORT ───────────────────────────────────────────────────────

    /**
     * Serialize the full session as a JSON string.
     */
    exportJSON(): string {
        return JSON.stringify({
            sessionStart: this.sessionStart,
            sessionEnd: Date.now(),
            durationMs: Date.now() - this.sessionStart,
            eventCount: this.events.length,
            events: this.events,
        }, null, 2);
    }

    /**
     * Trigger a browser file download of the session JSON.
     */
    downloadJSON(): void {
        const json = this.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const filename = `session_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`[SessionLogger] Downloaded ${filename} (${this.events.length} events)`);
    }

    // ── RESET ────────────────────────────────────────────────────────

    /**
     * Clear all events and reset session start time.
     */
    clear(): void {
        this.events = [];
        this.sessionStart = Date.now();
        console.log('[SessionLogger] Session cleared');
    }

    // ── PRIVATE ──────────────────────────────────────────────────────

    /**
     * Evict oldest audio events to stay under MAX_EVENTS.
     * Preserves all transcript, semantic, interaction, and system events.
     */
    private evictOldest(): void {
        // Find the index of the oldest audio event
        const audioIdx = this.events.findIndex(e => e.type === 'audio');
        if (audioIdx !== -1) {
            this.events.splice(audioIdx, 1);
        } else {
            // No audio events left to evict — drop oldest workspace
            const wsIdx = this.events.findIndex(e => e.type === 'workspace');
            if (wsIdx !== -1) {
                this.events.splice(wsIdx, 1);
            } else {
                // Last resort: drop oldest of any type
                this.events.shift();
            }
        }
    }
}
