/**
 * Ambient type declarations for AudioWorklet scope.
 *
 * AudioWorklet processors run in a separate global scope that provides
 * `AudioWorkletProcessor`, `registerProcessor`, and `sampleRate` as
 * built-in globals. TypeScript's standard `lib.dom.d.ts` doesn't include
 * these because they exist in a different global scope than `Window`.
 *
 * This file provides the minimum declarations needed for `audio-worklet.ts`
 * to type-check without errors.
 */

/* eslint-disable @typescript-eslint/no-empty-object-type */

/** Base class for AudioWorklet processors (AudioWorklet global scope). */
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    constructor();
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}

/** Register a processor class in the AudioWorklet scope. */
declare function registerProcessor(
    name: string,
    processorCtor: new () => AudioWorkletProcessor
): void;

/** The sample rate of the AudioContext that owns this worklet (AudioWorklet global). */
declare const sampleRate: number;
