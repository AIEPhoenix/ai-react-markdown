/**
 * Stateful integration smoke for smooth streaming (typewriter pacing).
 *
 * The unit suite (`smoothStream/controller.test.ts`) proves the pacing
 * math on an injected clock, and `useSmoothStream.test.tsx` proves SSR
 * transparency — but neither exercises the REACT wiring under real frames:
 * effect-driven update/finish transitions, `useSyncExternalStore`
 * subscription, drain-then-settle ordering, and the derived `streaming`
 * flag that keeps the cursor mounted while the reveal catches up.
 *
 * Assertions are convergence-only (`waitFor` a settled terminal state) —
 * never a race between the wall clock and reveal timing.
 */

import React, { StrictMode, useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import AIMarkdown, {
  AIMarkdownSmoothStream,
  AIMarkdownStreamingCursor,
  useSmoothStream,
  type SmoothStreamPacing,
} from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { withThemedBackground } from '../decorators';
import { getStreamingTheme } from './theme';
import { StreamingReplay, useStreamedContent, STREAMING_DEMO_CONTENT } from '../streamingHelpers';

/**
 * Instruments the hook layer directly (the shell is a thin composition of
 * this hook, and its prop passthrough is pinned by the SSR unit tests):
 * data attributes expose whether the reveal ever lagged the source, how
 * often it drained, and whether the run has settled.
 */
const SmoothStreamSmoke = ({ theme }: { theme: 'light' | 'dark' }) => {
  const { content, streaming } = useStreamedContent(STREAMING_DEMO_CONTENT, {
    chunkSizeMin: 6,
    chunkSizeMax: 24,
    chunkDelayMin: 10,
    chunkDelayMax: 30,
  });
  const [drains, setDrains] = useState(0);
  const smooth = useSmoothStream({
    content,
    streaming,
    onDrained: () => setDrains((count) => count + 1),
  });
  // Monotonic latch: "the reveal lagged the source at least once". A
  // guarded setState-in-effect is the correct latch shape here (same
  // rationale as useStreamedContent's reset effect). Storybook-smoke
  // instrumentation only.
  const [lagged, setLagged] = useState(false);
  useEffect(() => {
    if (smooth.content.length < content.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLagged(true);
    }
  }, [smooth.content, content]);
  const settled = !streaming && !smooth.streaming && smooth.content === STREAMING_DEMO_CONTENT;
  return (
    <div
      data-testid="smooth-smoke"
      data-lagged={lagged ? 'yes' : 'no'}
      data-drains={drains}
      data-settled={settled ? 'yes' : 'no'}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdown {...smooth} colorScheme={theme} streamingCursor={AIMarkdownStreamingCursor} />
    </div>
  );
};

const ROUND_ONE = 'Multi-round body: streamed, paused for a tool call, then resumed.';
const ROUND_TWO_TAIL = '。';

/**
 * Deterministic two-round script. Round 2 appends a SINGLE grapheme and
 * ends — the round whose only notify is the drain itself. Regression for
 * the drained-latch arming hole: with notify-based arming only, round 2's
 * `onDrained` is swallowed (latch still true from round 1), breaking the
 * documented once-per-round contract.
 */
const MultiRoundSmoke = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phase, setPhase] = useState<{ content: string; streaming: boolean }>({ content: '', streaming: true });
  const [drains, setDrains] = useState(0);
  useEffect(() => {
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    at(50, () => setPhase({ content: ROUND_ONE.slice(0, 12), streaming: true }));
    at(120, () => setPhase({ content: ROUND_ONE, streaming: true }));
    at(400, () => setPhase({ content: ROUND_ONE, streaming: false }));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);
  // Round 2 is GATED on round 1's drain (not a wall-clock offset): a slow
  // runner can delay round 1 arbitrarily without merging the rounds, so
  // the story stays convergence-driven — no race against the reveal.
  useEffect(() => {
    if (drains !== 1) return;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    at(50, () => setPhase({ content: ROUND_ONE + ROUND_TWO_TAIL, streaming: true }));
    at(110, () => setPhase({ content: ROUND_ONE + ROUND_TWO_TAIL, streaming: false }));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [drains]);
  const smooth = useSmoothStream({ ...phase, onDrained: () => setDrains((count) => count + 1) });
  const settled = !phase.streaming && !smooth.streaming && smooth.content === ROUND_ONE + ROUND_TWO_TAIL;
  return (
    <div
      data-testid="multi-round"
      data-drains={drains}
      data-settled={settled ? 'yes' : 'no'}
      style={{ color: getStreamingTheme(theme).text }}
    >
      <AIMarkdown {...smooth} colorScheme={theme} streamingCursor={AIMarkdownStreamingCursor} />
    </div>
  );
};

const meta: Meta<typeof SmoothStreamSmoke> = {
  title: 'Core/Streaming/SmoothStream',
  component: SmoothStreamSmoke,
  decorators: [withThemedBackground],
  parameters: {
    // Mid-reveal markup is nondeterministic by construction.
    chromatic: { disableSnapshot: true },
  },
};
export default meta;

type Story = StoryObj<typeof SmoothStreamSmoke>;

export const Smoke: Story = {
  // StrictMode is deliberate: the dev-build effect replay (mount → cleanup
  // → re-run) disposes and must revive the state-held controller. Guard
  // only where the test runner serves a development React build — the
  // environment-independent pin for the dispose/revive contract is
  // `controller.test.ts` ("StrictMode effect replay" cases).
  render: (_args, context) => (
    <StrictMode>
      <SmoothStreamSmoke theme={context.globals.theme === 'dark' ? 'dark' : 'light'} />
    </StrictMode>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="smooth-smoke"]');
      if (!el) throw new Error('smoke root not mounted');
      return el;
    };
    // Converge: source fully fed AND reveal fully drained.
    await waitFor(() => expect(root().dataset.settled).toBe('yes'), { timeout: 25_000 });
    // The reveal genuinely lagged the source at some point (pacing engaged
    // rather than degenerate instant reveal).
    expect(root().dataset.lagged).toBe('yes');
    // Each catch-up fired the drained edge at least once (the final drain
    // always does; mid-stream catch-ups may add more).
    expect(Number(root().dataset.drains)).toBeGreaterThanOrEqual(1);
    // Settled means the cursor slot is unmounted again.
    expect(root().querySelector('[data-aimd-streaming-indicator]')).toBeNull();
    // And the full document made it to the DOM through the paced path.
    expect(root().textContent).toContain('incomplete tokens');
  },
};

export const MultiRound: Story = {
  render: (_args, context) => (
    <StrictMode>
      <MultiRoundSmoke theme={context.globals.theme === 'dark' ? 'dark' : 'light'} />
    </StrictMode>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="multi-round"]');
      if (!el) throw new Error('multi-round root not mounted');
      return el;
    };
    await waitFor(() => expect(root().dataset.settled).toBe('yes'), { timeout: 20_000 });
    // Once per stream round: the single-grapheme round 2 must fire too.
    await waitFor(() => expect(root().dataset.drains).toBe('2'), { timeout: 5_000 });
  },
};

/**
 * Calibration lane: one preset fed the shared bursty stream, with a live
 * lag readout (chars behind the source). Perceptual tuning tool for the
 * preset parameter bundles — no assertions on purpose.
 */
const PresetLane = ({
  pacing,
  content,
  streaming,
  theme,
}: {
  pacing: SmoothStreamPacing;
  content: string;
  streaming: boolean;
  theme: 'light' | 'dark';
}) => {
  const smooth = useSmoothStream({ content, streaming, pacing });
  const lag = content.length - smooth.content.length;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 8, opacity: 0.75 }}>
        {pacing} · lag {String(lag).padStart(3, ' ')} chars
      </div>
      <AIMarkdown {...smooth} colorScheme={theme} streamingCursor={AIMarkdownStreamingCursor} />
    </div>
  );
};

const PACING_PRESETS: SmoothStreamPacing[] = ['smooth', 'balanced', 'responsive'];

export const PacingCalibration: Story = {
  render: (_args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    const theme = getStreamingTheme(currentTheme);
    return (
      <StreamingReplay
        text={STREAMING_DEMO_CONTENT}
        // Server-buffer-like flushes: large clumps, irregular multi-hundred-ms
        // gaps — the arrival pattern the adaptive law exists to absorb.
        options={{ chunkSizeMin: 40, chunkSizeMax: 120, chunkDelayMin: 150, chunkDelayMax: 450 }}
        style={{ color: theme.text }}
        renderButton={(streaming, restart) => (
          <button
            onClick={restart}
            style={{
              background: streaming ? 'transparent' : theme.primaryBg,
              border: `1px solid ${streaming ? theme.buttonBorder : theme.primaryBg}`,
              borderRadius: 6,
              color: streaming ? theme.buttonText : theme.primaryText,
              cursor: 'pointer',
              font: 'inherit',
              marginBottom: 12,
              padding: '4px 12px',
            }}
          >
            {streaming ? 'Streaming…' : 'Restart'}
          </button>
        )}
      >
        {(content, streaming) => (
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            {PACING_PRESETS.map((pacing) => (
              <PresetLane key={pacing} pacing={pacing} content={content} streaming={streaming} theme={currentTheme} />
            ))}
          </div>
        )}
      </StreamingReplay>
    );
  },
};

export const Demo: Story = {
  render: (_args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    const theme = getStreamingTheme(currentTheme);
    return (
      <StreamingReplay
        text={STREAMING_DEMO_CONTENT}
        // Feed large, bursty chunks: the typewriter smoothing is what keeps
        // the visual cadence steady anyway — that contrast is the demo.
        options={{ chunkSizeMin: 24, chunkSizeMax: 96, chunkDelayMin: 40, chunkDelayMax: 400 }}
        style={{ color: theme.text }}
        renderButton={(streaming, restart) => (
          <button
            onClick={restart}
            style={{
              background: streaming ? 'transparent' : theme.primaryBg,
              border: `1px solid ${streaming ? theme.buttonBorder : theme.primaryBg}`,
              borderRadius: 6,
              color: streaming ? theme.buttonText : theme.primaryText,
              cursor: 'pointer',
              font: 'inherit',
              marginBottom: 12,
              padding: '4px 12px',
            }}
          >
            {streaming ? 'Streaming…' : 'Restart'}
          </button>
        )}
      >
        {(content, streaming) => (
          <AIMarkdownSmoothStream
            content={content}
            streaming={streaming}
            colorScheme={currentTheme}
            streamingCursor={AIMarkdownStreamingCursor}
          />
        )}
      </StreamingReplay>
    );
  },
};
