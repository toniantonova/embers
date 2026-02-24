/**
 * TuningPanel.test.tsx — Unit tests for the TuningPanel React component.
 *
 * Tests the two-tab layout (Visual / Audio), slider rendering, action buttons,
 * and live audio value display.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TuningPanel } from '../components/TuningPanel';
import { TuningConfig, PARAM_DEFS } from '../services/TuningConfig';

// ── MOCK AUDIO ENGINE ────────────────────────────────────────────────
function createMockAudioEngine() {
    return {
        getFeatures: vi.fn().mockReturnValue({
            energy: 0, tension: 0, urgency: 0, breathiness: 0,
            flatness: 0, textureComplexity: 0, rolloff: 0,
        }),
        start: vi.fn(),
        stop: vi.fn(),
    } as any;
}

// ── SETUP / TEARDOWN ─────────────────────────────────────────────────
let config: TuningConfig;
let mockAudioEngine: ReturnType<typeof createMockAudioEngine>;

beforeEach(() => {
    localStorage.clear();
    // TuningConfig defaults to complex mode for first-time visitors.
    // Tests assume simple-mode defaults, so explicitly set simple.
    localStorage.setItem('dots-mode', 'simple');
    config = new TuningConfig();
    mockAudioEngine = createMockAudioEngine();
});

afterEach(() => {
    cleanup();
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 1: PANEL VISIBILITY & CONTROLS
// ══════════════════════════════════════════════════════════════════════
describe('TuningPanel — Panel Controls', () => {
    it('renders the gear button', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        const gearBtn = screen.getByLabelText('Toggle tuning panel');
        expect(gearBtn).toBeInTheDocument();
    });

    it('clicking the gear button opens the panel', () => {
        const { container } = render(
            <TuningPanel config={config} audioEngine={mockAudioEngine} />
        );
        const panel = container.querySelector('.tuning-panel');
        expect(panel).not.toHaveClass('open');

        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));
        expect(panel).toHaveClass('open');
    });

    it('clicking the close button closes the panel', () => {
        const { container } = render(
            <TuningPanel config={config} audioEngine={mockAudioEngine} />
        );
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));
        const panel = container.querySelector('.tuning-panel');
        expect(panel).toHaveClass('open');

        fireEvent.click(screen.getByLabelText('Close tuning panel'));
        expect(panel).not.toHaveClass('open');
    });

    it('clicking the overlay closes the panel', () => {
        const { container } = render(
            <TuningPanel config={config} audioEngine={mockAudioEngine} />
        );
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));
        const panel = container.querySelector('.tuning-panel');
        expect(panel).toHaveClass('open');

        const overlay = container.querySelector('.tuning-overlay');
        expect(overlay).toBeInTheDocument();
        fireEvent.click(overlay!);
        expect(panel).not.toHaveClass('open');
    });

    it('renders Visual and Audio tab pills', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));

        expect(screen.getByText('🎨 Visual')).toBeInTheDocument();
        expect(screen.getByText('🎧 Audio')).toBeInTheDocument();
    });

    it('Visual tab is active by default', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));

        const visualPill = screen.getByText('🎨 Visual');
        expect(visualPill).toHaveClass('active');
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 2: VISUAL TAB SLIDERS
// ══════════════════════════════════════════════════════════════════════
describe('TuningPanel — Visual Tab Sliders', () => {
    const visualDefs = PARAM_DEFS.filter(d =>
        ['🔴 Particle Appearance', '🔵 Physics', '🟡 Pointer Interaction', '📷 Camera'].includes(d.group)
    );

    it('renders a slider for every visual parameter', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));

        for (const def of visualDefs) {
            const slider = document.getElementById(`tuning-${def.key}`);
            expect(slider).toBeInTheDocument();
        }
    });

    it('sliders show the correct default values', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));

        const pointSizeSlider = document.getElementById('tuning-pointSize') as HTMLInputElement;
        expect(pointSizeSlider.value).toBe('1');

        const springKSlider = document.getElementById('tuning-springK') as HTMLInputElement;
        expect(springKSlider.value).toBe('3');
    });

    it('moving a slider updates the config value', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));

        const slider = document.getElementById('tuning-pointSize') as HTMLInputElement;
        fireEvent.change(slider, { target: { value: '4.0' } });
        expect(config.get('pointSize')).toBe(4.0);
    });

    it('sliders have correct min, max, and step attributes', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));

        const pointSizeDef = PARAM_DEFS.find(d => d.key === 'pointSize')!;
        const slider = document.getElementById('tuning-pointSize') as HTMLInputElement;

        expect(slider.min).toBe(String(pointSizeDef.min));
        expect(slider.max).toBe(String(pointSizeDef.max));
        expect(slider.step).toBe(String(pointSizeDef.step));
    });

    it('displays visual section headings', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));

        const visualGroupNames = [...new Set(visualDefs.map(d => d.group))];
        for (const group of visualGroupNames) {
            expect(screen.getByText(group)).toBeInTheDocument();
        }
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 3: AUDIO TAB
// ══════════════════════════════════════════════════════════════════════
describe('TuningPanel — Audio Tab', () => {
    function openAudioTab() {
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));
        fireEvent.click(screen.getByText('🎧 Audio'));
    }

    it('renders audio reactivity grid with all 7 features', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        openAudioTab();

        const featureNames = ['Energy', 'Tension', 'Urgency', 'Breathiness', 'Flatness', 'Texture', 'Rolloff'];
        for (const name of featureNames) {
            expect(screen.getByText(name)).toBeInTheDocument();
        }
    });

    it('renders influence and smoothing sliders for each audio feature', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        openAudioTab();

        const audioDefs = PARAM_DEFS.filter(d => d.group === '🎚 Audio Reactivity');
        for (const def of audioDefs) {
            const slider = document.getElementById(`tuning-${def.key}`);
            expect(slider).toBeInTheDocument();
        }
    });

    it('renders curve shaping section', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        openAudioTab();

        expect(screen.getByText('⚡ Curve Shaping')).toBeInTheDocument();
    });


});

// ══════════════════════════════════════════════════════════════════════
// SUITE 4: ACTION BUTTONS (on Audio tab)
// ══════════════════════════════════════════════════════════════════════
describe('TuningPanel — Action Buttons', () => {
    function openAudioTab() {
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));
        fireEvent.click(screen.getByText('🎧 Audio'));
    }

    it('Reset button restores all values to defaults', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        openAudioTab();

        config.set('pointSize', 5.0);
        config.set('springK', 8.0);

        fireEvent.click(screen.getByText('Reset All to Defaults'));
        expect(config.get('pointSize')).toBe(1.0);
        expect(config.get('springK')).toBe(3.0);
    });

    it('Apply Pasted Config button is disabled when textarea is empty', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        openAudioTab();

        const pasteBtn = screen.getByText('Apply Pasted Config');
        expect(pasteBtn).toBeDisabled();
    });

    it('pasting valid JSON and clicking Apply updates config', () => {
        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        openAudioTab();

        const textarea = screen.getByPlaceholderText('Paste config JSON here...');
        const testJson = JSON.stringify({ pointSize: 6.0, springK: 4.0 });
        fireEvent.change(textarea, { target: { value: testJson } });

        fireEvent.click(screen.getByText('Apply Pasted Config'));
        expect(config.get('pointSize')).toBe(6.0);
        expect(config.get('springK')).toBe(4.0);
    });
});

// ══════════════════════════════════════════════════════════════════════
// SUITE 5: LIVE AUDIO VALUES
// ══════════════════════════════════════════════════════════════════════
describe('TuningPanel — Live Audio Values', () => {
    it('displays live audio badges on audio tab', async () => {
        mockAudioEngine.getFeatures.mockReturnValue({
            energy: 0.75, tension: 0.5, urgency: 0.3, breathiness: 0.1,
            flatness: 0, textureComplexity: 0, rolloff: 0,
        });

        render(<TuningPanel config={config} audioEngine={mockAudioEngine} />);
        // Open panel and switch to audio tab
        fireEvent.click(screen.getByLabelText('Toggle tuning panel'));
        fireEvent.click(screen.getByText('🎧 Audio'));

        await vi.waitFor(() => {
            const liveBadges = document.querySelectorAll('.tuning-audio-live-badge');
            expect(liveBadges.length).toBeGreaterThan(0);
        }, { timeout: 200 });
    });
});
