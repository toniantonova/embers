/**
 * TuningConfig — Central singleton for all tunable parameters.
 *
 * Systems read values via config.get('key') each frame; the TuningPanel UI
 * writes via config.set('key', value). Values persist to localStorage.
 */

function isMobileDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isIOS || /Mobi|Android/i.test(ua) ||
        ('ontouchstart' in window && window.innerWidth < 1024);
}

/** True if the page loaded on a mobile device. Evaluated once at module init. */
export const IS_MOBILE = isMobileDevice();

// Mobile-only parameter overrides.
export const MOBILE_OVERRIDES: Record<string, number> = {
    pointSize: 1.5,         // Slightly bigger dots on small screens
    formationScale: 1.1,    // Shrink formation to avoid viewport overflow
    cameraZ: 12,            // Pull camera back for breathing room
};

// Applied in Complex mode: denser, tighter clustering for server meshes.
export const COMPLEX_OVERRIDES: Record<string, number> = {
    serverShapeScale: 2.8,      // Bigger server shapes — fills the viewport
    springK: 5.0,               // Tighter spring → particles cluster firmly
    noiseAmplitude: 0.08,       // Minimal curl scatter → shapes stay coherent
    pointSize: 1.8,             // Fatter dots → fills gaps in sparse meshes
    pointBrightness: 1.4,       // Extra brightness for dense shapes
    drag: 4.0,                  // More damping → less floaty drift
    breathingAmplitude: 0.015,  // Calmer idle → shapes don't wobble apart
    formationScale: 1.8,        // Slightly larger formation footprint
};

export interface ParamDef {
    key: string;
    label: string;
    defaultValue: number;
    min: number;
    max: number;
    step: number;
    group: string;
    feature?: string;
}

export const PARAM_DEFS: ParamDef[] = [
    // ── Particle Appearance ──
    {
        key: 'pointSize', label: 'Point Size',
        defaultValue: 1.0, min: 0.5, max: 8, step: 0.5,
        group: '🔴 Particle Appearance'
    },
    {
        key: 'pointOpacity', label: 'Point Opacity',
        defaultValue: 0.7, min: 0.1, max: 1.0, step: 0.05,
        group: '🔴 Particle Appearance'
    },
    {
        key: 'pointBrightness', label: 'Point Brightness',
        defaultValue: 1.2, min: 0.5, max: 3.0, step: 0.1,
        group: '🔴 Particle Appearance'
    },
    {
        key: 'coreWeight', label: 'Core Weight',
        defaultValue: 0.8, min: 0.0, max: 2.0, step: 0.1,
        group: '🔴 Particle Appearance'
    },
    {
        key: 'glowWeight', label: 'Glow Weight',
        defaultValue: 0.4, min: 0.0, max: 2.0, step: 0.1,
        group: '🔴 Particle Appearance'
    },
    {
        key: 'trailLength', label: 'Trail Length (fade)',
        defaultValue: 0.2, min: 0.01, max: 0.3, step: 0.01,
        group: '🔴 Particle Appearance'
    },
    {
        key: 'formationScale', label: 'Formation Scale',
        defaultValue: 1.6, min: 0.2, max: 3.0, step: 0.1,
        group: '🔴 Particle Appearance'
    },
    {
        key: 'serverShapeScale', label: 'Server Shape Scale',
        defaultValue: 1.5, min: 0.5, max: 3.0, step: 0.1,
        group: '🔴 Particle Appearance'
    },

    // ── Physics ──
    {
        key: 'springK', label: 'Spring Strength (K)',
        defaultValue: 3.0, min: 0.5, max: 10.0, step: 0.5,
        group: '🔵 Physics'
    },
    {
        key: 'drag', label: 'Drag',
        defaultValue: 3.5, min: 0.5, max: 5.0, step: 0.25,
        group: '🔵 Physics'
    },
    {
        key: 'noiseAmplitude', label: 'Curl Noise Amp (base)',
        defaultValue: 0.25, min: 0.0, max: 1.0, step: 0.05,
        group: '🔵 Physics'
    },
    {
        key: 'noiseFrequency', label: 'Curl Noise Frequency',
        defaultValue: 0.8, min: 0.1, max: 3.0, step: 0.1,
        group: '🔵 Physics'
    },
    {
        key: 'breathingAmplitude', label: 'Breathing Amplitude',
        defaultValue: 0.05, min: 0.0, max: 0.2, step: 0.005,
        group: '🔵 Physics'
    },
    {
        // 0 = snap to shape, 1 = free drift with curl noise.
        key: 'abstraction', label: 'Abstraction (shape→drift)',
        defaultValue: 0.0, min: 0.0, max: 1.0, step: 0.05,
        group: '🔵 Physics'
    },

    // ── Audio → Visual Mapping ──
    // Influence: 0=muted, 1=default, 2=doubled. Smoothing: EMA alpha.
    {
        key: 'audioInfluence.energy', label: 'Influence',
        defaultValue: 1.0, min: 0.0, max: 2.0, step: 0.1,
        group: '🎚 Audio Reactivity', feature: 'energy'
    },
    {
        key: 'audioSmoothing.energy', label: 'Smoothing',
        defaultValue: 0.78, min: 0.1, max: 0.99, step: 0.01,
        group: '🎚 Audio Reactivity', feature: 'energy'
    },
    {
        key: 'audioInfluence.tension', label: 'Influence',
        defaultValue: 1.0, min: 0.0, max: 2.0, step: 0.1,
        group: '🎚 Audio Reactivity', feature: 'tension'
    },
    {
        key: 'audioSmoothing.tension', label: 'Smoothing',
        defaultValue: 0.70, min: 0.1, max: 0.99, step: 0.01,
        group: '🎚 Audio Reactivity', feature: 'tension'
    },
    {
        key: 'audioInfluence.urgency', label: 'Influence',
        defaultValue: 1.0, min: 0.0, max: 2.0, step: 0.1,
        group: '🎚 Audio Reactivity', feature: 'urgency'
    },
    {
        key: 'audioSmoothing.urgency', label: 'Smoothing',
        defaultValue: 0.35, min: 0.1, max: 0.99, step: 0.01,
        group: '🎚 Audio Reactivity', feature: 'urgency'
    },
    {
        key: 'audioInfluence.breathiness', label: 'Influence',
        defaultValue: 1.0, min: 0.0, max: 2.0, step: 0.1,
        group: '🎚 Audio Reactivity', feature: 'breathiness'
    },
    {
        key: 'audioSmoothing.breathiness', label: 'Smoothing',
        defaultValue: 0.55, min: 0.1, max: 0.99, step: 0.01,
        group: '🎚 Audio Reactivity', feature: 'breathiness'
    },
    {
        key: 'audioInfluence.flatness', label: 'Influence',
        defaultValue: 1.0, min: 0.0, max: 2.0, step: 0.1,
        group: '🎚 Audio Reactivity', feature: 'flatness'
    },
    {
        key: 'audioSmoothing.flatness', label: 'Smoothing',
        defaultValue: 0.60, min: 0.1, max: 0.99, step: 0.01,
        group: '🎚 Audio Reactivity', feature: 'flatness'
    },
    {
        key: 'audioInfluence.textureComplexity', label: 'Influence',
        defaultValue: 1.0, min: 0.0, max: 2.0, step: 0.1,
        group: '🎚 Audio Reactivity', feature: 'texture'
    },
    {
        key: 'audioSmoothing.textureComplexity', label: 'Smoothing',
        defaultValue: 0.88, min: 0.1, max: 0.99, step: 0.01,
        group: '🎚 Audio Reactivity', feature: 'texture'
    },
    {
        key: 'audioInfluence.rolloff', label: 'Influence',
        defaultValue: 1.0, min: 0.0, max: 2.0, step: 0.1,
        group: '🎚 Audio Reactivity', feature: 'rolloff'
    },
    {
        key: 'audioSmoothing.rolloff', label: 'Smoothing',
        defaultValue: 0.88, min: 0.1, max: 0.99, step: 0.01,
        group: '🎚 Audio Reactivity', feature: 'rolloff'
    },

    // ── Curve Shaping ── (0=linear, 1=power/smoothstep)
    {
        key: 'energyCurveMode', label: 'Energy Curve Mode',
        defaultValue: 0.0, min: 0.0, max: 1.0, step: 1.0,
        group: '⚡ Curve Shaping'
    },
    {
        key: 'urgencyCurveMode', label: 'Urgency Curve Mode',
        defaultValue: 0.0, min: 0.0, max: 1.0, step: 1.0,
        group: '⚡ Curve Shaping'
    },
    {
        key: 'urgencyThresholdLow', label: 'Urgency Threshold Low',
        defaultValue: 0.3, min: 0.0, max: 1.0, step: 0.05,
        group: '⚡ Curve Shaping'
    },
    {
        key: 'urgencyThresholdHigh', label: 'Urgency Threshold High',
        defaultValue: 0.8, min: 0.0, max: 1.0, step: 0.05,
        group: '⚡ Curve Shaping'
    },

    // ── Pointer Interaction ──
    {
        key: 'repulsionRadius', label: 'Repulsion Radius',
        defaultValue: 2.0, min: 0.5, max: 5.0, step: 0.25,
        group: '🟡 Pointer Interaction'
    },
    {
        key: 'repulsionStrength', label: 'Repulsion Strength',
        defaultValue: 12.0, min: 1.0, max: 20.0, step: 1.0,
        group: '🟡 Pointer Interaction'
    },

    // ── Sentiment Color ──
    {
        key: 'sentimentSmoothing', label: 'Smoothing',
        defaultValue: 6.0, min: 0.5, max: 12.0, step: 0.5,
        group: '🎨 Sentiment Color'
    },

    // ── Sentiment Movement ──
    {
        key: 'sentimentMovementIntensity', label: 'Intensity',
        defaultValue: 1.5, min: 0.0, max: 3.0, step: 0.1,
        group: '🏃 Sentiment Movement'
    },

    // ── Camera ──
    {
        key: 'cameraZ', label: 'Camera Z Position',
        defaultValue: 9, min: 1, max: 50, step: 0.5,
        group: '📷 Camera'
    },
];

type ConfigListener = (key: string, value: number) => void;

const STORAGE_KEY = 'dots-tuning-config';
// Bump when defaults change; stale localStorage is discarded automatically.
const CONFIG_VERSION = 12;
const MODE_STORAGE_KEY = 'dots-mode';

export class TuningConfig {
    private values: Map<string, number> = new Map();
    private listeners: Set<ConfigListener> = new Set();

    /** Whether this instance uses mobile defaults. */
    readonly isMobile: boolean;

    // Simple = pre-built shapes, Complex = server-generated GPU shapes.
    private _complexMode: boolean;
    private _simpleSnapshot: Map<string, number> | null = null;

    get complexMode(): boolean { return this._complexMode; }
    set complexMode(v: boolean) {
        if (v === this._complexMode) return;
        this._complexMode = v;
        try { localStorage.setItem(MODE_STORAGE_KEY, v ? 'complex' : 'simple'); } catch { /* noop */ }

        if (v) {
            // Entering complex mode → snapshot current simple values, apply overrides
            this._simpleSnapshot = new Map<string, number>();
            for (const key of Object.keys(COMPLEX_OVERRIDES)) {
                this._simpleSnapshot.set(key, this.get(key));
            }
            for (const [key, value] of Object.entries(COMPLEX_OVERRIDES)) {
                this.values.set(key, value);
                for (const listener of this.listeners) listener(key, value);
            }
            console.log('[TuningConfig] ✨ Applied complex mode overrides');
        } else {
            // Returning to simple → revert to snapshot
            if (this._simpleSnapshot) {
                for (const [key, value] of this._simpleSnapshot) {
                    this.values.set(key, value);
                    for (const listener of this.listeners) listener(key, value);
                }
                this._simpleSnapshot = null;
                console.log('[TuningConfig] ↩ Reverted to simple mode defaults');
            }
        }

        // Notify listeners so UI can re-render the toggle
        for (const listener of this.listeners) listener('complexMode', v ? 1 : 0);
    }

    constructor(options?: { isMobile?: boolean }) {
        this.isMobile = options?.isMobile ?? IS_MOBILE;

        // 0. Load mode toggle from localStorage.
        //    Default to Complex for first-time visitors (no saved preference).
        try {
            this._complexMode = (localStorage.getItem(MODE_STORAGE_KEY) ?? 'complex') === 'complex';
        } catch {
            this._complexMode = true;
        }

        // 1. Load defaults from PARAM_DEFS.
        for (const def of PARAM_DEFS) {
            this.values.set(def.key, def.defaultValue);
        }

        // 2. Apply mobile overrides (before localStorage, so user tweaks win).
        if (this.isMobile) {
            for (const [key, value] of Object.entries(MOBILE_OVERRIDES)) {
                this.values.set(key, value);
            }
            console.log('[TuningConfig] 📱 Applied mobile overrides');
        }

        // 3. Override with any saved values from localStorage.
        this.loadFromStorage();

        // 4. Apply complex mode overrides if mode was persisted as 'complex'.
        //    Build a snapshot of the current (simple) values BEFORE applying
        //    overrides so toggle off → simple correctly reverts.
        if (this._complexMode) {
            this._simpleSnapshot = new Map<string, number>();
            for (const key of Object.keys(COMPLEX_OVERRIDES)) {
                this._simpleSnapshot.set(key, this.get(key));
            }
            for (const [key, value] of Object.entries(COMPLEX_OVERRIDES)) {
                this.values.set(key, value);
            }
        }

        console.log(
            '[TuningConfig] Initialized with', this.values.size, 'parameters',
            `(mode: ${this._complexMode ? 'complex' : 'simple'})`,
        );
    }

    /** Get current value, falling back to default. */
    get(key: string): number {
        return this.values.get(key) ?? this.getDefault(key);
    }

    /** Set a parameter value (clamped to min/max), notify listeners, persist. */
    set(key: string, value: number): void {
        const def = PARAM_DEFS.find(d => d.key === key);
        if (def) {
            value = Math.max(def.min, Math.min(def.max, value));
        }
        this.values.set(key, value);

        for (const listener of this.listeners) {
            listener(key, value);
        }

        this.saveToStorage();
    }

    /** Subscribe to changes. Returns unsubscribe function. */
    onChange(listener: ConfigListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getDefault(key: string): number {
        if (this.isMobile && key in MOBILE_OVERRIDES) {
            return MOBILE_OVERRIDES[key];
        }
        return PARAM_DEFS.find(d => d.key === key)?.defaultValue ?? 0;
    }

    /** Reset all parameters to defaults, notifying listeners. */
    resetAll(): void {
        for (const def of PARAM_DEFS) {
            const value = (this.isMobile && def.key in MOBILE_OVERRIDES)
                ? MOBILE_OVERRIDES[def.key]
                : def.defaultValue;
            this.values.set(def.key, value);
            for (const listener of this.listeners) {
                listener(def.key, value);
            }
        }

        // If in complex mode, rebuild snapshot from fresh defaults
        // and re-apply overrides so toggle off still works correctly.
        if (this._complexMode) {
            this._simpleSnapshot = new Map<string, number>();
            for (const key of Object.keys(COMPLEX_OVERRIDES)) {
                this._simpleSnapshot.set(key, this.get(key));
            }
            for (const [key, value] of Object.entries(COMPLEX_OVERRIDES)) {
                this.values.set(key, value);
                for (const listener of this.listeners) {
                    listener(key, value);
                }
            }
        } else {
            this._simpleSnapshot = null;
        }

        this.saveToStorage();
        console.log('[TuningConfig] All parameters reset to defaults');
    }

    /** Export all values as JSON. */
    toJSON(): Record<string, number> {
        const obj: Record<string, number> = {};
        for (const [key, value] of this.values) {
            obj[key] = value;
        }
        return obj;
    }

    /** Import values from JSON; ignores unknown keys. */
    fromJSON(json: Record<string, number>): void {
        for (const def of PARAM_DEFS) {
            if (json[def.key] !== undefined) {
                this.set(def.key, json[def.key]);
            }
        }
        console.log('[TuningConfig] Imported config from JSON');
    }

    /** Persist to localStorage. */
    private saveToStorage(): void {
        try {
            const data = { ...this.toJSON(), __version: CONFIG_VERSION };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
            // localStorage might be full or disabled — fail silently.
        }
    }

    /** Load from localStorage (called once during init). */
    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const json = JSON.parse(stored);

                // Version check — discard stale configs from old schema
                if (json.__version !== CONFIG_VERSION) {
                    console.log(
                        `[TuningConfig] Discarding stale config (v${json.__version ?? 'none'} → v${CONFIG_VERSION})`,
                    );
                    localStorage.removeItem(STORAGE_KEY);
                    return;
                }

                for (const def of PARAM_DEFS) {
                    if (json[def.key] !== undefined) {
                        this.values.set(
                            def.key,
                            Math.max(def.min, Math.min(def.max, json[def.key]))
                        );
                    }
                }
                console.log('[TuningConfig] Loaded saved config from localStorage');
            }
        } catch {
            // Corrupt data — ignore and use defaults.
            console.warn('[TuningConfig] Failed to load from localStorage, using defaults');
        }
    }
}
