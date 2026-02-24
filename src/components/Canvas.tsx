import { useEffect, useRef, useState, useCallback } from 'react';
import type { TranscriptEvent } from '../services/SpeechEngine';
import { UIOverlay } from './UIOverlay';
import { GhostTitle } from './GhostTitle';
import { TuningPanel } from './TuningPanel';
import type { CameraType, ColorMode } from './TuningPanel';
import { AnalysisPanel } from './AnalysisPanel';
import type { SemanticEvent } from '../services/SemanticBackend';
import { useSingletons } from '../hooks/useSingletons';
import { useThreeScene } from '../hooks/useThreeScene';

const MAX_WEBGL_RETRIES = 3;

export function Canvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Incrementing key forces a fresh <canvas> DOM element on each (re)mount.
    // This sidesteps "existing context of different type" and "precision null"
    // errors that occur when reusing a canvas whose context was just force-lost.
    // Capped at MAX_WEBGL_RETRIES to prevent infinite loops when GPU is disabled.
    const [canvasKey, setCanvasKey] = useState(0);
    const [webglFailed, setWebglFailed] = useState(false);

    const guardedSetCanvasKey: typeof setCanvasKey = (update) => {
        setCanvasKey((prev) => {
            const next = typeof update === 'function' ? update(prev) : update;
            if (next >= MAX_WEBGL_RETRIES) {
                console.error(
                    `[Canvas] WebGL context creation failed after ${MAX_WEBGL_RETRIES} attempts. ` +
                    'Check chrome://gpu — GPU acceleration may be disabled.',
                );
                setWebglFailed(true);
                return prev; // Stop retrying
            }
            return next;
        });
    };

    // React state for UI sync
    const [currentShape, setCurrentShape] = useState('ring');
    const [lastTranscript, setLastTranscript] = useState<TranscriptEvent | null>(null);
    const [lastSemanticEvent, setLastSemanticEvent] = useState<SemanticEvent | null>(null);
    const [cameraType, setCameraType] = useState<CameraType>('orthographic');
    const [colorMode, setColorMode] = useState<ColorMode>('color');
    const [sentimentEnabled, setSentimentEnabled] = useState(true);
    const [sentimentMovementEnabled, setSentimentMovementEnabled] = useState(true);
    const [isServerProcessing, setIsServerProcessing] = useState(false);

    // Service singletons (persist across canvas remounts)
    const singletons = useSingletons();
    const { audioEngine, speechEngine, tuningConfig, workspaceEngine } = singletons;

    // Three.js scene lifecycle (created/destroyed with canvasKey/cameraType)
    const { particleSystem: particleSystemRef, uniformBridge: uniformBridgeRef, semanticBackend: semanticBackendRef, serManager: serManagerRef } =
        useThreeScene(canvasRef, canvasKey, guardedSetCanvasKey, cameraType, singletons);

    // ── SYNC INITIAL UI STATE → UNIFORM BRIDGE ─────────────────────────
    // UniformBridge defaults differ from Canvas's initial React state
    // (e.g., colorMode='white' vs 'color', sentimentEnabled=false vs true).
    // Push the React state into the bridge after it's created so the
    // shader sees the correct values on first frame.
    useEffect(() => {
        if (uniformBridgeRef.current) {
            uniformBridgeRef.current.colorMode = colorMode;
            uniformBridgeRef.current.sentimentEnabled = sentimentEnabled;
            uniformBridgeRef.current.sentimentMovementEnabled = sentimentMovementEnabled;
        }
    }, [uniformBridgeRef, colorMode, sentimentEnabled, sentimentMovementEnabled]);

    // ── SPEECH TRANSCRIPT LOGGING ─────────────────────────────────────────
    useEffect(() => {
        const unsub = speechEngine.onTranscript((event) => {
            const tag = event.isFinal ? '🟢' : '⚪';
            console.log(`${tag} [Canvas] Transcript: "${event.text}" (final=${event.isFinal})`);

            setLastTranscript(event);

            if (event.isFinal && semanticBackendRef.current) {
                const log = semanticBackendRef.current.getEventLog();
                if (log.length > 0) {
                    setLastSemanticEvent(log[log.length - 1]);
                }
            }

            workspaceEngine?.registerSpeech();
        });
        return unsub;
    }, [speechEngine, workspaceEngine, semanticBackendRef]);

    // ── SERVER PROCESSING POLL ─────────────────────────────────────────
    // Poll SemanticBackend.isProcessing every 200ms to drive the UI spinner.
    // Only updates React state when the value actually changes.
    useEffect(() => {
        const id = setInterval(() => {
            const current = semanticBackendRef.current?.isProcessing ?? false;
            setIsServerProcessing((prev) => prev !== current ? current : prev);
        }, 200);
        return () => clearInterval(id);
    }, [semanticBackendRef]);

    // ── SHAPE CHANGE CALLBACKS ────────────────────────────────────────────
    const handleShapeChange = useCallback((shapeName: string) => {
        if (particleSystemRef.current) {
            particleSystemRef.current.setTarget(shapeName);
            setCurrentShape(shapeName);
        }
    }, [particleSystemRef]);

    const handleBlend = useCallback((shapeA: string, shapeB: string, t: number) => {
        if (particleSystemRef.current) {
            particleSystemRef.current.blendTargets(shapeA, shapeB, t);
        }
    }, [particleSystemRef]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {webglFailed ? (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: '100%', color: '#e0e0e0',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    background: '#1a1a1a', padding: '2rem', textAlign: 'center',
                }}>
                    <h2 style={{ color: '#ff6b6b', marginBottom: '1rem' }}>⚠ WebGL Unavailable</h2>
                    <p style={{ maxWidth: '480px', lineHeight: 1.6, marginBottom: '1rem' }}>
                        This experience requires GPU acceleration.
                        Please enable hardware acceleration in your browser settings and reload.
                    </p>
                    <div style={{
                        background: '#2a2a2a', borderRadius: '8px', padding: '1rem',
                        maxWidth: '480px', fontSize: '0.9rem', textAlign: 'left',
                    }}>
                        <p style={{ margin: '0 0 0.5rem', fontWeight: 'bold' }}>How to enable:</p>
                        <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
                            <li>Open your browser&apos;s <strong>Settings</strong></li>
                            <li>Go to <strong>System</strong> (or search for &ldquo;hardware acceleration&rdquo;)</li>
                            <li>Turn on <strong>&ldquo;Use hardware acceleration when available&rdquo;</strong></li>
                            <li>Restart your browser</li>
                        </ol>
                    </div>
                    <button
                        onClick={() => { setWebglFailed(false); setCanvasKey(0); }}
                        style={{
                            marginTop: '1.5rem', padding: '0.5rem 1.5rem',
                            background: '#4a9eff', color: '#fff', border: 'none',
                            borderRadius: '6px', cursor: 'pointer', fontSize: '0.95rem',
                        }}
                    >
                        Retry
                    </button>
                </div>
            ) : (
                <>
                    <GhostTitle />
                    <canvas
                        key={canvasKey}
                        ref={canvasRef}
                        style={{ display: 'block', width: '100%', height: '100%' }}
                    />
                </>
            )}
            <UIOverlay audioEngine={audioEngine} speechEngine={speechEngine} tuningConfig={tuningConfig} isServerProcessing={isServerProcessing} />
            <TuningPanel
                config={tuningConfig}
                audioEngine={audioEngine}
                currentShape={currentShape}
                onShapeChange={handleShapeChange}
                onBlend={handleBlend}
                cameraType={cameraType}
                onCameraTypeChange={setCameraType}
                colorMode={colorMode}
                onColorModeChange={(mode: ColorMode) => {
                    setColorMode(mode);
                    if (uniformBridgeRef.current) {
                        uniformBridgeRef.current.colorMode = mode;
                    }
                }}
                sentimentEnabled={sentimentEnabled}
                onSentimentToggle={(enabled: boolean) => {
                    setSentimentEnabled(enabled);
                    if (uniformBridgeRef.current) {
                        uniformBridgeRef.current.sentimentEnabled = enabled;
                    }
                }}
                sentimentMovementEnabled={sentimentMovementEnabled}
                onSentimentMovementToggle={(enabled: boolean) => {
                    setSentimentMovementEnabled(enabled);
                    if (uniformBridgeRef.current) {
                        uniformBridgeRef.current.sentimentMovementEnabled = enabled;
                    }
                }}
                onIdleReset={() => {
                    if (uniformBridgeRef.current) {
                        uniformBridgeRef.current.resetToIdle();
                    }
                }}
            />
            {/* AnalysisPanel uses direct DOM manipulation for 60fps — not React re-renders.
                Reading refs here is intentional: these values drive imperative updates. */}
            <AnalysisPanel
                audioEngine={audioEngine}
                workspaceEngine={workspaceEngine}
                semanticBackend={semanticBackendRef.current}  /* eslint-disable-line react-hooks/refs */
                particleSystem={particleSystemRef.current}  /* eslint-disable-line react-hooks/refs */
                lastTranscript={lastTranscript}
                lastSemanticEvent={lastSemanticEvent}
                sessionLogger={singletons.sessionLogger}
                speechEngine={speechEngine}
                serActive={serManagerRef.current?.active ?? false}  /* eslint-disable-line react-hooks/refs */
            />
        </div>
    );
}

