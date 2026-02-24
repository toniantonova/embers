/**
 * TuningConfig.test.ts — Unit tests for the TuningConfig singleton service.
 *
 * WHAT WE'RE TESTING:
 * ───────────────────
 * TuningConfig is the "brain" of the tuning panel. It's a pure logic class
 * with no DOM or React dependency, making it ideal for fast, isolated unit tests.
 *
 * We verify:
 * 1. Default values load correctly from PARAM_DEFS
 * 2. get/set work with value clamping
 * 3. Listener notifications fire correctly
 * 4. Reset returns all values to defaults
 * 5. JSON export/import serialization round-trips correctly
 * 6. localStorage persistence works
 *
 * WHY THESE TESTS MATTER:
 * ──────────────────────
 * TuningConfig is the single source of truth for 20+ parameters across
 * ParticleSystem, AudioEngine, UniformBridge, and the shader uniforms.
 * If get() or set() breaks, the entire visualizer misbehaves. These tests
 * are the safety net that catches regressions early.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TuningConfig, PARAM_DEFS, COMPLEX_OVERRIDES } from '../services/TuningConfig';

// ── HELPERS ──────────────────────────────────────────────────────────
// Clear localStorage before each test so saved values from one test
// don't leak into the next (test isolation principle).
beforeEach(() => {
    localStorage.clear();
    // TuningConfig defaults to complex mode for first-time visitors.
    // Tests assume simple-mode defaults, so explicitly set simple.
    localStorage.setItem('dots-mode', 'simple');
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 1: DEFAULT VALUES
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — Default Values', () => {
    it('returns default values on fresh initialization', () => {
        // ARRANGE & ACT: Create a fresh config (no localStorage data).
        const config = new TuningConfig();

        // ASSERT: Every parameter should match its PARAM_DEFS default.
        for (const def of PARAM_DEFS) {
            expect(config.get(def.key)).toBe(def.defaultValue);
        }
    });

    it('getDefault() returns the correct default for each parameter', () => {
        const config = new TuningConfig();

        // Spot-check a few known defaults.
        expect(config.getDefault('pointSize')).toBe(1.0);
        expect(config.getDefault('springK')).toBe(3.0);
        expect(config.getDefault('drag')).toBe(3.5);
    });

    it('getDefault() returns 0 for unknown keys', () => {
        // Defensive behavior: unknown keys shouldn't crash the system.
        const config = new TuningConfig();
        expect(config.getDefault('nonExistentKey')).toBe(0);
    });

    it('get() falls back to default for unknown keys', () => {
        const config = new TuningConfig();
        expect(config.get('unknownParam')).toBe(0);
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 2: GET / SET WITH CLAMPING
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — Get / Set', () => {
    it('set() stores a value and get() retrieves it', () => {
        const config = new TuningConfig();

        config.set('springK', 5.0);
        expect(config.get('springK')).toBe(5.0);
    });

    it('set() clamps values above the max', () => {
        // pointSize max is 8 — setting 999 should clamp to 8.
        const config = new TuningConfig();

        config.set('pointSize', 999);
        expect(config.get('pointSize')).toBe(8);
    });

    it('set() clamps values below the min', () => {
        // pointSize min is 0.5 — setting -1 should clamp to 0.5.
        const config = new TuningConfig();

        config.set('pointSize', -1);
        expect(config.get('pointSize')).toBe(0.5);
    });

    it('set() accepts values at the exact boundaries', () => {
        const config = new TuningConfig();

        // Min boundary
        config.set('pointSize', 0.5);
        expect(config.get('pointSize')).toBe(0.5);

        // Max boundary
        config.set('pointSize', 8);
        expect(config.get('pointSize')).toBe(8);
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 3: LISTENER NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — Listeners', () => {
    it('notifies listeners when a value changes', () => {
        const config = new TuningConfig();
        // vi.fn() creates a mock function that tracks calls (like Jest's jest.fn()).
        const listener = vi.fn();

        config.onChange(listener);
        config.set('springK', 7.0);

        // Listener should have been called once with the key and clamped value.
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith('springK', 7.0);
    });

    it('unsubscribe stops notifications', () => {
        const config = new TuningConfig();
        const listener = vi.fn();

        const unsub = config.onChange(listener);
        unsub(); // Unsubscribe immediately.

        config.set('springK', 7.0);

        // Listener should NOT have been called after unsubscribing.
        expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple simultaneous listeners', () => {
        const config = new TuningConfig();
        const listenerA = vi.fn();
        const listenerB = vi.fn();

        config.onChange(listenerA);
        config.onChange(listenerB);
        config.set('drag', 3.0);

        expect(listenerA).toHaveBeenCalledTimes(1);
        expect(listenerB).toHaveBeenCalledTimes(1);
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 4: RESET ALL
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — Reset', () => {
    it('resetAll() restores all values to defaults', () => {
        const config = new TuningConfig();

        // Change several values.
        config.set('pointSize', 5.0);
        config.set('springK', 8.0);
        config.set('drag', 1.0);

        // Reset everything.
        config.resetAll();

        // All values should be back to defaults.
        expect(config.get('pointSize')).toBe(1.0);
        expect(config.get('springK')).toBe(3.0);
        expect(config.get('drag')).toBe(3.5);
    });

    it('resetAll() notifies listeners for each parameter', () => {
        const config = new TuningConfig();
        const listener = vi.fn();
        config.onChange(listener);

        config.resetAll();

        // Should be called once for each parameter in PARAM_DEFS.
        expect(listener).toHaveBeenCalledTimes(PARAM_DEFS.length);
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 5: JSON SERIALIZATION
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — JSON Export / Import', () => {
    it('toJSON() exports all parameter values', () => {
        const config = new TuningConfig();
        const json = config.toJSON();

        // Should have an entry for every parameter.
        expect(Object.keys(json).length).toBe(PARAM_DEFS.length);

        // Each value should match the current config value.
        for (const def of PARAM_DEFS) {
            expect(json[def.key]).toBe(config.get(def.key));
        }
    });

    it('fromJSON() imports values correctly', () => {
        const config = new TuningConfig();

        // Import custom values.
        config.fromJSON({
            pointSize: 4.0,
            springK: 6.0,
            drag: 1.5,
        });

        expect(config.get('pointSize')).toBe(4.0);
        expect(config.get('springK')).toBe(6.0);
        expect(config.get('drag')).toBe(1.5);
    });

    it('fromJSON() ignores unknown keys without crashing', () => {
        const config = new TuningConfig();

        // "fakeyParam" doesn't exist in PARAM_DEFS.
        // This should NOT throw or add a new parameter.
        expect(() => {
            config.fromJSON({ fakeyParam: 42 });
        }).not.toThrow();

        // Original values should be unchanged.
        expect(config.get('pointSize')).toBe(1.0);
    });

    it('fromJSON() clamps imported values to valid ranges', () => {
        const config = new TuningConfig();

        // pointSize max is 8, so 100 should be clamped.
        config.fromJSON({ pointSize: 100 });
        expect(config.get('pointSize')).toBe(8);
    });

    it('toJSON() → fromJSON() round-trips correctly', () => {
        // ARRANGE: Modify some values, export, create new config, import.
        const configA = new TuningConfig();
        configA.set('pointSize', 3.0);
        configA.set('springK', 7.0);
        const exported = configA.toJSON();

        // Clear localStorage so configB starts fresh.
        localStorage.clear();
        const configB = new TuningConfig();
        configB.fromJSON(exported);

        // ASSERT: All values match.
        for (const def of PARAM_DEFS) {
            expect(configB.get(def.key)).toBe(configA.get(def.key));
        }
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 6: LOCALSTORAGE PERSISTENCE
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — localStorage Persistence', () => {
    it('saves values to localStorage on set()', () => {
        const config = new TuningConfig();
        config.set('pointSize', 4.0);

        // Check that localStorage has our data.
        const stored = localStorage.getItem('dots-tuning-config');
        expect(stored).not.toBeNull();

        const parsed = JSON.parse(stored!);
        expect(parsed.pointSize).toBe(4.0);
    });

    it('loads saved values from localStorage on construction', () => {
        // ARRANGE: Pre-seed localStorage with custom values.
        const seedData = { pointSize: 6.0, springK: 9.0, __version: 12 };
        localStorage.setItem('dots-tuning-config', JSON.stringify(seedData));

        // ACT: Create a new config — it should pick up the seeded values.
        const config = new TuningConfig();

        // ASSERT
        expect(config.get('pointSize')).toBe(6.0);
        expect(config.get('springK')).toBe(9.0);
    });

    it('handles corrupt localStorage data gracefully', () => {
        // Corrupt data should NOT crash construction — just use defaults.
        localStorage.setItem('dots-tuning-config', 'NOT_VALID_JSON{{{');

        const config = new TuningConfig();

        // Should fall back to defaults.
        expect(config.get('pointSize')).toBe(1.0);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 7: EDGE CASES
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — Edge Cases', () => {
    it('full export→import round-trip preserves every single parameter', () => {
        const configA = new TuningConfig();

        // Modify EVERY parameter to its max value
        for (const def of PARAM_DEFS) {
            configA.set(def.key, def.max);
        }
        const exported = configA.toJSON();

        // Create fresh config and import
        localStorage.clear();
        const configB = new TuningConfig();
        configB.fromJSON(exported);

        // EVERY parameter should match — not just a spot-check
        for (const def of PARAM_DEFS) {
            expect(configB.get(def.key)).toBe(def.max);
        }
    });

    it('set() on an unknown key still stores it without crashing', () => {
        const config = new TuningConfig();

        // Unknown keys bypass clamping but should still be stored
        expect(() => config.set('inventedKey', 42)).not.toThrow();
        expect(config.get('inventedKey')).toBe(42);
    });

    it('listener fires on every set() call even with same value', () => {
        const config = new TuningConfig();
        const listener = vi.fn();
        config.onChange(listener);

        config.set('springK', 5.0);
        config.set('springK', 5.0); // same value again

        // TuningConfig does NOT deduplicate — both calls fire
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('resetAll() followed by toJSON() returns defaults', () => {
        const config = new TuningConfig();

        config.set('pointSize', 7.0);
        config.set('springK', 9.0);
        config.resetAll();

        const json = config.toJSON();
        for (const def of PARAM_DEFS) {
            expect(json[def.key]).toBe(def.defaultValue);
        }
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 8: MOBILE OVERRIDES
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — Mobile Overrides', () => {
    it('applies mobile defaults for pointSize, formationScale, cameraZ', () => {
        const config = new TuningConfig({ isMobile: true });

        expect(config.get('pointSize')).toBe(1.5);
        expect(config.get('formationScale')).toBe(1.1);
        expect(config.get('cameraZ')).toBe(12);
    });

    it('uses standard PARAM_DEFS defaults when not mobile', () => {
        const config = new TuningConfig({ isMobile: false });

        expect(config.get('pointSize')).toBe(1.0);
        expect(config.get('formationScale')).toBe(1.6);
        expect(config.get('cameraZ')).toBe(9);
    });

    it('getDefault() returns mobile defaults when isMobile is true', () => {
        const config = new TuningConfig({ isMobile: true });

        expect(config.getDefault('pointSize')).toBe(1.5);
        expect(config.getDefault('formationScale')).toBe(1.1);
        expect(config.getDefault('cameraZ')).toBe(12);
        // Non-overridden params should still use PARAM_DEFS
        expect(config.getDefault('springK')).toBe(3.0);
    });

    it('resetAll() resets to mobile defaults when isMobile is true', () => {
        const config = new TuningConfig({ isMobile: true });

        config.set('pointSize', 5.0);
        config.set('formationScale', 2.5);
        config.set('cameraZ', 20);

        config.resetAll();

        expect(config.get('pointSize')).toBe(1.5);
        expect(config.get('formationScale')).toBe(1.1);
        expect(config.get('cameraZ')).toBe(12);
    });

    it('localStorage values override mobile defaults', () => {
        // Seed localStorage with user-saved values
        const seedData = { pointSize: 3.0, cameraZ: 15, __version: 12 };
        localStorage.setItem('dots-tuning-config', JSON.stringify(seedData));

        const config = new TuningConfig({ isMobile: true });

        // User's saved values should win over mobile defaults
        expect(config.get('pointSize')).toBe(3.0);
        expect(config.get('cameraZ')).toBe(15);
        // But formationScale should use mobile default (not saved)
        expect(config.get('formationScale')).toBe(1.1);
    });
});


// ══════════════════════════════════════════════════════════════════════
// SUITE 9: COMPLEX MODE SNAPSHOT LIFECYCLE
// ══════════════════════════════════════════════════════════════════════
describe('TuningConfig — Complex Mode Snapshot', () => {

    it('constructor with persisted complex mode builds snapshot (toggle off reverts)', () => {
        // Persist complex mode in localStorage
        localStorage.setItem('dots-mode', 'complex');

        const config = new TuningConfig();

        // Should be in complex mode with overrides applied
        expect(config.complexMode).toBe(true);
        expect(config.get('serverShapeScale')).toBe(COMPLEX_OVERRIDES.serverShapeScale);
        expect(config.get('springK')).toBe(COMPLEX_OVERRIDES.springK);

        // Toggle OFF → should revert to simple defaults (snapshot built in constructor)
        config.complexMode = false;

        // Values should revert to PARAM_DEFS defaults (not stuck at complex overrides)
        const springDefault = PARAM_DEFS.find(d => d.key === 'springK')!.defaultValue;
        expect(config.get('springK')).toBe(springDefault);
    });

    it('toggle on applies overrides and toggle off reverts to user-modified values', () => {
        const config = new TuningConfig();

        // User tweaks springK to 7.0
        config.set('springK', 7.0);

        // Toggle complex ON → should snapshot 7.0 then apply override
        config.complexMode = true;
        expect(config.get('springK')).toBe(COMPLEX_OVERRIDES.springK);

        // Toggle complex OFF → should revert to 7.0 (not the default 3.0)
        config.complexMode = false;
        expect(config.get('springK')).toBe(7.0);
    });

    it('resetAll in complex mode re-applies overrides and rebuilds snapshot', () => {
        const config = new TuningConfig();
        config.complexMode = true;

        // Manually tweak a complex override value
        config.set('springK', 9.0);
        expect(config.get('springK')).toBe(9.0);

        // Reset all → should go back to defaults, then re-apply complex overrides
        config.resetAll();
        expect(config.get('springK')).toBe(COMPLEX_OVERRIDES.springK);

        // Toggle OFF → should revert to the reset defaults (not the manual 9.0)
        config.complexMode = false;
        const springDefault = PARAM_DEFS.find(d => d.key === 'springK')!.defaultValue;
        expect(config.get('springK')).toBe(springDefault);
    });

    it('resetAll in simple mode clears any stale snapshot', () => {
        const config = new TuningConfig();

        // Toggle complex ON then OFF (creates then clears snapshot)
        config.complexMode = true;
        config.complexMode = false;

        // Reset all — should clear any stale snapshot data
        config.resetAll();
        const springDefault = PARAM_DEFS.find(d => d.key === 'springK')!.defaultValue;
        expect(config.get('springK')).toBe(springDefault);

        // Toggle ON again should work without issues
        config.complexMode = true;
        expect(config.get('springK')).toBe(COMPLEX_OVERRIDES.springK);

        config.complexMode = false;
        expect(config.get('springK')).toBe(springDefault);
    });
});
