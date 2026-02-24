/**
 * SemanticBackend — Speech → Classification → Morph pipeline orchestrator.
 * Uses frame-driven queued transcripts to avoid race conditions.
 */

import { SpeechEngine } from './SpeechEngine';
import type { TranscriptEvent } from './SpeechEngine';
import { KeywordClassifier } from './KeywordClassifier';
import type { SemanticState } from './KeywordClassifier';
import type { KeywordMapping } from '../data/keywords';
import { ParticleSystem } from '../engine/ParticleSystem';
import { UniformBridge } from '../engine/UniformBridge';
import { ServerShapeAdapter } from '../engine/ServerShapeAdapter';
import type { ServerClient } from './ServerClient';
import type { SessionLogger } from './SessionLogger';
import type { AudioEngine } from './AudioEngine';
import type { TuningConfig } from './TuningConfig';

// Every semantic decision is logged for session replay / debugging
export interface SemanticEvent {
    timestamp: number;
    text: string;
    classification: SemanticState;
    action: 'morph' | 'hold' | 'loosen';
}

const ABSTRACTION_LERP_RATE = 2.0;
const SILENCE_RESET_THRESHOLD = 300;
const LOOSEN_DURATION = 0.3;
const LOOSEN_NOISE = 0.3;
const LOOSEN_SILENCE_GATE = 2.0;
const FINAL_CONFIDENCE_THRESHOLD = 0.3;
const ABSTRACTION_DRIFT_RATE = 0.05;
const DEFAULT_SHAPE = 'ring';

const HIERARCHY_STAGE_DELAYS = [0.0, 0.5, 1.5];
const HIERARCHY_ABSTRACTIONS = [0.9, 0.5];

export const TransitionPhase = {
    Idle: 0,
    Dissolve: 1,
    Reform: 2,
    Settle: 3,
} as const;
export type TransitionPhase = (typeof TransitionPhase)[keyof typeof TransitionPhase];

const BASE_DISSOLVE_DURATION = 0.3;
const BASE_REFORM_DURATION = 0.7;
const BASE_SETTLE_DURATION = 0.5;

const DISSOLVE_SPRING = 0.4;
const DISSOLVE_NOISE = 0.6;
const REFORM_SPRING_START = 0.8;
const REFORM_SPRING_END = 1.5;
const REFORM_NOISE = 0.35;
const SETTLE_SPRING_OVERSHOOT = 2.0;
const SETTLE_SPRING_FINAL = 1.5;
const SETTLE_NOISE = 0.15;

const IDLE_DECAY_DURATION = 30.0;

export class SemanticBackend {
    private speechEngine: SpeechEngine;
    private classifier: KeywordClassifier;
    private particleSystem: ParticleSystem;
    private uniformBridge: UniformBridge;
    private sessionLogger: SessionLogger | null;
    private serverClient: ServerClient | null;
    private audioEngine: AudioEngine | null;
    private tuningConfig: TuningConfig | null;

    private currentTarget: string = DEFAULT_SHAPE;
    private currentAbstraction: number = 0.5;
    private targetAbstraction: number = 0.5;
    private timeSinceLastUtterance: number = 0;
    private isLoosening: boolean = false;
    private loosenTimer: number = 0;
    private pendingFullText: string | null = null;

    private pendingTranscripts: TranscriptEvent[] = [];
    private unsubscribe: (() => void) | null = null;
    private eventLog: SemanticEvent[] = [];

    private _lastState: SemanticState | null = null;
    private _lastAction: string = '';

    private hierarchyActive: boolean = false;
    private hierarchyElapsed: number = 0;
    private hierarchyStageIndex: number = 0;
    private hierarchyMapping: KeywordMapping | null = null;
    private hierarchyFinalAbstraction: number = 0.5;
    private _hierarchyLabel: string = '';

    private transitionPhase: TransitionPhase = TransitionPhase.Idle;
    private transitionElapsed: number = 0;
    private transitionDurations: [number, number, number] = [
        BASE_DISSOLVE_DURATION, BASE_REFORM_DURATION, BASE_SETTLE_DURATION
    ];
    private pendingMorphState: SemanticState | null = null;
    private pendingMorphMapping: KeywordMapping | null = null;

    private idleDecayActive: boolean = false;
    private idleDecayElapsed: number = 0;
    private idleDecayStartAbstraction: number = 0.5;

    constructor(
        speechEngine: SpeechEngine,
        classifier: KeywordClassifier,
        particleSystem: ParticleSystem,
        uniformBridge: UniformBridge,
        sessionLogger?: SessionLogger | null,
        serverClient?: ServerClient | null,
        audioEngine?: AudioEngine | null,
        tuningConfig?: TuningConfig | null,
    ) {
        this.speechEngine = speechEngine;
        this.classifier = classifier;
        this.particleSystem = particleSystem;
        this.uniformBridge = uniformBridge;
        this.sessionLogger = sessionLogger || null;
        this.serverClient = serverClient || null;
        this.audioEngine = audioEngine || null;
        this.tuningConfig = tuningConfig || null;

        this.unsubscribe = this.speechEngine.onTranscript(
            (event) => this.pendingTranscripts.push(event)
        );

        const mode = this.tuningConfig?.complexMode ? 'complex' : 'simple';
        console.log(
            `[SemanticBackend] Wired: Speech → Classification → Morph (mode: ${mode})` +
            (this.serverClient ? ' | Server shapes: ✅ enabled' : ' | Server shapes: ❌ disabled (no ServerClient)')
        );
    }

    update(dt: number): void {
        const pending = this.pendingTranscripts;
        this.pendingTranscripts = [];
        for (const event of pending) {
            this.processTranscript(event);
        }

        this.timeSinceLastUtterance += dt;

        if (this.timeSinceLastUtterance > SILENCE_RESET_THRESHOLD && this.currentTarget !== DEFAULT_SHAPE && !this.idleDecayActive) {
            console.log('[SemanticBackend] 5-min silence — starting 30s gradual decay to ring');
            this.idleDecayActive = true;
            this.idleDecayElapsed = 0;
            this.idleDecayStartAbstraction = this.currentAbstraction;
            this.logEvent('', this.makeDefaultState(), 'hold');
        }

        if (this.idleDecayActive) {
            this.idleDecayElapsed += dt;
            const progress = Math.min(1.0, this.idleDecayElapsed / IDLE_DECAY_DURATION);
            const eased = 1 - Math.pow(1 - progress, 2); // Ease-out

            this.targetAbstraction = this.idleDecayStartAbstraction + (1.0 - this.idleDecayStartAbstraction) * eased;
            this.uniformBridge.springOverride = 1.5 - eased * 0.8;

            if (progress >= 1.0) {
                this.currentTarget = DEFAULT_SHAPE;
                this.particleSystem.setTarget(DEFAULT_SHAPE);
                this.idleDecayActive = false;
                this.uniformBridge.springOverride = null;
                console.log('[SemanticBackend] Idle decay complete — now ring');
            }
        }

        const absDiff = this.targetAbstraction - this.currentAbstraction;
        this.currentAbstraction += absDiff * Math.min(1.0, ABSTRACTION_LERP_RATE * dt);
        this.uniformBridge.abstractionOverride = this.currentAbstraction;

        if (this.isLoosening) {
            this.loosenTimer -= dt;
            this.uniformBridge.noiseOverride = LOOSEN_NOISE;

            if (this.loosenTimer <= 0) {
                this.isLoosening = false;
                this.uniformBridge.noiseOverride = null;
                console.log('[SemanticBackend] Loosening complete');
            }
        }

        this.tickTransition(dt);

        if (this.hierarchyActive && this.hierarchyMapping) {
            this.hierarchyElapsed += dt;

            while (
                this.hierarchyStageIndex < 3 &&
                this.hierarchyElapsed >= HIERARCHY_STAGE_DELAYS[this.hierarchyStageIndex]
            ) {
                const stage = this.hierarchyStageIndex;
                const mapping = this.hierarchyMapping;

                const stageTarget = mapping.hierarchy[stage];
                if (stageTarget !== this.currentTarget) {
                    this.currentTarget = stageTarget;
                    this.particleSystem.setTarget(stageTarget);
                    console.log(
                        `[SemanticBackend] \u2728 Hierarchy stage ${stage}: ${stageTarget} ` +
                        `(label="${mapping.hierarchyLabels[stage]}")`
                    );
                }

                if (stage < 2) {
                    this.targetAbstraction = HIERARCHY_ABSTRACTIONS[stage];
                } else {
                    this.targetAbstraction = this.hierarchyFinalAbstraction;
                }

                this._hierarchyLabel = mapping.hierarchyLabels[stage];
                this.hierarchyStageIndex++;
            }

            if (this.hierarchyStageIndex >= 3) {
                this.hierarchyActive = false;
            }
        }
    }

    getEventLog(): ReadonlyArray<SemanticEvent> {
        return this.eventLog;
    }

    get lastState(): SemanticState | null {
        return this._lastState;
    }

    get lastAction(): string {
        return this._lastAction;
    }

    get abstraction(): number {
        return this.currentAbstraction;
    }

    get hierarchyLabel(): string {
        return this._hierarchyLabel;
    }

    dispose(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.pendingTranscripts = [];
        this.pendingFullText = null;
        this.uniformBridge.abstractionOverride = null;
        this.uniformBridge.noiseOverride = null;
        this.uniformBridge.sentimentOverride = null;
        this.uniformBridge.emotionalIntensityOverride = null;
        this.uniformBridge.springOverride = null;
        this.transitionPhase = TransitionPhase.Idle;
        this.transitionElapsed = 0;
        this.pendingMorphState = null;
        this.pendingMorphMapping = null;
        this.idleDecayActive = false;
        console.log('[SemanticBackend] Disposed');
    }

    private processTranscript(event: TranscriptEvent): void {
        if (this.timeSinceLastUtterance > LOOSEN_SILENCE_GATE) {
            this.isLoosening = true;
            this.loosenTimer = LOOSEN_DURATION;
            this.uniformBridge.noiseOverride = LOOSEN_NOISE;
            console.log('[SemanticBackend] 🌊 Loosening — speech after silence');
            this.logEvent(event.text, this.makeDefaultState(), 'loosen');
        }

        this.timeSinceLastUtterance = 0;
        this.sessionLogger?.log('transcript', { text: event.text, isFinal: event.isFinal });

        if (!event.isFinal) return;

        const isComplex = this.tuningConfig?.complexMode ?? false;

        if (isComplex && this.serverClient) {
            this.applyMorphFromPhrase(event.text);
        } else {
            if (isComplex && !this.serverClient) {
                console.warn(
                    '[SemanticBackend] ⚠️ Complex mode active but no ServerClient — ' +
                    'falling back to Simple mode classification'
                );
            }

            const state = this.classifier.classify(event.text);

            if (state.confidence > FINAL_CONFIDENCE_THRESHOLD) {
                this.applyMorph(state, event.text);
            } else {
                this.targetAbstraction = Math.min(1.0,
                    this.targetAbstraction + ABSTRACTION_DRIFT_RATE
                );

                this._lastState = state;
                this._lastAction = 'hold';

                if (Math.abs(state.sentiment) > 0.05) {
                    this.uniformBridge.sentimentOverride = state.sentiment;
                    this.uniformBridge.emotionalIntensityOverride = state.emotionalIntensity;
                }

                this.logEvent(event.text, state, 'hold');
                console.log(
                    `[SemanticBackend] HOLD — no keyword (confidence=${state.confidence.toFixed(2)})`
                );
            }
        }
    }

    private applyMorphFromPhrase(fullText: string): void {
        const trimmed = fullText.trim();
        if (!trimmed) {
            console.warn('[SemanticBackend] ⚠️ Skipping empty phrase in Complex mode');
            return;
        }

        const sentimentResult = this.classifier.classifySentimentOnly(trimmed);
        this.pendingFullText = trimmed;

        if (this.idleDecayActive) {
            this.idleDecayActive = false;
            this.uniformBridge.springOverride = null;
        }

        const words = trimmed.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
        let placeholderWord = '';
        for (const word of words) {
            const mapping = this.classifier.lookupKeyword(word);
            if (mapping) {
                placeholderWord = word;
                break;
            }
        }

        this.pendingMorphState = {
            morphTarget: this.particleSystem.currentTarget,
            abstractionLevel: 0.3,
            sentiment: sentimentResult.sentiment,
            emotionalIntensity: sentimentResult.emotionalIntensity,
            dominantWord: placeholderWord || trimmed.split(/\s+/)[0] || '',
            confidence: 1.0,
        };
        this.pendingMorphMapping = null;

        this.transitionPhase = TransitionPhase.Idle;
        this.transitionElapsed = 0;

        this.uniformBridge.springOverride = 2.0;
        this.uniformBridge.noiseOverride = 0.15;

        if (this.serverClient && this.pendingFullText) {
            const dominantWord = this.pendingMorphState?.dominantWord || trimmed.split(/\s+/)[0];
            console.log(
                `[SemanticBackend] 🌐 COMPLEX → server for "${this.pendingFullText}" (immediate)`,
            );
            this.requestServerShape(dominantWord, this.pendingFullText, this.particleSystem.currentTarget);
            this.pendingFullText = null;
        }

        this._lastState = this.pendingMorphState;
        this._lastAction = 'morph';

        this.uniformBridge.sentimentOverride = sentimentResult.sentiment;
        this.uniformBridge.emotionalIntensityOverride = sentimentResult.emotionalIntensity;

        this.logEvent(fullText, this.pendingMorphState, 'morph');

        // Log semantic event
        this.sessionLogger?.log('semantic', {
            dominantWord: this.pendingMorphState.dominantWord,
            morphTarget: this.pendingMorphState.morphTarget,
            abstractionLevel: this.pendingMorphState.abstractionLevel,
            sentiment: sentimentResult.sentiment,
            confidence: this.pendingMorphState.confidence,
            mode: 'complex',
            fullText,
        });

        console.log(
            `[SemanticBackend] 🧠 COMPLEX MODE — "${fullText}" → server (placeholder: ${this.pendingMorphState.morphTarget})`
        );
    }

    private applyMorph(state: SemanticState, text: string): void {
        this.pendingMorphState = state;
        this.pendingMorphMapping = this.classifier.lookupKeyword(state.dominantWord);

        if (this.idleDecayActive) {
            this.idleDecayActive = false;
            this.uniformBridge.springOverride = null;
        }

        this.computeTransitionDurations();

        this.transitionPhase = TransitionPhase.Dissolve;
        this.transitionElapsed = 0;

        this.uniformBridge.springOverride = DISSOLVE_SPRING;
        if (!this.isLoosening) {
            this.uniformBridge.noiseOverride = DISSOLVE_NOISE;
        }

        this._lastState = state;
        this._lastAction = 'morph';

        this.uniformBridge.sentimentOverride = state.sentiment;
        this.uniformBridge.emotionalIntensityOverride = state.emotionalIntensity;
        this.logEvent(text, state, 'morph');

        // Log semantic event
        this.sessionLogger?.log('semantic', {
            dominantWord: state.dominantWord,
            morphTarget: state.morphTarget,
            abstractionLevel: state.abstractionLevel,
            sentiment: state.sentiment,
            confidence: state.confidence,
        });
    }

    private tickTransition(dt: number): void {
        if (this.transitionPhase === TransitionPhase.Idle) return;

        this.transitionElapsed += dt;

        switch (this.transitionPhase) {
            case TransitionPhase.Dissolve:
                this.tickDissolve();
                break;
            case TransitionPhase.Reform:
                this.tickReform();
                break;
            case TransitionPhase.Settle:
                this.tickSettle();
                break;
        }
    }

    private tickDissolve(): void {
        const duration = this.transitionDurations[0];
        if (this.transitionElapsed >= duration) {
            this.executeMorphSwap();

            this.transitionPhase = TransitionPhase.Reform;
            this.transitionElapsed = 0;
            this.uniformBridge.springOverride = REFORM_SPRING_START;
            this.uniformBridge.noiseOverride = REFORM_NOISE;

            console.log('[SemanticBackend] Transition: Dissolve → Reform');
        }
    }

    private tickReform(): void {
        const duration = this.transitionDurations[1];
        const progress = Math.min(1.0, this.transitionElapsed / duration);

        this.uniformBridge.springOverride = REFORM_SPRING_START + (REFORM_SPRING_END - REFORM_SPRING_START) * progress;

        const reformNoise = REFORM_NOISE * (1.0 - progress * 0.5);
        this.uniformBridge.noiseOverride = reformNoise;

        if (this.transitionElapsed >= duration) {
            this.transitionPhase = TransitionPhase.Settle;
            this.transitionElapsed = 0;
            this.uniformBridge.springOverride = SETTLE_SPRING_OVERSHOOT;
            this.uniformBridge.noiseOverride = SETTLE_NOISE;

            console.log('[SemanticBackend] Transition: Reform → Settle');
        }
    }

    private tickSettle(): void {
        const duration = this.transitionDurations[2];
        const progress = Math.min(1.0, this.transitionElapsed / duration);

        this.uniformBridge.springOverride = SETTLE_SPRING_OVERSHOOT + (SETTLE_SPRING_FINAL - SETTLE_SPRING_OVERSHOOT) * progress;

        const settleNoise = SETTLE_NOISE * (1.0 - progress);
        this.uniformBridge.noiseOverride = settleNoise > 0.01 ? settleNoise : null;

        if (this.transitionElapsed >= duration) {
            this.transitionPhase = TransitionPhase.Idle;
            this.uniformBridge.springOverride = null;
            this.uniformBridge.noiseOverride = null;

            console.log('[SemanticBackend] Transition: Settle → Idle');
        }
    }

    private executeMorphSwap(): void {
        const state = this.pendingMorphState;
        if (!state) return;
        const mapping = this.pendingMorphMapping;

        if (mapping) {
            this.hierarchyActive = true;
            this.hierarchyElapsed = 0;
            this.hierarchyStageIndex = 0;
            this.hierarchyMapping = mapping;
            this.hierarchyFinalAbstraction = state.abstractionLevel;
            this._hierarchyLabel = mapping.hierarchyLabels[0];

            if (state.emotionalIntensity > 0.5) {
                this.hierarchyFinalAbstraction = Math.max(0.0,
                    this.hierarchyFinalAbstraction - (state.emotionalIntensity - 0.5) * 0.3
                );
            }

            console.log(
                `[SemanticBackend] 🎯 HIERARCHY START → "${state.morphTarget}" ` +
                `(word="${state.dominantWord}", stages=${mapping.hierarchy.join('→')})`
            );
        } else {
            if (this.particleSystem.morphTargets.hasTarget(state.morphTarget)) {
                if (state.morphTarget !== this.currentTarget) {
                    this.currentTarget = state.morphTarget;
                    this.particleSystem.setTarget(state.morphTarget);
                }
            }

            this.targetAbstraction = state.abstractionLevel;

            if (state.emotionalIntensity > 0.5) {
                this.targetAbstraction = Math.max(0.0,
                    this.targetAbstraction - (state.emotionalIntensity - 0.5) * 0.3
                );
            }
        }

        const isComplex = this.tuningConfig?.complexMode ?? false;

        if (isComplex && this.serverClient && this.pendingFullText) {
            console.log(
                `[SemanticBackend] 🌐 COMPLEX → server for "${this.pendingFullText}" ` +
                `(placeholder: ${state.morphTarget})`
            );
            this.requestServerShape(state.dominantWord, this.pendingFullText, state.morphTarget);
            this.pendingFullText = null;
        } else if (!mapping && !this.particleSystem.morphTargets.hasTarget(state.morphTarget) && this.serverClient) {
            console.log(`[SemanticBackend] 🌐 Novel noun "${state.dominantWord}" → requesting server shape`);
            this.requestServerShape(state.dominantWord, state.dominantWord, state.morphTarget);
        }
    }

    private requestServerShape(word: string, prompt: string, fallbackTarget: string): void {
        if (!this.serverClient) return;

        // Log the request
        this.sessionLogger?.log('system', {
            event: 'server_request',
            noun: word,
            prompt,
            timestamp: Date.now(),
        });

        console.log(`[SemanticBackend] 🌐 Requesting server shape: prompt="${prompt}"`);

        this.serverClient.generateShape(prompt).then((response) => {
            if (response) {
                // Read scale at response time (not request time) so live
                // tuner changes during the async server call are respected.
                const shapeScale = this.tuningConfig?.get('serverShapeScale') ?? 1.5;

                // Success — convert to DataTexture with TuningConfig scale
                const texture = ServerShapeAdapter.toDataTexture(
                    response,
                    this.particleSystem.size,
                    shapeScale,
                );
                this.particleSystem.setTargetTexture(texture, word);
                this.currentTarget = word;

                // Cancel hierarchy placeholder traversal — the real
                // server shape has landed. Without this, hierarchy stage 2/3
                // would overwrite the server shape ~1.5s later.
                if (this.hierarchyActive) {
                    this.hierarchyActive = false;
                    console.log('[SemanticBackend] Hierarchy cancelled — server shape arrived');
                }

                // Restore physics from "thinking" loosening —
                // clear spring/noise overrides so particles snap firmly
                // to the new server shape using the config baseline.
                this.uniformBridge.springOverride = null;
                this.uniformBridge.noiseOverride = null;

                console.log(
                    `[SemanticBackend] ✅ Server shape received: prompt="${prompt}" ` +
                    `(${response.pipeline}, ${response.generationTimeMs}ms, ` +
                    `${response.partNames.length} parts, scale=${shapeScale})`,
                );

                // Log the response
                this.sessionLogger?.log('system', {
                    event: 'server_response',
                    noun: word,
                    prompt,
                    cached: response.cached,
                    pipeline: response.pipeline,
                    generationTimeMs: response.generationTimeMs,
                    partCount: response.partNames.length,
                    templateType: response.templateType,
                });
            } else {
                // Failed — fall back to closest local shape
                console.warn(
                    `[SemanticBackend] ⚠️ Server failed for prompt="${prompt}", ` +
                    `falling back to "${fallbackTarget}"`,
                );
                if (fallbackTarget !== this.currentTarget) {
                    this.currentTarget = fallbackTarget;
                    this.particleSystem.setTarget(fallbackTarget);
                }
            }
        });
    }

    private makeDefaultState(): SemanticState {
        return {
            morphTarget: this.currentTarget,
            abstractionLevel: this.targetAbstraction,
            sentiment: 0,
            emotionalIntensity: 0,
            dominantWord: '',
            confidence: 0,
        };
    }

    private logEvent(text: string, classification: SemanticState, action: SemanticEvent['action']): void {
        this.eventLog.push({
            timestamp: Date.now(),
            text,
            classification,
            action,
        });
    }

    private computeTransitionDurations(): void {
        let energyScale = 1.0;
        if (this.audioEngine) {
            const energy = this.audioEngine.getFeatures().energy;
            // lerp(1.5, 0.5, energy): low energy → 1.5x (slow), high energy → 0.5x (fast)
            energyScale = 1.5 - energy * 1.0;
        }

        this.transitionDurations = [
            BASE_DISSOLVE_DURATION * energyScale,
            BASE_REFORM_DURATION * energyScale,
            BASE_SETTLE_DURATION * energyScale,
        ];
    }

    get currentTransitionPhase(): TransitionPhase {
        return this.transitionPhase;
    }

    getTransitionDurations(): [number, number, number] {
        return [...this.transitionDurations] as [number, number, number];
    }

    get isIdleDecayActive(): boolean {
        return this.idleDecayActive;
    }
}
