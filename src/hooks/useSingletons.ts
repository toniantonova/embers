/**
 * useSingletons — Stable service singletons that persist across canvas remounts.
 *
 * These are ref-based singletons because:
 * - AudioEngine, SpeechEngine, TuningConfig must survive WebGL context recovery
 *   (canvasKey bumps cause full canvas teardown/remount)
 * - They hold hardware resources (mic streams, audio contexts) that shouldn't
 *   be recreated on every mount
 */

/* eslint-disable react-hooks/refs -- Intentional: ref-based singletons initialized once during render, stable across remounts */
import { useRef } from 'react';
import { AudioEngine } from '../services/AudioEngine';
import { SpeechEngine } from '../services/SpeechEngine';
import { TuningConfig } from '../services/TuningConfig';
import { KeywordClassifier } from '../services/KeywordClassifier';
import { WorkspaceEngine } from '../engine/WorkspaceEngine';
import { SessionLogger } from '../services/SessionLogger';
import { ServerClient } from '../services/ServerClient';

export interface Singletons {
    audioEngine: AudioEngine;
    speechEngine: SpeechEngine;
    tuningConfig: TuningConfig;
    classifier: KeywordClassifier;
    workspaceEngine: WorkspaceEngine;
    sessionLogger: SessionLogger;
    serverClient: ServerClient | null;
}

export function useSingletons(): Singletons {
    const audioEngine = useRef<AudioEngine | null>(null);
    if (!audioEngine.current) {
        audioEngine.current = new AudioEngine();
    }

    const speechEngine = useRef<SpeechEngine | null>(null);
    if (!speechEngine.current) {
        speechEngine.current = new SpeechEngine();
    }

    const tuningConfig = useRef<TuningConfig | null>(null);
    if (!tuningConfig.current) {
        tuningConfig.current = new TuningConfig();
    }

    // Wire config into AudioEngine so it can read smoothing alphas.
    audioEngine.current.setConfig(tuningConfig.current);

    const classifier = useRef<KeywordClassifier | null>(null);
    if (!classifier.current) {
        classifier.current = new KeywordClassifier();
    }

    const workspaceEngine = useRef<WorkspaceEngine | null>(null);
    if (!workspaceEngine.current) {
        workspaceEngine.current = new WorkspaceEngine();
    }

    const sessionLogger = useRef<SessionLogger | null>(null);
    if (!sessionLogger.current) {
        sessionLogger.current = new SessionLogger();
    }

    const serverClient = useRef<ServerClient | null>(null);
    if (!serverClient.current) {
        const serverUrl = import.meta.env.VITE_LUMEN_SERVER_URL;
        const apiKey = import.meta.env.VITE_LUMEN_API_KEY || '';
        if (serverUrl) {
            serverClient.current = new ServerClient(serverUrl, apiKey);
        }
    }

    return {
        audioEngine: audioEngine.current,
        speechEngine: speechEngine.current,
        tuningConfig: tuningConfig.current,
        classifier: classifier.current,
        workspaceEngine: workspaceEngine.current,
        sessionLogger: sessionLogger.current,
        serverClient: serverClient.current,
    };
}
