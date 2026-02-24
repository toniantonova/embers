import type { AudioFeatures } from '../services/AudioEngine';
import type { SemanticState } from '../services/KeywordClassifier';

export interface WorkspaceState {
    // Semantic
    coherence: number;              // 0-1, how close particles are to morph target
    entropy: number;                // 0-1, classifier uncertainty
    abstractionLevel: number;       // 0-1, current position on abstraction spectrum
    dominantConcept: string | null; // e.g., "horse"
    conceptConfidence: number;      // 0-1

    // Emotional
    emotionalValence: number;       // -1 to +1 (sentiment)
    arousal: number;                // 0-1, from audio energy + flux

    // Temporal
    timeSinceLastUtterance: number; // seconds
    breathingPhase: number;         // current phase of breathing sine wave
    morphTargetBlend: number;       // 1.0 = current target, 0.0 = default ring

    // Constants (configurable)
    idleTimeout: number;            // default 300 seconds (5 min)
}

export class WorkspaceEngine {
    private state: WorkspaceState;
    private stateLog: Record<string, unknown>[] = [];
    private lastLogTime: number = 0;

    // Internal state tracking
    private currentAbstraction: number = 1.0;
    private noiseAmplitude: number = 0.15;

    constructor() {
        this.state = {
            coherence: 0.0,
            entropy: 1.0,
            abstractionLevel: 1.0,
            dominantConcept: null,
            conceptConfidence: 0.0,
            emotionalValence: 0.0,
            arousal: 0.0,
            timeSinceLastUtterance: 0.0,
            breathingPhase: 0.0,
            morphTargetBlend: 1.0, // Start fully blended to whatever target is set
            idleTimeout: 300,
        };
    }

    /**
     * Call this when a new speech transcript arrives to restart the idle timer.
     */
    registerSpeech(): void {
        this.state.timeSinceLastUtterance = 0.0;
    }

    update(deltaTime: number, audioFeatures: AudioFeatures, semanticState: SemanticState | null): void {
        const now = performance.now();

        // 1. Track timeSinceLastUtterance
        this.state.timeSinceLastUtterance += deltaTime;

        // 2. Update breathingPhase
        this.state.breathingPhase += deltaTime * 0.2 * Math.PI * 2;
        // Keep it in a reasonable range to avoid precision loss over hours
        if (this.state.breathingPhase > Math.PI * 2) {
            this.state.breathingPhase -= Math.PI * 2;
        }

        // 3. Handle idle behavior
        if (this.state.timeSinceLastUtterance < this.state.idleTimeout) {
            // Not idle: hold current morph target (blend=1) and reset noise
            this.state.morphTargetBlend = 1.0;
            this.noiseAmplitude = 0.15;
        } else {
            // Idle: blend morph target toward ring (blend=0) over 10 seconds
            // 10 seconds means morphTargetBlend goes down by 0.1 per second
            this.state.morphTargetBlend = Math.max(0.0, this.state.morphTargetBlend - deltaTime * 0.1);
            this.noiseAmplitude = 0.15 + (1.0 - this.state.morphTargetBlend) * 0.05; // Slightly more noise when idle
        }

        // 4. Compute arousal based on audio features
        this.state.arousal = Math.max(0, Math.min(1, (audioFeatures.energy + audioFeatures.urgency) / 2));

        // 5. Semantic tracking and smoothing
        const targetAbstraction = semanticState ? semanticState.abstractionLevel : 1.0;

        // Smooth abstraction level
        const lerpFactor = Math.min(1.0, deltaTime * 2.0);
        this.currentAbstraction = this.currentAbstraction + (targetAbstraction - this.currentAbstraction) * lerpFactor;
        this.state.abstractionLevel = this.currentAbstraction;

        // 6. Compute COHERENCE metric proxy
        // High coherence = low abstraction and low noise
        this.state.coherence = Math.max(0, Math.min(1, (1.0 - this.currentAbstraction) * (1.0 - this.noiseAmplitude * 0.5)));

        // 7. Compute ENTROPY metric
        if (semanticState) {
            this.state.entropy = Math.max(0, Math.min(1, 1.0 - semanticState.confidence));
            this.state.dominantConcept = semanticState.dominantWord || null;
            this.state.conceptConfidence = semanticState.confidence;
            this.state.emotionalValence = semanticState.sentiment;
        } else {
            this.state.entropy = 1.0;
            this.state.dominantConcept = null;
            this.state.conceptConfidence = 0.0;
            this.state.emotionalValence = 0.0;
        }

        // 8. Emit state snapshot every 100ms
        if (now - this.lastLogTime >= 100) {
            this.lastLogTime = now;
            this.stateLog.push({ timestamp: Date.now(), ...this.state });

            // Optional: avoid unbounded memory growth in long sessions
            if (this.stateLog.length > 5000) {
                this.stateLog.shift();
            }
        }
    }

    getState(): WorkspaceState {
        return { ...this.state };
    }

    // Allow external access to current noiseAmplitude if necessary
    getNoiseAmplitude(): number {
        return this.noiseAmplitude;
    }
}
