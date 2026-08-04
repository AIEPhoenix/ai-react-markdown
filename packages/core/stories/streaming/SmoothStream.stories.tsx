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

import AIMarkdown, { AIMarkdownSmoothStream, AIMarkdownStreamingCursor, useSmoothStream } from '../../src/index';
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
