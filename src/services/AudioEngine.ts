import Meyda from 'meyda';
import { PitchDetector } from 'pitchy';
import { TuningConfig } from './TuningConfig';

/**
 * AudioFeatures — The normalized, smoothed output of audio analysis.
 *
 * Each value ranges from 0.0 (none) to 1.0 (maximum). These are fed
 * into the shader pipeline via UniformBridge to control particle behavior.
 */
export interface AudioFeatures {
    energy: number;            // RMS loudness → ring expansion + breathing speed
    tension: number;           // Spectral centroid (brightness) → curl noise tightness + color
    urgency: number;           // Spectral flux (change rate) → noise turbulence/chaos
    breathiness: number;       // ZCR + flatness blend → drag reduction + airiness
    flatness: number;          // Spectral flatness (noise vs tone) → used in breathiness blend
    textureComplexity: number; // MFCC variance → vocal texture richness → noise variation
    rolloff: number;           // Spectral rolloff → voice brightness → particle edge crispness

    // ── PITCH (A1 upgrade — Pitchy F0 extraction) ────────────────
    pitch: number;             // Raw F0 in Hz (0 when no pitch detected)
    pitchDeviation: number;    // Normalized deviation from speaker baseline (-1.0 to +1.0)
    pitchConfidence: number;   // Pitch clarity/confidence (0.0–1.0)
}

/**
 * AudioEngine — Real-time audio feature extraction from microphone input.
 *
 * Uses Meyda for FFT-based feature extraction. Each feature is normalized
 * to [0,1] and EMA-smoothed to prevent jittery particle behavior.
 */
export class AudioEngine {
    audioContext: AudioContext | null = null;
    source: MediaStreamAudioSourceNode | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Meyda's MeydaAnalyzer type is not exported
    analyzer: any | null = null;

    // When present, smoothing alphas are read from TuningConfig each frame.
    private config: TuningConfig | null = null;

    features: AudioFeatures = {
        energy: 0,
        tension: 0,
        urgency: 0,
        breathiness: 0,
        flatness: 0,
        textureComplexity: 0,
        rolloff: 0,
        pitch: 0,
        pitchDeviation: 0,
        pitchConfidence: 0,
    };

    /** Wire up TuningConfig for real-time smoothing alpha adjustment. */
    setConfig(config: TuningConfig): void {
        this.config = config;
    }

    // EMA smoothing factors: higher alpha = smoother, lower = snappier.
    private alphaRequest = {
        rms: 0.55,              // Energy: fast response (was 0.82)
        spectralCentroid: 0.70, // Tension: moderately responsive (was 0.88)
        spectralFlux: 0.35,     // Urgency: near-instant transient response (was 0.65)
        zcr: 0.55,              // ZCR component: fast (was 0.80)
        spectralFlatness: 0.60  // Flatness component: responsive (was 0.85)
    };

    // Auto-calibrates to the loudest RMS heard so far.
    private maxRms = 0.01;
    // Previous frame RMS for computing urgency (manual spectral flux substitute;
    // Meyda's spectralFlux crashes the callback in some browser versions).
    private prevRms = 0;

    // Pitch tracking via Pitchy McLeod Pitch Method (parallel AnalyserNode).
    private pitchAnalyser: AnalyserNode | null = null;
    private pitchBuffer: Float32Array<ArrayBuffer> | null = null;
    private pitchDetector: PitchDetector<Float32Array<ArrayBuffer>> | null = null;
    private pitchBaseline = 0;           // EMA of speaker's typical F0 (Hz)
    private pitchBaselineAlpha = 0.01;   // Slow-moving baseline
    private pitchBaselineInitialized = false;

    async start() {
        if (this.audioContext) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitAudioContext is vendor-prefixed
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

            // Chrome starts AudioContext suspended; must resume after user gesture.
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.source = this.audioContext.createMediaStreamSource(stream);

            // Parallel AnalyserNode for Pitchy pitch detection alongside Meyda.
            const pitchFftSize = 2048;
            this.pitchAnalyser = this.audioContext.createAnalyser();
            this.pitchAnalyser.fftSize = pitchFftSize;
            this.source.connect(this.pitchAnalyser);
            this.pitchBuffer = new Float32Array(pitchFftSize) as Float32Array<ArrayBuffer>;
            this.pitchDetector = PitchDetector.forFloat32Array(pitchFftSize);

            this.analyzer = Meyda.createMeydaAnalyzer({
                audioContext: this.audioContext,
                source: this.source,
                bufferSize: 512,
                // DO NOT add 'spectralFlux' — it crashes Meyda's callback in some browsers.
                featureExtractors: [
                    'rms',
                    'spectralCentroid',
                    'zcr',
                    'spectralFlatness',
                    'mfcc',
                    'spectralRolloff'
                ],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Meyda callback features are untyped
                callback: (features: any) => {
                    this.processFeatures(features);
                }
            });

            this.analyzer.start();
            console.log('[AudioEngine] Started');
        } catch (e) {
            console.error('[AudioEngine] Start failed:', e);
        }
    }

    stop() {
        if (this.analyzer) {
            this.analyzer.stop();
        }
        if (this.pitchAnalyser) {
            this.pitchAnalyser.disconnect();
        }
        if (this.source) {
            this.source.disconnect();
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.audioContext = null;
        this.source = null;
        this.analyzer = null;
        this.pitchAnalyser = null;
        this.pitchBuffer = null;
        this.pitchDetector = null;
        console.log('[AudioEngine] Stopped');
    }

    getFeatures(): AudioFeatures {
        return this.features;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Meyda feature extraction output is untyped
    private processFeatures(raw: any) {
        if (!raw) return;

        // RMS → energy: auto-calibrate against loudest level heard.
        const rms = raw.rms || 0;
        if (rms > this.maxRms) {
            this.maxRms = rms;
        } else {
            this.maxRms *= 0.998; // Faster decay for quicker sensitivity adaptation (was 0.9995)
        }
        const normRms = Math.min(rms / this.maxRms, 1.0);
        this.features.energy = this.smooth(
            this.features.energy, normRms,
            this.config?.get('audioSmoothing.energy') ?? this.alphaRequest.rms
        );

        // Spectral centroid → tension: bin index normalized over speech range.
        const centroid = raw.spectralCentroid || 0;
        const normCentroid = Math.min(centroid / 80.0, 1.0);
        this.features.tension = this.smooth(
            this.features.tension, normCentroid,
            this.config?.get('audioSmoothing.tension') ?? this.alphaRequest.spectralCentroid
        );

        // RMS delta → urgency: manual spectral flux substitute.
        // Amplified by 15x since raw deltas are tiny (0.001–0.05).
        const rmsDelta = Math.abs(rms - this.prevRms);
        this.prevRms = rms;
        const normDelta = Math.min((rmsDelta / this.maxRms) * 15.0, 1.0);
        this.features.urgency = this.smooth(
            this.features.urgency, normDelta,
            this.config?.get('audioSmoothing.urgency') ?? this.alphaRequest.spectralFlux
        );

        // ZCR + flatness → breathiness: blended because ZCR alone
        // correlates too much with energy. Flatness measures spectral
        // shape independently of amplitude.
        const zcr = raw.zcr || 0;
        const normZcr = Math.min(zcr / 100.0, 1.0); // 0-100 range for speech
        const smoothedZcr = this.smooth(
            this.features.breathiness, normZcr,
            this.config?.get('audioSmoothing.breathiness') ?? this.alphaRequest.zcr
        );

        const flatness = raw.spectralFlatness || 0;
        const normFlatness = Math.min(flatness / 0.3, 1.0); // 0-0.3 is typical
        const smoothedFlatness = this.smooth(
            this.features.flatness, normFlatness, this.alphaRequest.spectralFlatness
        );
        this.features.flatness = smoothedFlatness;

        // 40% ZCR + 60% flatness (flatness is less correlated with energy).
        this.features.breathiness = smoothedZcr * 0.4 + smoothedFlatness * 0.6;

        // MFCC variance → texture complexity (vocal richness).
        const mfccArray = raw.mfcc as number[] | undefined;
        if (mfccArray && mfccArray.length > 0) {
            const mfccMean = mfccArray.reduce((a: number, b: number) => a + b, 0) / mfccArray.length;
            const mfccVariance = mfccArray.reduce((a: number, b: number) => a + Math.pow(b - mfccMean, 2), 0) / mfccArray.length;
            // Typical variance range is 0-500, map to 0-1
            const normTexture = Math.min(mfccVariance / 300, 1.0);
            this.features.textureComplexity = this.smooth(
                this.features.textureComplexity, normTexture,
                this.config?.get('audioSmoothing.textureComplexity') ?? 0.88
            );
        }

        // Spectral rolloff → voice brightness (1000–8000 Hz speech range).
        const rolloffHz = raw.spectralRolloff || 0;
        const normRolloff = Math.min(Math.max((rolloffHz - 1000) / 7000, 0), 1.0);
        this.features.rolloff = this.smooth(
            this.features.rolloff, normRolloff,
            this.config?.get('audioSmoothing.rolloff') ?? 0.88
        );

        // Pitchy F0 extraction from parallel AnalyserNode.
        this.processPitch();

    }

    /** Extract F0 pitch via McLeod Pitch Method; updates pitch features. */
    private processPitch(): void {
        if (!this.pitchAnalyser || !this.pitchBuffer || !this.pitchDetector || !this.audioContext) {
            // Pitch hardware not set up (e.g., before start() or after stop())
            return;
        }

        // Grab the latest time-domain samples from the AnalyserNode
        this.pitchAnalyser.getFloatTimeDomainData(this.pitchBuffer);

        // Run Pitchy's McLeod Pitch Method
        const [pitchHz, clarity] = this.pitchDetector.findPitch(
            this.pitchBuffer,
            this.audioContext.sampleRate
        );

        // Confidence = Pitchy's clarity value (0.0–1.0)
        const confidence = Math.max(0, Math.min(1, clarity));
        this.features.pitchConfidence = this.smooth(
            this.features.pitchConfidence, confidence, 0.7
        );

        if (confidence >= 0.5 && pitchHz > 50 && pitchHz < 1000) {
            // Valid pitch detected within human speech range (50–1000 Hz)
            this.features.pitch = this.smooth(
                this.features.pitch, pitchHz, 0.6
            );

            // Update baseline EMA (tracks speaker's typical F0)
            if (!this.pitchBaselineInitialized) {
                // First valid pitch — initialize baseline immediately
                this.pitchBaseline = pitchHz;
                this.pitchBaselineInitialized = true;
            } else {
                this.pitchBaseline = this.smooth(
                    this.pitchBaseline, pitchHz, 1 - this.pitchBaselineAlpha
                );
            }

            // Compute normalized deviation: (current - baseline) / baseline
            // Clamped to [-1, +1]
            if (this.pitchBaseline > 0) {
                const rawDeviation = (pitchHz - this.pitchBaseline) / this.pitchBaseline;
                const clampedDeviation = Math.max(-1, Math.min(1, rawDeviation));
                this.features.pitchDeviation = this.smooth(
                    this.features.pitchDeviation, clampedDeviation, 0.6
                );
            }
        } else {
            // No reliable pitch — decay toward zero
            this.features.pitch = this.smooth(this.features.pitch, 0, 0.9);
            this.features.pitchDeviation = this.smooth(
                this.features.pitchDeviation, 0, 0.85
            );
        }
    }

    /** EMA smoother: alpha=0.9 is very smooth, alpha=0.1 is very responsive. */
    private smooth(prev: number, curr: number, alpha: number): number {
        return alpha * prev + (1 - alpha) * curr;
    }
}
