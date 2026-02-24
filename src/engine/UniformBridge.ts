import { AudioEngine } from '../services/AudioEngine';
import { ParticleSystem } from './ParticleSystem';
import { TuningConfig } from '../services/TuningConfig';
import * as THREE from 'three';
import { WorkspaceEngine } from './WorkspaceEngine';
import type { EmotionState } from '../audio/types';
import { NEUTRAL_EMOTION } from '../audio/types';

/**
 * UniformBridge — Connects audio analysis to particle visuals.
 *
 * This class is the "translator" between the AudioEngine (which produces
 * abstract feature values like energy, tension, etc.) and the ParticleSystem
 * (which needs specific shader uniform values to control particle behavior).
 *
 * The bridge runs every frame in the animation loop. It:
 * 1. Reads the latest audio features from AudioEngine
 * 2. Applies influence multipliers from TuningConfig (so each feature
 *    can be boosted, attenuated, or muted from the tuning panel)
 * 3. Clamps all values to safe [0, 1] ranges (defensive programming)
 * 4. Writes them into the velocity shader uniforms
 * 5. Derives visual properties like color from the features
 */
export type ColorMode = 'white' | 'color';

export class UniformBridge {
    audioEngine: AudioEngine;
    particleSystem: ParticleSystem;

    // TuningConfig reference — used to read influence multipliers.
    // These multipliers let the tuning panel control how much each
    // audio feature affects the particle visuals.
    private config: TuningConfig;

    // Color mode — controls whether particles are white (with subtle tension
    // tint) or sentiment-driven monotone coloring. Set from TuningPanel via Canvas.
    colorMode: ColorMode = 'white';

    // Idle mode — when true, all audio features are zeroed and
    // particles return to a calm baseline state (shape, speed 1, white).
    idleMode = false;

    // SemanticBackend sets these to inject abstraction/noise/sentiment
    // values into the shader pipeline. When non-null, they override
    // the values that would normally come from TuningConfig.
    abstractionOverride: number | null = null;
    noiseOverride: number | null = null;
    sentimentOverride: number | null = null;
    emotionalIntensityOverride: number | null = null;

    // ── TRANSITION CHOREOGRAPHY (S12) ────────────────────────────
    // SemanticBackend sets this during dissolve→reform→settle phases.
    springOverride: number | null = null;

    // WorkspaceEngine reference exposes system's cognitive state metrics
    workspaceEngine: WorkspaceEngine | null = null;

    // ── SENTIMENT STATE ──────────────────────────────────────────
    // Toggled from the TuningPanel checkbox (color mode only).
    sentimentEnabled = false;

    // Sentiment-driven movement toggle — works in ANY color mode.
    sentimentMovementEnabled = false;

    // Smoothed sentiment value — lerped toward target to prevent
    // jarring snaps between positive and negative states.
    private smoothedSentiment = 0;

    // ── EMOTION STATE (SER) ──────────────────────────────────────
    // Full VAD (Valence/Arousal/Dominance) from the SER worker.
    // Raw values arrive every ~2s; we EMA-smooth them for frame-rate use.
    private rawEmotion: EmotionState = { ...NEUTRAL_EMOTION };
    private smoothedValence = 0;
    private smoothedArousal = 0;
    private smoothedDominance = 0;
    private static readonly EMOTION_EMA_ALPHA = 0.15; // per-frame at 60fps ≈ τ of ~0.4s

    // ── DIAGNOSTIC LOGGING (TEMPORARY) ────────────────────────────
    // Logs the actual uniform values being sent to the shader every ~0.5s.
    private logCounter = 0;
    private logInterval = 30; // ~0.5s at 60fps

    constructor(audioEngine: AudioEngine, particleSystem: ParticleSystem, config: TuningConfig, workspaceEngine?: WorkspaceEngine) {
        this.audioEngine = audioEngine;
        this.particleSystem = particleSystem;
        this.config = config;
        this.workspaceEngine = workspaceEngine || null;
    }

    /**
     * Smoothly reset all audio-driven effects to idle baseline.
     * Called by the UI "return to idle" button.
     */
    resetToIdle() {
        this.idleMode = true;
    }

    /**
     * Exit idle mode (e.g. when mic is turned on again).
     */
    exitIdle() {
        this.idleMode = false;
    }

    /**
     * Receive full VAD emotion state from the SER worker.
     * Called approximately every 2 seconds. Values are EMA-smoothed
     * in update() for frame-rate-safe shader consumption.
     */
    setEmotionState(emotion: EmotionState): void {
        this.rawEmotion = emotion;
    }

    /**
     * Get the current smoothed emotion values (for external inspection/testing).
     */
    getSmoothedEmotion(): { valence: number; arousal: number; dominance: number } {
        return {
            valence: this.smoothedValence,
            arousal: this.smoothedArousal,
            dominance: this.smoothedDominance,
        };
    }

    update() {
        const features = this.audioEngine.getFeatures();

        // Get references to the shader uniforms we need to update
        const uniforms = this.particleSystem.velocityVariable.material.uniforms;
        const renderUniforms = (this.particleSystem.particles.material as THREE.ShaderMaterial).uniforms;

        // ── APPLY INFLUENCE MULTIPLIERS FROM TUNING CONFIG ────────────
        // Each audio feature has an "influence" slider in the tuning panel.
        // influence=0 → feature is muted (no visual effect)
        // influence=1 → default strength
        // influence=2 → doubled effect
        // This lets you isolate individual features to see their effect,
        // or boost features that aren't prominent enough.
        let energy = features.energy * this.config.get('audioInfluence.energy');
        let tension = features.tension * this.config.get('audioInfluence.tension');
        let urgency = features.urgency * this.config.get('audioInfluence.urgency');
        let breathiness = features.breathiness * this.config.get('audioInfluence.breathiness');
        let textureComplexity = features.textureComplexity * this.config.get('audioInfluence.textureComplexity');
        let rolloff = features.rolloff * this.config.get('audioInfluence.rolloff');

        // ── IDLE MODE ─────────────────────────────────────────────────
        // When idle, zero out all audio features so particles return to
        // neutral state. The shader's spring force handles smooth return.
        if (this.idleMode) {
            energy = 0;
            tension = 0;
            urgency = 0;
            breathiness = 0;
            textureComplexity = 0;
            rolloff = 0.5; // Neutral edge softness
        }

        // ── MAP AUDIO FEATURES → SHADER UNIFORMS ──────────────────────
        // All values are clamped to [0, 1] as a safety measure.
        // Even though AudioEngine normalizes values, edge cases in audio
        // processing (e.g., sudden loud sounds, mic gain changes) could
        // produce values > 1.0 or NaN. Clamping prevents shader instability.
        uniforms.uEnergy.value = Math.max(0, Math.min(1, energy));
        uniforms.uTension.value = Math.max(0, Math.min(1, tension));
        uniforms.uUrgency.value = Math.max(0, Math.min(1, urgency));
        uniforms.uBreathiness.value = Math.max(0, Math.min(1, breathiness));
        uniforms.uTextureComplexity.value = Math.max(0, Math.min(1, textureComplexity));

        // ── CURVE SHAPING MODES → SHADER UNIFORMS ─────────────────────
        // Push the toggle states and threshold values from TuningConfig
        // to the velocity shader every frame. These control how energy
        // and urgency map to visual effects (linear vs shaped curves).
        uniforms.uEnergyCurveMode.value = this.config.get('energyCurveMode');
        uniforms.uUrgencyCurveMode.value = this.config.get('urgencyCurveMode');
        uniforms.uUrgencyThresholdLow.value = this.config.get('urgencyThresholdLow');
        uniforms.uUrgencyThresholdHigh.value = this.config.get('urgencyThresholdHigh');

        // ── ROLLOFF → RENDER SHADER ───────────────────────────────────
        // Spectral rolloff controls particle edge softness/crispness.
        renderUniforms.uRolloff.value = Math.max(0, Math.min(1, rolloff));

        // ── TENSION + ENERGY → RENDER SHADER ─────────────────────────
        // Tension drives warm ↔ cool color baseline in fragment shader.
        // Energy drives brightness boost for loud speech.
        renderUniforms.uTension.value = Math.max(0, Math.min(1, tension));
        renderUniforms.uEnergy.value = Math.max(0, Math.min(1, energy));

        // ── EMA SMOOTH EMOTION STATE ──────────────────────────────
        // Smoothly interpolate raw SER values for frame-rate use.
        // The SER worker fires every ~2s, so raw values would cause
        // jarring step-changes without smoothing.
        const ema = UniformBridge.EMOTION_EMA_ALPHA;
        this.smoothedValence += (this.rawEmotion.valence - this.smoothedValence) * ema;
        this.smoothedArousal += (this.rawEmotion.arousal - this.smoothedArousal) * ema;
        this.smoothedDominance += (this.rawEmotion.dominance - this.smoothedDominance) * ema;

        // ── EMOTION → PHYSICS MODULATION ─────────────────────────
        // Map VAD dimensions to particle physics offsets:
        //   Arousal    → noise amplitude boost (excited = chaotic)
        //   Valence    → spring constant offset (positive = lighter)
        //   Dominance  → repulsion strength boost (dominant = assertive)
        const arousalNoiseOffset = this.smoothedArousal * 0.4;
        const valenceSpringOffset = -this.smoothedValence * 0.3;
        const dominanceRepulsionOffset = this.smoothedDominance * 0.2;

        // ── OVERRIDES → SHADER UNIFORMS ──────────────────────
        // Apply SemanticBackend overrides, or let WorkspaceEngine provide
        // fallback tracking if SemanticBackend doesn't provide them.
        if (this.abstractionOverride !== null) {
            uniforms.uAbstraction.value = Math.max(0, Math.min(1, this.abstractionOverride));
        } else if (this.workspaceEngine) {
            uniforms.uAbstraction.value = Math.max(0, Math.min(1, this.workspaceEngine.getState().abstractionLevel));
        }

        if (this.noiseOverride !== null) {
            uniforms.uNoiseAmplitude.value = Math.max(0, Math.min(2, this.noiseOverride + arousalNoiseOffset));
        } else if (this.workspaceEngine) {
            uniforms.uNoiseAmplitude.value = Math.max(0, Math.min(2, this.workspaceEngine.getNoiseAmplitude() + arousalNoiseOffset));
        } else {
            // No override and no workspace engine — just apply emotion offset
            uniforms.uNoiseAmplitude.value = Math.max(0, Math.min(2, uniforms.uNoiseAmplitude.value + arousalNoiseOffset));
        }

        // ── SPRING OVERRIDE (TRANSITION CHOREOGRAPHY) ────────────
        // SemanticBackend sets springOverride during dissolve/reform/settle.
        // Also applies valence-based spring modulation.
        if (this.springOverride !== null) {
            uniforms.uSpringK.value = Math.max(0.1, this.springOverride + valenceSpringOffset);
        } else {
            // Apply valence offset to the base spring constant from config
            const baseSpring = uniforms.uSpringK.value;
            uniforms.uSpringK.value = Math.max(0.1, baseSpring + valenceSpringOffset);
        }

        // ── DOMINANCE → REPULSION ────────────────────────────────
        uniforms.uRepulsionStrength.value = Math.max(0, uniforms.uRepulsionStrength.value + dominanceRepulsionOffset);



        // ── DIAGNOSTIC LOGGING (TEMPORARY) ────────────────────────────
        // Tier 3: The actual values on the shader uniforms.
        // If [SMOOTH] values are nonzero but these are zero, the bug
        // is in the clamping or property access above.
        this.logCounter++;
        if (this.logCounter >= this.logInterval) {
            this.logCounter = 0;
            console.log(
                `[UNIFORMS] uEnergy:${uniforms.uEnergy.value.toFixed(3)} ` +
                `uTension:${uniforms.uTension.value.toFixed(3)} ` +
                `uUrgency:${uniforms.uUrgency.value.toFixed(3)} ` +
                `uBreathiness:${uniforms.uBreathiness.value.toFixed(3)} ` +
                `uTexture:${uniforms.uTextureComplexity.value.toFixed(3)} ` +
                `uRolloff:${renderUniforms.uRolloff.value.toFixed(3)}`
            );
        }

        // ── COLOR MODE → SHADER UNIFORM ──────────────────────────────
        // Push the color mode to the render shader. The shader uses this
        // to decide between white (tension-tinted) and color (sentiment) rendering.
        renderUniforms.uColorMode.value = this.colorMode === 'color' ? 1.0 : 0.0;

        // ── SENTIMENT SMOOTHING (shared by color + movement) ─────────
        // Smoothly interpolate the raw sentiment override toward a stable
        // value. This runs whenever EITHER Sentiment Color or Sentiment
        // Movement is active, so movement can work independently of color.
        //
        // ASYMMETRIC ATTACK / RELEASE:
        // Emotional peaks ramp up at full lerp speed so they hit hard.
        // Decay toward neutral uses half speed so the system settles
        // gracefully between rapid sentiment changes (e.g. "happy...
        // terrible... wonderful" in quick succession).
        {
            const colorActive = this.sentimentEnabled
                && this.sentimentOverride !== null;
            const movActive = this.sentimentMovementEnabled
                && this.sentimentOverride !== null;

            const target = (colorActive || movActive)
                ? this.sentimentOverride!
                : 0;

            // Temporal smoothing — asymmetric: fast attack, slow release
            const baseSpeed = this.config.get('sentimentSmoothing');
            const dt = this.particleSystem.velocityVariable.material.uniforms.uDelta.value;
            const delta = target - this.smoothedSentiment;
            // Attack: moving away from zero (toward a stronger emotion)
            // Release: moving toward zero (decaying back to neutral)
            const isAttack = Math.abs(target) > Math.abs(this.smoothedSentiment);
            const speed = isAttack ? baseSpeed : baseSpeed * 0.5;
            this.smoothedSentiment += delta * Math.min(1.0, speed * dt);
            this.smoothedSentiment = Math.max(-1, Math.min(1, this.smoothedSentiment));
        }

        // ── SENTIMENT COLOR → RENDER SHADER UNIFORMS ──────────────────
        // Push smoothed sentiment to fragment shader. In the new system,
        // the shader handles warm/cool tinting internally—no need for
        // separate warm/cool/intensity uniforms.
        {
            // Sentiment color works in BOTH modes now (not just color mode)
            const isColorActive = this.sentimentEnabled
                && this.sentimentOverride !== null;

            renderUniforms.uSentiment.value = isColorActive
                ? this.smoothedSentiment
                : 0;

            // Pass emotional intensity for angry vs sad distinction
            renderUniforms.uEmotionalIntensity.value = isColorActive
                ? (this.emotionalIntensityOverride ?? 0)
                : 0;

            // Pass full VAD for Plutchik emotion wheel color mapping
            renderUniforms.uEmotionArousal.value = this.smoothedArousal;
            renderUniforms.uEmotionDominance.value = this.smoothedDominance;
        }

        // ── SENTIMENT MOVEMENT → VELOCITY SHADER UNIFORMS ─────────
        // Push the same smoothed sentiment to the velocity shader for
        // physics modulation (LMA Effort framework). Independent of
        // color mode — works in both white and color.
        //
        // When sentimentOverride is null (no keyword classified), fall back
        // to SER smoothedValence so voice tone still modulates particles.
        {
            const velUniforms = this.particleSystem.velocityVariable.material.uniforms;

            let movementSentiment = 0;
            if (this.sentimentMovementEnabled) {
                if (this.sentimentOverride !== null) {
                    movementSentiment = this.smoothedSentiment;
                } else {
                    // Fallback: use SER valence (prosodic tone)
                    movementSentiment = this.smoothedValence;
                }
            }

            velUniforms.uSentimentMovement.value = movementSentiment;
            velUniforms.uSentimentMovementIntensity.value =
                this.config.get('sentimentMovementIntensity');

            // ── DIAGNOSTIC: SENTIMENT MOVEMENT ────────────────────────
            // Logs alongside the existing [UNIFORMS] diagnostic (~0.5s interval).
            // Shows the raw override, smoothed value, final uniform, and intensity
            // so you can see the full chain while tuning with the panel open.
            if (this.logCounter === 0 && this.sentimentMovementEnabled) {
                const intensity = this.config.get('sentimentMovementIntensity');
                const product = movementSentiment * intensity;
                console.log(
                    `[SENTIMENT-MOVE] override:${this.sentimentOverride?.toFixed(3) ?? 'null'} ` +
                    `smoothed:${this.smoothedSentiment.toFixed(3)} ` +
                    `uniform:${movementSentiment.toFixed(3)} ` +
                    `intensity:${intensity.toFixed(2)} ` +
                    `product:${product.toFixed(3)}`
                );
            }
        }

        // ── BASE COLOR ───────────────────────────────────────────────
        // The shader now handles tension→warm/cool tinting internally.
        // CPU-side just sets a neutral white baseline.
        renderUniforms.uColor.value.set(1.0, 1.0, 1.0);
    }
}
