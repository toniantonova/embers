import React, { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../services/AudioEngine';
import { WorkspaceEngine } from '../engine/WorkspaceEngine';
import { SemanticBackend } from '../services/SemanticBackend';
import type { SemanticEvent } from '../services/SemanticBackend';
import { ParticleSystem } from '../engine/ParticleSystem';
import { SpeechEngine } from '../services/SpeechEngine';
import type { TranscriptEvent } from '../services/SpeechEngine';
import type { SessionLogger } from '../services/SessionLogger';
import {
    accumulateGhostWords,
    cleanupExpiredWords,
    ghostWordOpacity,
} from '../services/GhostTranscript';
import type { GhostWord } from '../services/GhostTranscript';

interface AnalysisPanelProps {
    audioEngine: AudioEngine | null;
    workspaceEngine: WorkspaceEngine | null;
    semanticBackend: SemanticBackend | null;
    particleSystem: ParticleSystem | null;
    lastTranscript: TranscriptEvent | null;
    lastSemanticEvent: SemanticEvent | null;
    sessionLogger: SessionLogger | null;
    speechEngine: SpeechEngine | null;
    serActive: boolean;
}

// Helpers to mutate DOM nodes efficiently
function updateBar(key: string, value: number, barRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>, valRefs: React.MutableRefObject<Record<string, HTMLSpanElement | null>>) {
    const bar = barRefs.current[key];
    const valSpan = valRefs.current[key];
    if (bar && valSpan) {
        const clamped = Math.max(0, Math.min(1, value));
        bar.style.width = (clamped * 100) + '%';
        valSpan.textContent = value.toFixed(2);
    }
}

function updateText(key: string, text: string, refs: React.MutableRefObject<Record<string, HTMLSpanElement | null>>) {
    const span = refs.current[key];
    if (span && span.textContent !== text) {
        span.textContent = text;
    }
}

const GHOST_CLEANUP_MS = 200;

export function AnalysisPanel({
    audioEngine,
    workspaceEngine,
    semanticBackend,
    particleSystem,
    lastTranscript,
    lastSemanticEvent,
    sessionLogger,
    speechEngine,
    serActive
}: AnalysisPanelProps) {

    // ── PANEL TOGGLE STATE ───────────────────────────────────────────
    const [isOpen, setIsOpen] = useState(false);

    // Refs for direct DOM manipulation to avoid React re-renders at 60fps
    const panelRef = useRef<HTMLDivElement>(null);
    const audioRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const audioValRefs = useRef<Record<string, HTMLSpanElement | null>>({});

    const semanticRefs = useRef<Record<string, HTMLSpanElement | null>>({});
    const sentimentBarRef = useRef<HTMLDivElement | null>(null);
    const sentimentValRef = useRef<HTMLSpanElement | null>(null);
    const workspaceRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const workspaceValRefs = useRef<Record<string, HTMLSpanElement | null>>({});
    const breathingRef = useRef<HTMLSpanElement>(null);

    const systemRefs = useRef<Record<string, HTMLSpanElement | null>>({});
    const pipelineRefs = useRef<Record<string, HTMLSpanElement | null>>({});
    const pipelineDotRefs = useRef<Record<string, HTMLSpanElement | null>>({});

    const requestRef = useRef<number>(0);
    const lastFpsTimeRef = useRef<number>(0);
    const framesRef = useRef<number>(0);

    // ── GHOST TRANSCRIPT STATE ───────────────────────────────────────
    const [ghostWords, setGhostWords] = useState<GhostWord[]>([]);
    const ghostIdCounter = useRef(0);
    const ghostScrollRef = useRef<HTMLDivElement>(null);
    const prevTranscriptRef = useRef<string | null>(null);

    // Accumulate words from new final transcripts
    useEffect(() => {
        if (!lastTranscript || !lastTranscript.isFinal) return;
        if (lastTranscript.text === prevTranscriptRef.current) return;
        prevTranscriptRef.current = lastTranscript.text;

        setGhostWords(prev => {
            const result = accumulateGhostWords(prev, lastTranscript, lastSemanticEvent, ghostIdCounter.current);
            ghostIdCounter.current = result.nextId;
            return result.words;
        });
    }, [lastTranscript, lastSemanticEvent]);

    // Auto-scroll ghost transcript to bottom
    useEffect(() => {
        if (ghostScrollRef.current) {
            ghostScrollRef.current.scrollTop = ghostScrollRef.current.scrollHeight;
        }
    }, [ghostWords]);

    // Periodic cleanup of expired ghost words — re-render to update opacity
    useEffect(() => {
        const timer = setInterval(() => {
            setGhostWords(prev => cleanupExpiredWords(prev));
        }, GHOST_CLEANUP_MS);
        return () => clearInterval(timer);
    }, []);


    // Main animation loop for updating values directly in the DOM
    useEffect(() => {
        // Initialize the FPS timer on mount (moved from ref initializer to avoid impure render call)
        if (lastFpsTimeRef.current === 0) lastFpsTimeRef.current = performance.now();
        const updateData = () => {
            // --- AUDIO ---
            if (audioEngine) {
                const features = audioEngine.getFeatures();
                updateBar('energy', features.energy, audioRefs, audioValRefs);
                updateBar('tension', features.tension, audioRefs, audioValRefs);
                updateBar('urgency', features.urgency, audioRefs, audioValRefs);
                updateBar('breathiness', features.breathiness, audioRefs, audioValRefs);
                updateBar('flatness', features.flatness, audioRefs, audioValRefs);
            }

            // --- SEMANTIC ---
            if (semanticBackend) {
                const state = semanticBackend.lastState;
                if (state) {
                    updateText('concept', state.dominantWord, semanticRefs);
                    updateText('hierarchy', semanticBackend.hierarchyLabel || '--', semanticRefs);
                    updateText('abstraction', state.abstractionLevel.toFixed(2), semanticRefs);
                    updateText('confidence', state.confidence.toFixed(2), semanticRefs);
                    updateText('target', state.morphTarget || 'none', semanticRefs);

                    // Sentiment bar — centered origin
                    if (sentimentBarRef.current && sentimentValRef.current) {
                        const s = Math.max(-1, Math.min(1, state.sentiment));
                        const pct = Math.abs(s) * 50; // 0-50% of bar width
                        if (s >= 0) {
                            sentimentBarRef.current.style.left = '50%';
                            sentimentBarRef.current.style.right = 'auto';
                            sentimentBarRef.current.style.width = pct + '%';
                            sentimentBarRef.current.style.backgroundColor = '#ffcc66'; // warm gold
                        } else {
                            sentimentBarRef.current.style.right = '50%';
                            sentimentBarRef.current.style.left = 'auto';
                            sentimentBarRef.current.style.width = pct + '%';
                            sentimentBarRef.current.style.backgroundColor = '#66aaff'; // cool blue
                        }
                        sentimentValRef.current.textContent = (s > 0 ? '+' : '') + s.toFixed(2);
                    }
                } else {
                    updateText('concept', 'none', semanticRefs);
                    updateText('abstraction', '0.00', semanticRefs);
                    updateText('confidence', '0.00', semanticRefs);
                    updateText('target', 'ring', semanticRefs);
                    if (sentimentBarRef.current && sentimentValRef.current) {
                        sentimentBarRef.current.style.width = '0%';
                        sentimentValRef.current.textContent = '0.00';
                    }
                }
            }

            // --- WORKSPACE ---
            if (workspaceEngine) {
                const state = workspaceEngine.getState();
                updateBar('coherence', state.coherence, workspaceRefs, workspaceValRefs);
                updateBar('entropy', state.entropy, workspaceRefs, workspaceValRefs);
                updateBar('arousal', state.arousal, workspaceRefs, workspaceValRefs);

                updateText('idle', (state.timeSinceLastUtterance).toFixed(1) + 's', workspaceValRefs);

                if (breathingRef.current) {
                    // Map sine wave [-1, 1] to opacity [0.2, 1.0]
                    const opacity = 0.2 + ((state.breathingPhase + 1) / 2) * 0.8;
                    breathingRef.current.style.opacity = opacity.toFixed(2);
                }
            }

            // --- SYSTEM ---
            framesRef.current++;
            const now = performance.now();
            if (now - lastFpsTimeRef.current >= 500) {
                const fps = Math.round((framesRef.current * 1000) / (now - lastFpsTimeRef.current));
                updateText('fps', fps.toString(), systemRefs);
                framesRef.current = 0;
                lastFpsTimeRef.current = now;
            }

            if (particleSystem) {
                updateText('particles', '131072', systemRefs);
                updateText('renderer', 'WebGL2', systemRefs);
            }
            if (sessionLogger) {
                updateText('events', sessionLogger.eventCount.toString(), systemRefs);
            }

            // --- PIPELINE ---
            if (speechEngine) {
                const sttLabel = speechEngine.status === 'listening' ? 'active'
                    : speechEngine.status === 'restarting' ? 'restarting'
                        : speechEngine.status === 'error' ? `error: ${speechEngine.lastError}`
                            : speechEngine.status === 'unsupported' ? 'unsupported'
                                : 'off';
                updateText('stt', sttLabel, pipelineRefs);
                const sttDot = pipelineDotRefs.current['stt'];
                if (sttDot) {
                    sttDot.style.backgroundColor = speechEngine.status === 'listening' ? '#4ade80'
                        : speechEngine.status === 'restarting' ? '#fbbf24'
                            : speechEngine.status === 'error' ? '#f87171'
                                : 'rgba(255,255,255,0.3)';
                }
            }
            {
                const serLabel = serActive ? 'active' : 'off';
                updateText('ser', serLabel, pipelineRefs);
                const serDot = pipelineDotRefs.current['ser'];
                if (serDot) {
                    serDot.style.backgroundColor = serActive ? '#4ade80' : 'rgba(255,255,255,0.3)';
                }
            }
            {
                const serverLabel = semanticBackend ? 'connected' : 'offline';
                updateText('server', serverLabel, pipelineRefs);
                const serverDot = pipelineDotRefs.current['server'];
                if (serverDot) {
                    serverDot.style.backgroundColor = semanticBackend ? '#4ade80' : 'rgba(255,255,255,0.3)';
                }
            }

            requestRef.current = requestAnimationFrame(updateData);
        };

        requestRef.current = requestAnimationFrame(updateData);

        return () => {
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
        };
    }, [audioEngine, workspaceEngine, semanticBackend, particleSystem, speechEngine, serActive]);



    return (
        <>
            {/* TOGGLE BUTTON — always visible */}
            <button
                className="analysis-toggle-btn"
                onClick={() => setIsOpen(!isOpen)}
                title="Analysis Panel"
                aria-label="Toggle analysis panel"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="8" width="3" height="7" rx="1" fill="currentColor" opacity="0.7" />
                    <rect x="6.5" y="4" width="3" height="11" rx="1" fill="currentColor" opacity="0.85" />
                    <rect x="12" y="1" width="3" height="14" rx="1" fill="currentColor" />
                </svg>
            </button>

            {/* SLIDE-IN PANEL */}
            <div ref={panelRef} className={`analysis-panel ${isOpen ? 'open' : ''}`}>
                <div className="analysis-panel-header">
                    <span>Analysis</span>
                    <button
                        className="analysis-close-btn"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close analysis panel"
                    >✕</button>
                </div>

                <div className="analysis-panel-content">
                    <Section title="AUDIO">
                        <BarRow label="Energy" barKey="energy" barColor="white" barRefs={audioRefs} valRefs={audioValRefs} />
                        <BarRow label="Tension" barKey="tension" barColor="#00ffff" barRefs={audioRefs} valRefs={audioValRefs} />
                        <BarRow label="Urgency" barKey="urgency" barColor="#ffa500" barRefs={audioRefs} valRefs={audioValRefs} />
                        <BarRow label="Breathiness" barKey="breathiness" barColor="#888888" barRefs={audioRefs} valRefs={audioValRefs} />
                        <BarRow label="Flatness" barKey="flatness" barColor="#ffff00" barRefs={audioRefs} valRefs={audioValRefs} />
                    </Section>

                    <Section title="SEMANTIC">
                        <TextRow label="Concept" textKey="concept" textRefs={semanticRefs} />
                        <TextRow label="Hierarchy" textKey="hierarchy" textRefs={semanticRefs} />
                        <TextRow label="Abstraction" textKey="abstraction" textRefs={semanticRefs} />
                        <TextRow label="Confidence" textKey="confidence" textRefs={semanticRefs} />
                        {/* Sentiment: centered-origin bar (negative=blue left, positive=gold right) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '80px', opacity: 0.7 }}>Sentiment:</span>
                            <div style={{ width: '100px', height: '10px', backgroundColor: 'rgba(255,255,255,0.1)', position: 'relative' }}>
                                {/* Center tick mark */}
                                <div style={{ position: 'absolute', left: '50%', top: 0, width: '1px', height: '100%', backgroundColor: 'rgba(255,255,255,0.3)' }} />
                                <div
                                    ref={(el) => { sentimentBarRef.current = el; }}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        height: '100%',
                                        width: '0%',
                                        transition: 'width 0.15s linear, left 0.15s linear, right 0.15s linear',
                                    }}
                                />
                            </div>
                            <span ref={(el) => { sentimentValRef.current = el; }} style={{ minWidth: '40px', textAlign: 'right' }}>
                                0.00
                            </span>
                        </div>
                        <TextRow label="Target" textKey="target" textRefs={semanticRefs} />
                    </Section>

                    <Section title="WORKSPACE">
                        <BarRow label="Coherence" barKey="coherence" barColor="white" barRefs={workspaceRefs} valRefs={workspaceValRefs} />
                        <BarRow label="Entropy" barKey="entropy" barColor="white" barRefs={workspaceRefs} valRefs={workspaceValRefs} />
                        <BarRow label="Arousal" barKey="arousal" barColor="white" barRefs={workspaceRefs} valRefs={workspaceValRefs} />
                        <TextRow label="Idle" textKey="idle" textRefs={workspaceValRefs} />
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Breathing:</span>
                            <span ref={breathingRef} style={{ transition: 'opacity 0.1s linear' }}>♡</span>
                        </div>
                    </Section>

                    <Section title="TRANSCRIPT">
                        <div
                            ref={ghostScrollRef}
                            style={{
                                minHeight: '3em',
                                maxHeight: '8em',
                                overflowY: 'auto',
                                lineHeight: 1.6,
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '3px',
                                alignContent: 'flex-start',
                            }}
                        >
                            {ghostWords.length > 0 ? (
                                ghostWords.map(gw => {
                                    const opacity = ghostWordOpacity(gw);
                                    return (
                                        <span
                                            key={gw.id}
                                            style={{
                                                opacity,
                                                fontStyle: 'italic',
                                                color: gw.isKeyword ? '#ffcc66' : 'rgba(255,255,255,0.9)',
                                                fontWeight: gw.isKeyword ? 'bold' : 'normal',
                                                transition: 'opacity 0.2s linear',
                                            }}
                                        >
                                            {gw.text}
                                        </span>
                                    );
                                })
                            ) : (
                                <span style={{ opacity: 0.3, fontStyle: 'italic' }}>
                                    {lastTranscript && !lastTranscript.isFinal
                                        ? 'listening…'
                                        : '...'}
                                </span>
                            )}
                        </div>
                    </Section>

                    <Section title="PIPELINE">
                        <StatusRow label="STT" statusKey="stt" textRefs={pipelineRefs} dotRefs={pipelineDotRefs} />
                        <StatusRow label="SER" statusKey="ser" textRefs={pipelineRefs} dotRefs={pipelineDotRefs} />
                        <StatusRow label="Server" statusKey="server" textRefs={pipelineRefs} dotRefs={pipelineDotRefs} />
                    </Section>

                    <Section title="SYSTEM">
                        <TextRow label="FPS" textKey="fps" textRefs={systemRefs} />
                        <TextRow label="Particles" textKey="particles" textRefs={systemRefs} />
                        <TextRow label="Renderer" textKey="renderer" textRefs={systemRefs} />
                        <TextRow label="Events" textKey="events" textRefs={systemRefs} />
                    </Section>

                    {/* Download button — pointer-events: auto since panel content is pointer-events: none */}
                    <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                        <button
                            onClick={() => sessionLogger?.downloadJSON()}
                            style={{
                                pointerEvents: 'auto',
                                width: '100%',
                                padding: '8px',
                                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                borderRadius: '4px',
                                color: 'rgba(255, 255, 255, 0.7)',
                                fontFamily: 'monospace',
                                fontSize: '11px',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
                        >
                            ⬇ Export Session JSON
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

// Sub-components for layout
function Section({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '4px', marginBottom: '4px' }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function BarRow({ label, barKey, barColor, barRefs, valRefs }: { label: string, barKey: string, barColor: string, barRefs: React.RefObject<Record<string, HTMLDivElement | null>>, valRefs: React.RefObject<Record<string, HTMLSpanElement | null>> }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '80px', opacity: 0.7 }}>{label}:</span>
            <div style={{ width: '100px', height: '10px', backgroundColor: 'rgba(255,255,255,0.1)', position: 'relative' }}>
                <div
                    // eslint-disable-next-line react-hooks/immutability -- intentional imperative DOM ref for 60fps updates
                    ref={(el) => { if (barRefs.current) barRefs.current[barKey] = el; }}
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        backgroundColor: barColor,
                        width: '0%',
                        transition: 'width 0.1s linear'
                    }}
                />
            </div>
            {/* eslint-disable-next-line react-hooks/immutability -- intentional imperative DOM ref */}
            <span ref={(el) => { if (valRefs.current) valRefs.current[barKey] = el; }} style={{ minWidth: '32px', textAlign: 'right' }}>
                0.00
            </span>
        </div>
    );
}

function TextRow({ label, textKey, textRefs }: { label: string, textKey: string, textRefs: React.RefObject<Record<string, HTMLSpanElement | null>> }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ opacity: 0.7 }}>{label}:</span>
            {/* eslint-disable-next-line react-hooks/immutability -- intentional imperative DOM ref */}
            <span ref={(el) => { if (textRefs.current) textRefs.current[textKey] = el; }}>--</span>
        </div>
    );
}

function StatusRow({ label, statusKey, textRefs, dotRefs }: {
    label: string,
    statusKey: string,
    textRefs: React.RefObject<Record<string, HTMLSpanElement | null>>,
    dotRefs: React.RefObject<Record<string, HTMLSpanElement | null>>
}) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ opacity: 0.7 }}>{label}:</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {/* eslint-disable-next-line react-hooks/immutability -- intentional imperative DOM ref */}
                <span
                    ref={(el) => { if (dotRefs.current) dotRefs.current[statusKey] = el; }}
                    style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(255,255,255,0.3)',
                        transition: 'background-color 0.3s ease',
                    }}
                />
                {/* eslint-disable-next-line react-hooks/immutability -- intentional imperative DOM ref */}
                <span ref={(el) => { if (textRefs.current) textRefs.current[statusKey] = el; }}>--</span>
            </span>
        </div>
    );
}
