/**
 * TuningPanel — Collapsible sidebar with tabbed navigation.
 *
 * ARCHITECTURE:
 * ─────────────
 * Split into two tabs for clarity:
 *   🎨 Visual — shape, particles, physics, camera, color, pointer
 *   🎧 Audio  — audio reactivity grid, curve shaping, speech, idle, presets
 *
 * The Audio tab features a compact grid layout where each audio feature
 * (energy, tension, urgency, etc.) gets one row with both influence and
 * smoothing sliders side-by-side, plus a live value badge.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TuningConfig, PARAM_DEFS } from '../services/TuningConfig';
import type { ParamDef } from '../services/TuningConfig';
import { AudioEngine } from '../services/AudioEngine';
import { MORPH_TARGET_NAMES } from '../engine/MorphTargets';


// ── TYPES ────────────────────────────────────────────────────────────
export type CameraType = 'perspective' | 'orthographic';
export type ColorMode = 'white' | 'color';
type PanelTab = 'visual' | 'audio';

// ── CONSTANTS ────────────────────────────────────────────────────────
// Groups that belong in each tab. The order here is the render order.
const VISUAL_GROUPS = ['🔴 Particle Appearance', '🔵 Physics', '🟡 Pointer Interaction', '📷 Camera', '🎨 Sentiment Color', '🏃 Sentiment Movement'];

// Feature display names for the audio reactivity grid
const AUDIO_FEATURE_LABELS: Record<string, string> = {
    energy: 'Energy',
    tension: 'Tension',
    urgency: 'Urgency',
    breathiness: 'Breathiness',
    flatness: 'Flatness',
    texture: 'Texture',
    rolloff: 'Rolloff',
};

// Map feature names to live feature keys
const FEATURE_LIVE_KEYS: Record<string, keyof ReturnType<AudioEngine['getFeatures']>> = {
    energy: 'energy',
    tension: 'tension',
    urgency: 'urgency',
    breathiness: 'breathiness',
    flatness: 'flatness',
    texture: 'textureComplexity',
    rolloff: 'rolloff',
};

// ── PROPS ────────────────────────────────────────────────────────────
interface TuningPanelProps {
    config: TuningConfig;
    audioEngine: AudioEngine;
    currentShape?: string;
    onShapeChange?: (shapeName: string) => void;
    onBlend?: (shapeA: string, shapeB: string, t: number) => void;
    cameraType?: CameraType;
    onCameraTypeChange?: (type: CameraType) => void;
    colorMode?: ColorMode;
    onColorModeChange?: (mode: ColorMode) => void;
    sentimentEnabled?: boolean;
    onSentimentToggle?: (enabled: boolean) => void;
    sentimentMovementEnabled?: boolean;
    onSentimentMovementToggle?: (enabled: boolean) => void;
    onIdleReset?: () => void;
}

export function TuningPanel({ config, audioEngine, currentShape, onShapeChange, onBlend, cameraType, onCameraTypeChange, colorMode, onColorModeChange, sentimentEnabled, onSentimentToggle, sentimentMovementEnabled, onSentimentMovementToggle, onIdleReset }: TuningPanelProps) {
    // ── STATE ────────────────────────────────────────────────────────
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<PanelTab>('visual');
    const [blendTarget, setBlendTarget] = useState<string>(MORPH_TARGET_NAMES[1]);
    const [blendAmount, setBlendAmount] = useState(0);
    const [revision, setRevision] = useState(0);
    const [pasteText, setPasteText] = useState('');
    const [copyFeedback, setCopyFeedback] = useState(false);


    const [liveFeatures, setLiveFeatures] = useState({
        energy: 0, tension: 0, urgency: 0, breathiness: 0,
        flatness: 0, textureComplexity: 0, rolloff: 0,
        pitch: 0, pitchDeviation: 0, pitchConfidence: 0,
    });
    const panelRef = useRef<HTMLDivElement>(null);

    // ── SUBSCRIBE TO CONFIG CHANGES ──────────────────────────────────
    useEffect(() => {
        const unsub = config.onChange(() => setRevision(r => r + 1));
        return unsub;
    }, [config]);

    // ── LIVE AUDIO POLLING (~30fps) ──────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const interval = setInterval(() => {
            const f = audioEngine.getFeatures();
            setLiveFeatures({
                energy: f.energy, tension: f.tension, urgency: f.urgency,
                breathiness: f.breathiness, flatness: f.flatness,
                textureComplexity: f.textureComplexity, rolloff: f.rolloff,
                pitch: f.pitch, pitchDeviation: f.pitchDeviation,
                pitchConfidence: f.pitchConfidence,
            });
        }, 33);
        return () => clearInterval(interval);
    }, [isOpen, audioEngine]);

    const handleOverlayClick = useCallback(() => setIsOpen(false), []);

    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
    }, []);

    const handleCopy = useCallback(async () => {
        const json = JSON.stringify(config.toJSON(), null, 2);
        try {
            await navigator.clipboard.writeText(json);
            setCopyFeedback(true);
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => setCopyFeedback(false), 1500);
        } catch { window.prompt('Copy this config:', json); }
    }, [config]);

    const handlePaste = useCallback(() => {
        try {
            config.fromJSON(JSON.parse(pasteText));
            setPasteText('');
        } catch { alert('Invalid JSON — please paste a valid config object.'); }
    }, [config, pasteText]);

    const handleReset = useCallback(() => config.resetAll(), [config]);

    // ── GROUP PARAMS BY TAB ──────────────────────────────────────────
    const visualGroups = new Map<string, ParamDef[]>();
    const audioGroups = new Map<string, ParamDef[]>();

    for (const def of PARAM_DEFS) {
        if (def.group === '⚡ Curve Shaping') continue; // rendered manually
        if (def.group === '🎚 Audio Reactivity') continue; // rendered as grid

        const targetMap = VISUAL_GROUPS.includes(def.group) ? visualGroups : audioGroups;
        if (!targetMap.has(def.group)) targetMap.set(def.group, []);
        targetMap.get(def.group)!.push(def);
    }

    // ── AUDIO FEATURE GRID DATA ──────────────────────────────────────
    // Group audio params by feature name for the compact grid
    const audioFeatureParams = new Map<string, ParamDef[]>();
    for (const def of PARAM_DEFS) {
        if (def.group === '🎚 Audio Reactivity' && def.feature) {
            if (!audioFeatureParams.has(def.feature)) audioFeatureParams.set(def.feature, []);
            audioFeatureParams.get(def.feature)!.push(def);
        }
    }

    void revision; // Force re-render dependency

    // ── RENDER SLIDER ROW ────────────────────────────────────────────
    const renderSlider = (def: ParamDef) => {
        const value = config.get(def.key);
        return (
            <div key={def.key} className="tuning-row">
                <div className="tuning-row-header">
                    <label className="tuning-label" htmlFor={`tuning-${def.key}`}>{def.label}</label>
                    <span className="tuning-current-value">
                        {value.toFixed(def.step < 0.01 ? 3 : def.step < 0.1 ? 2 : def.step < 1 ? 1 : 0)}
                    </span>
                </div>
                <input
                    id={`tuning-${def.key}`}
                    className="tuning-slider"
                    type="range"
                    min={def.min} max={def.max} step={def.step}
                    value={value}
                    onChange={(e) => config.set(def.key, parseFloat(e.target.value))}
                />
            </div>
        );
    };

    // ── RENDER ────────────────────────────────────────────────────────
    return (
        <>
            {/* GEAR BUTTON */}
            <button
                className="tuning-gear-btn"
                onClick={() => setIsOpen(!isOpen)}
                title="Tuning Panel"
                aria-label="Toggle tuning panel"
            >⚙</button>

            {/* OVERLAY */}
            {isOpen && <div className="tuning-overlay" onClick={handleOverlayClick} />}

            {/* SLIDE-IN PANEL */}
            <div ref={panelRef} className={`tuning-panel ${isOpen ? 'open' : ''}`}>
                <div className="tuning-panel-header">
                    <span>⚙ Tuning</span>
                    <button
                        className="tuning-close-btn"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close tuning panel"
                    >✕</button>
                </div>

                {/* ── TAB BAR ─────────────────────────────────────── */}
                <div className="tuning-tab-bar">
                    <button
                        className={`tuning-tab-pill ${activeTab === 'visual' ? 'active' : ''}`}
                        onClick={() => setActiveTab('visual')}
                    >🎨 Visual</button>
                    <button
                        className={`tuning-tab-pill ${activeTab === 'audio' ? 'active' : ''}`}
                        onClick={() => setActiveTab('audio')}
                    >🎧 Audio</button>
                </div>

                <div className="tuning-panel-content">
                    {/* ════════════════════════════════════════════════ */}
                    {/*  VISUAL TAB                                     */}
                    {/* ════════════════════════════════════════════════ */}
                    {activeTab === 'visual' && (
                        <>
                            {/* ── SHAPE CONTROLS ───────────────────── */}
                            {onShapeChange && (
                                <div className="tuning-section">
                                    <div className="tuning-section-title">🔷 Shape</div>
                                    <div className="tuning-shape-row">
                                        <label className="tuning-label" htmlFor="tuning-shape-primary">Target</label>
                                        <select
                                            id="tuning-shape-primary"
                                            className="tuning-select"
                                            value={currentShape || 'ring'}
                                            onChange={(e) => { setBlendAmount(0); onShapeChange(e.target.value); }}
                                        >
                                            {MORPH_TARGET_NAMES.map(name => (
                                                <option key={name} value={name}>{name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="tuning-shape-row">
                                        <label className="tuning-label" htmlFor="tuning-shape-blend">Blend To</label>
                                        <select
                                            id="tuning-shape-blend"
                                            className="tuning-select"
                                            value={blendTarget}
                                            onChange={(e) => {
                                                setBlendTarget(e.target.value);
                                                if (blendAmount > 0 && onBlend) onBlend(currentShape || 'ring', e.target.value, blendAmount);
                                            }}
                                        >
                                            {MORPH_TARGET_NAMES.map(name => (
                                                <option key={name} value={name}>{name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="tuning-blend-row">
                                        <div className="tuning-row-header">
                                            <label className="tuning-label" htmlFor="tuning-shape-blend-slider">Blend</label>
                                            <span className="tuning-current-value">{blendAmount.toFixed(2)}</span>
                                        </div>
                                        <input
                                            id="tuning-shape-blend-slider"
                                            className="tuning-slider"
                                            type="range" min={0} max={1} step={0.01}
                                            value={blendAmount}
                                            onChange={(e) => {
                                                const t = parseFloat(e.target.value);
                                                setBlendAmount(t);
                                                if (t === 0) onShapeChange(currentShape || 'ring');
                                                else if (onBlend) onBlend(currentShape || 'ring', blendTarget, t);
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* ── CAMERA TYPE ──────────────────────── */}
                            {onCameraTypeChange && (
                                <div className="tuning-section">
                                    <div className="tuning-section-title">📷 Camera</div>
                                    <div className="tuning-shape-row">
                                        <label className="tuning-label" htmlFor="tuning-camera-type">Projection</label>
                                        <select
                                            id="tuning-camera-type"
                                            className="tuning-select"
                                            value={cameraType || 'perspective'}
                                            onChange={(e) => onCameraTypeChange(e.target.value as CameraType)}
                                        >
                                            <option value="perspective">Perspective</option>
                                            <option value="orthographic">Orthographic</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* ── COLOR MODE ───────────────────────── */}
                            {onColorModeChange && (
                                <div className="tuning-section">
                                    <div className="tuning-section-title">🎨 Color Mode</div>
                                    <div className="tuning-shape-row">
                                        <label className="tuning-label" htmlFor="tuning-color-mode">Mode</label>
                                        <select
                                            id="tuning-color-mode"
                                            className="tuning-select"
                                            value={colorMode || 'white'}
                                            onChange={(e) => onColorModeChange(e.target.value as ColorMode)}
                                        >
                                            <option value="white">White</option>
                                            <option value="color">Color</option>
                                        </select>
                                    </div>
                                    {/* Sentiment toggle — shown only when color mode is active */}
                                    {colorMode === 'color' && onSentimentToggle && (
                                        <div className="tuning-shape-row">
                                            <label className="tuning-label" htmlFor="tuning-sentiment-toggle">
                                                Sentiment Color
                                            </label>
                                            <input
                                                id="tuning-sentiment-toggle"
                                                type="checkbox"
                                                checked={sentimentEnabled ?? false}
                                                onChange={(e) => onSentimentToggle(e.target.checked)}
                                            />
                                        </div>
                                    )}
                                    {/* Sentiment Movement toggle — always visible, any color mode */}
                                    {onSentimentMovementToggle && (
                                        <div className="tuning-shape-row">
                                            <label className="tuning-label" htmlFor="tuning-sentiment-movement-toggle">
                                                Sentiment Movement
                                            </label>
                                            <input
                                                id="tuning-sentiment-movement-toggle"
                                                type="checkbox"
                                                checked={sentimentMovementEnabled ?? false}
                                                onChange={(e) => onSentimentMovementToggle(e.target.checked)}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── AUTO-GENERATED VISUAL SLIDERS ───── */}
                            {Array.from(visualGroups.entries())
                                .filter(([groupName]) => {
                                    // Hide sentiment sliders when feature is off or not color mode
                                    if (groupName === '🎨 Sentiment Color') {
                                        return sentimentEnabled && colorMode === 'color';
                                    }
                                    if (groupName === '🏃 Sentiment Movement') {
                                        return sentimentMovementEnabled ?? false;
                                    }
                                    return true;
                                })
                                .map(([groupName, defs]) => (
                                    <div key={groupName} className="tuning-section">
                                        <div className="tuning-section-title">{groupName}</div>
                                        {defs.map(renderSlider)}
                                    </div>
                                ))}
                        </>
                    )}

                    {/* ════════════════════════════════════════════════ */}
                    {/*  AUDIO TAB                                      */}
                    {/* ════════════════════════════════════════════════ */}
                    {activeTab === 'audio' && (
                        <>


                            {/* ── IDLE RESET ───────────────────────── */}
                            {onIdleReset && (
                                <div className="tuning-section">
                                    <button className="tuning-btn tuning-btn-idle" onClick={onIdleReset}>
                                        ◎ Return to Idle
                                    </button>
                                </div>
                            )}

                            {/* ── AUDIO REACTIVITY GRID ────────────── */}
                            <div className="tuning-section">
                                <div className="tuning-section-title">🎚 Audio Reactivity</div>

                                {/* Column headers */}
                                <div className="tuning-audio-header">
                                    <span className="tuning-audio-header-label">Feature</span>
                                    <span className="tuning-audio-header-col">Influence</span>
                                    <span className="tuning-audio-header-col">Smoothing</span>
                                    <span className="tuning-audio-header-live">Live</span>
                                </div>

                                {Array.from(audioFeatureParams.entries()).map(([featureName, defs]) => {
                                    const influenceDef = defs.find(d => d.key.includes('Influence'));
                                    const smoothingDef = defs.find(d => d.key.includes('Smoothing'));
                                    const liveKey = FEATURE_LIVE_KEYS[featureName];
                                    const liveVal = liveKey ? liveFeatures[liveKey] : 0;

                                    return (
                                        <div key={featureName} className="tuning-audio-row">
                                            <span className="tuning-audio-feature-name">
                                                {AUDIO_FEATURE_LABELS[featureName] || featureName}
                                            </span>

                                            {influenceDef && (
                                                <input
                                                    id={`tuning-${influenceDef.key}`}
                                                    className="tuning-compact-slider"
                                                    type="range"
                                                    min={influenceDef.min}
                                                    max={influenceDef.max}
                                                    step={influenceDef.step}
                                                    value={config.get(influenceDef.key)}
                                                    title={`${AUDIO_FEATURE_LABELS[featureName]} Influence: ${config.get(influenceDef.key).toFixed(1)}`}
                                                    onChange={(e) => config.set(influenceDef.key, parseFloat(e.target.value))}
                                                />
                                            )}

                                            {smoothingDef && (
                                                <input
                                                    id={`tuning-${smoothingDef.key}`}
                                                    className="tuning-compact-slider"
                                                    type="range"
                                                    min={smoothingDef.min}
                                                    max={smoothingDef.max}
                                                    step={smoothingDef.step}
                                                    value={config.get(smoothingDef.key)}
                                                    title={`${AUDIO_FEATURE_LABELS[featureName]} Smoothing: ${config.get(smoothingDef.key).toFixed(2)}`}
                                                    onChange={(e) => config.set(smoothingDef.key, parseFloat(e.target.value))}
                                                />
                                            )}

                                            <span className="tuning-audio-live-badge">
                                                {liveVal.toFixed(2)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* ── CURVE SHAPING ─────────────────────── */}
                            <div className="tuning-section">
                                <div className="tuning-section-title">⚡ Curve Shaping</div>

                                <div className="tuning-shape-row">
                                    <label className="tuning-label" htmlFor="tuning-energy-curve">Energy Curve</label>
                                    <select
                                        id="tuning-energy-curve"
                                        className="tuning-select"
                                        value={config.get('energyCurveMode') === 1 ? 'power' : 'linear'}
                                        onChange={(e) => config.set('energyCurveMode', e.target.value === 'power' ? 1.0 : 0.0)}
                                    >
                                        <option value="linear">Linear (×3.5)</option>
                                        <option value="power">Power (^1.5)</option>
                                    </select>
                                </div>

                                <div className="tuning-shape-row">
                                    <label className="tuning-label" htmlFor="tuning-urgency-curve">Urgency Curve</label>
                                    <select
                                        id="tuning-urgency-curve"
                                        className="tuning-select"
                                        value={config.get('urgencyCurveMode') === 1 ? 'smoothstep' : 'linear'}
                                        onChange={(e) => config.set('urgencyCurveMode', e.target.value === 'smoothstep' ? 1.0 : 0.0)}
                                    >
                                        <option value="linear">Linear (×1.8)</option>
                                        <option value="smoothstep">Smoothstep (threshold)</option>
                                    </select>
                                </div>

                                {config.get('urgencyCurveMode') === 1 && (
                                    <>
                                        <div className="tuning-row">
                                            <div className="tuning-row-header">
                                                <label className="tuning-label" htmlFor="tuning-urgency-thr-low">Threshold Low</label>
                                                <span className="tuning-current-value">{config.get('urgencyThresholdLow').toFixed(2)}</span>
                                            </div>
                                            <input id="tuning-urgency-thr-low" className="tuning-slider" type="range"
                                                min={0} max={1} step={0.05}
                                                value={config.get('urgencyThresholdLow')}
                                                onChange={(e) => config.set('urgencyThresholdLow', parseFloat(e.target.value))} />
                                        </div>
                                        <div className="tuning-row">
                                            <div className="tuning-row-header">
                                                <label className="tuning-label" htmlFor="tuning-urgency-thr-high">Threshold High</label>
                                                <span className="tuning-current-value">{config.get('urgencyThresholdHigh').toFixed(2)}</span>
                                            </div>
                                            <input id="tuning-urgency-thr-high" className="tuning-slider" type="range"
                                                min={0} max={1} step={0.05}
                                                value={config.get('urgencyThresholdHigh')}
                                                onChange={(e) => config.set('urgencyThresholdHigh', parseFloat(e.target.value))} />
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* ── PRESETS (always at bottom of Audio tab) */}
                            <div className="tuning-section tuning-actions">
                                <div className="tuning-section-title">💾 Presets</div>
                                <button className="tuning-btn tuning-btn-reset" onClick={handleReset}>
                                    Reset All to Defaults
                                </button>
                                <button className="tuning-btn tuning-btn-copy" onClick={handleCopy}>
                                    {copyFeedback ? '✓ Copied!' : 'Copy Config (JSON)'}
                                </button>
                                <div className="tuning-paste-group">
                                    <textarea
                                        className="tuning-paste-input"
                                        placeholder="Paste config JSON here..."
                                        value={pasteText}
                                        onChange={(e) => setPasteText(e.target.value)}
                                        rows={3}
                                    />
                                    <button
                                        className="tuning-btn tuning-btn-paste"
                                        onClick={handlePaste}
                                        disabled={!pasteText.trim()}
                                    >Apply Pasted Config</button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
