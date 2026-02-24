/**
 * SERManager — Manages the Speech Emotion Recognition Web Worker.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Bridges the AudioEngine (which has the mic stream) and the SER Worker
 * (which runs wav2vec2 inference). It:
 *   1. Creates a ScriptProcessorNode to tap raw PCM audio from the mic
 *   2. Buffers 2 seconds of samples
 *   3. Sends the buffer to the SER worker for inference
 *   4. Receives emotion results and forwards them to UniformBridge
 *
 * LIFECYCLE:
 * ──────────
 * - Call start() AFTER AudioEngine.start() has been called (needs audioContext)
 * - Call stop() when the app is torn down
 * - The worker loads the ONNX model asynchronously (WebGPU → WASM fallback)
 *
 * STATUS LOGGING:
 * ───────────────
 * Logs to console so you can see if the SER channel is alive or dead:
 *   [SER Manager] ✅ Worker ready        — model loaded, inference will run
 *   [SER Manager] ⚠ Worker failed       — model couldn't load, text sentiment only
 *   [SER Manager] 🎭 angry (conf=0.82)  — latest emotion classification
 */

import type { AudioEngine } from '../services/AudioEngine';
import type { UniformBridge } from '../engine/UniformBridge';
import type { SERWorkerResponse } from './types';

const CHUNK_DURATION_S = 2.0;   // Send audio every 2 seconds
const BUFFER_SIZE = 4096;       // ScriptProcessorNode buffer size

export class SERManager {
    private worker: Worker | null = null;
    private scriptNode: ScriptProcessorNode | null = null;
    private audioBuffer: Float32Array[] = [];
    private samplesCollected = 0;
    private sampleRate = 44100;
    private isReady = false;
    private isAlive = false;

    private audioEngine: AudioEngine;
    private uniformBridge: UniformBridge;

    // Diagnostic: track last emotion for console logging
    private logCounter = 0;
    private readonly LOG_INTERVAL = 5; // Log every 5th result (~10 seconds)

    constructor(audioEngine: AudioEngine, uniformBridge: UniformBridge) {
        this.audioEngine = audioEngine;
        this.uniformBridge = uniformBridge;
    }

    /**
     * Start the SER pipeline. Call after AudioEngine.start().
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    start(): void {
        if (this.isAlive) return;
        this.isAlive = true;

        const ctx = this.audioEngine.audioContext;
        const source = this.audioEngine.source;

        if (!ctx || !source) {
            console.warn('[SER Manager] AudioEngine not started yet — deferring SER worker init');
            this.isAlive = false;
            return;
        }

        this.sampleRate = ctx.sampleRate;

        // ── CREATE WORKER ────────────────────────────────────────────
        try {
            this.worker = new Worker(
                new URL('./ser-worker.ts', import.meta.url),
                { type: 'module' }
            );

            this.worker.onmessage = (event: MessageEvent<SERWorkerResponse>) => {
                this.handleWorkerMessage(event.data);
            };

            this.worker.onerror = (err) => {
                console.error('[SER Manager] Worker runtime error:', err);
            };

            // Tell the worker to load the model
            this.worker.postMessage({ type: 'init' });
            console.log('[SER Manager] Worker created, loading model...');
        } catch (err) {
            console.warn('[SER Manager] Failed to create worker:', err);
            this.isAlive = false;
            return;
        }

        // ── TAP AUDIO STREAM ─────────────────────────────────────────
        // ScriptProcessorNode is deprecated but still widely supported.
        // AudioWorklet would be cleaner but adds complexity for a 2s buffer.
        this.scriptNode = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        this.scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
            if (!this.isReady) return;

            const input = e.inputBuffer.getChannelData(0);
            // Copy the samples (the input buffer is reused by the browser)
            this.audioBuffer.push(new Float32Array(input));
            this.samplesCollected += input.length;

            // When we have 2 seconds worth, send to worker
            const targetSamples = this.sampleRate * CHUNK_DURATION_S;
            if (this.samplesCollected >= targetSamples) {
                this.sendChunk();
            }
        };

        // Connect: source → scriptNode → destination (required to keep it alive)
        source.connect(this.scriptNode);
        this.scriptNode.connect(ctx.destination);
    }

    /**
     * Stop the SER pipeline and clean up.
     */
    stop(): void {
        this.isAlive = false;
        this.isReady = false;

        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }

        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }

        this.audioBuffer = [];
        this.samplesCollected = 0;
        console.log('[SER Manager] Stopped');
    }

    /** Whether the SER model has loaded and is actively classifying. */
    get active(): boolean {
        return this.isReady && this.isAlive;
    }

    // ── PRIVATE ──────────────────────────────────────────────────────

    private sendChunk(): void {
        if (!this.worker || !this.isReady) return;

        // Concatenate buffered chunks into a single Float32Array
        const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of this.audioBuffer) {
            combined.set(buf, offset);
            offset += buf.length;
        }

        // Send to worker (transferring the buffer for zero-copy)
        this.worker.postMessage(
            { type: 'process', audioData: combined, sampleRate: this.sampleRate },
            [combined.buffer]
        );

        // Reset buffer
        this.audioBuffer = [];
        this.samplesCollected = 0;
    }

    private handleWorkerMessage(msg: SERWorkerResponse): void {
        switch (msg.type) {
            case 'ready':
                this.isReady = true;
                console.log('[SER Manager] ✅ Worker ready — emotion detection active');
                break;

            case 'result':
                if (msg.emotion) {
                    this.uniformBridge.setEmotionState(msg.emotion);

                    // Periodic diagnostic logging
                    this.logCounter++;
                    if (this.logCounter >= this.LOG_INTERVAL) {
                        this.logCounter = 0;
                        const e = msg.emotion;
                        console.log(
                            `[SER Manager] 🎭 V:${e.valence.toFixed(2)} A:${e.arousal.toFixed(2)} ` +
                            `D:${e.dominance.toFixed(2)} conf:${e.confidence.toFixed(2)}`
                        );
                    }
                }
                break;

            case 'error':
                console.warn(`[SER Manager] ⚠ ${msg.error}`);
                console.warn('[SER Manager] Prosodic emotion unavailable — text sentiment will drive movement');
                break;
        }
    }
}
