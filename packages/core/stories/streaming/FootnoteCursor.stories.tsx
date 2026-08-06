/**
 * Streaming-cursor ↔ footnote-definition integration (the tail-marker fix).
 *
 * The unit layers prove the signal (mdast derivation, real-pipeline marker
 * attrs) and the walk (fake-DOM anchor targeting); what needs a real
 * browser is the GEOMETRY: when a definition streams, the indicator must
 * sit inside the footer (previously it blinked at the body tail — the
 * reported bug), come back to the body when prose resumes, target the
 * right `<li>` under out-of-order references, and hide entirely for
 * invisible link-definition tails.
 *
 * Assertions are convergence-only `waitFor`s on rectangle comparisons in a
 * held stream phase — the held phase is stable, so a slow runner delays
 * convergence but cannot corrupt it.
 */

import React, { StrictMode, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import AIMarkdown, { AIMarkdownStreamingCursor } from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { withThemedBackground } from '../decorators';
import { getStreamingTheme } from './theme';
import { StreamingReplay } from '../streamingHelpers';

const BODY = 'Body paragraph with a citation [^1] in it.\n\n';
const DEF_TAIL = '[^1]: A long citation title that keeps on streaming for a while';
const MORE_BODY = '\n\nProse resumes after the definition.';

/** Phase-stepped harness: the play function advances phases via hidden
 *  buttons, so every assertion runs against a HELD, stable stream state. */
const FootnoteTailHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phase, setPhase] = useState<{ content: string; streaming: boolean }>({
    content: BODY,
    streaming: true,
  });
  return (
    <div data-testid="fn-cursor" style={{ color: getStreamingTheme(theme).text }}>
      <button
        data-testid="stream-def"
        style={{ display: 'none' }}
        onClick={() => setPhase({ content: BODY + DEF_TAIL, streaming: true })}
      />
      <button
        data-testid="resume-body"
        style={{ display: 'none' }}
        onClick={() => setPhase({ content: BODY + DEF_TAIL + MORE_BODY, streaming: true })}
      />
      <button
        data-testid="finish"
        style={{ display: 'none' }}
        onClick={() => setPhase((p) => ({ ...p, streaming: false }))}
      />
      <AIMarkdown
        content={phase.content}
        streaming={phase.streaming}
        colorScheme={theme}
        streamingCursor={AIMarkdownStreamingCursor}
      />
    </div>
  );
};

const meta: Meta<typeof FootnoteTailHarness> = {
  title: 'Core/Streaming/FootnoteCursor',
  component: FootnoteTailHarness,
  decorators: [withThemedBackground],
  parameters: {
    chromatic: { disableSnapshot: true },
  },
};
export default meta;

type Story = StoryObj<typeof FootnoteTailHarness>;

const indicator = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-aimd-streaming-indicator]');
const footer = (root: HTMLElement) => root.querySelector<HTMLElement>('section[data-footnotes]');
const click = (root: HTMLElement, id: string) => {
  const btn = root.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (!btn) throw new Error(`${id} button missing`);
  btn.click();
};

export const DefinitionTailAnchorsInFooter: Story = {
  render: (_args, context) => (
    <StrictMode>
      <FootnoteTailHarness theme={context.globals.theme === 'dark' ? 'dark' : 'light'} />
    </StrictMode>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="fn-cursor"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    // Phase 1: body streaming — the indicator sits ABOVE the footer (the
    // footer already exists because the ref's def... does not yet; wait for
    // the indicator itself first).
    await waitFor(() => expect(indicator(root())).not.toBeNull(), { timeout: 15_000 });

    // Phase 2: the definition streams. The indicator must move INSIDE the
    // footer region — before the fix it stayed at the body tail.
    click(root(), 'stream-def');
    await waitFor(
      () => {
        const ind = indicator(root());
        const sect = footer(root());
        expect(ind).not.toBeNull();
        expect(sect).not.toBeNull();
        expect(ind!.getBoundingClientRect().top).toBeGreaterThanOrEqual(sect!.getBoundingClientRect().top);
      },
      { timeout: 15_000 }
    );

    // Phase 3: prose resumes — the indicator returns above the footer.
    click(root(), 'resume-body');
    await waitFor(
      () => {
        const ind = indicator(root());
        const sect = footer(root());
        expect(ind).not.toBeNull();
        expect(sect).not.toBeNull();
        expect(ind!.getBoundingClientRect().top).toBeLessThan(sect!.getBoundingClientRect().top);
      },
      { timeout: 15_000 }
    );

    // Phase 4: stream ends — the indicator unmounts.
    click(root(), 'finish');
    await waitFor(() => expect(indicator(root())).toBeNull(), { timeout: 15_000 });
  },
};

const OO_BODY = 'First [^beta] then [^alpha].\n\n';
const OO_DONE_DEF = '[^alpha]: alpha is complete.\n';
const OO_TAIL = '[^beta]: beta keeps streaming and streaming';

/** Footer li order is FIRST-REFERENCE order: [^beta]'s li is FIRST even
 *  though its definition streams LAST. The indicator must sit inside the
 *  first li — a "last li" anchor would target alpha's completed def. */
const OutOfOrderHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phase] = useState({ content: OO_BODY + OO_DONE_DEF + OO_TAIL, streaming: true });
  return (
    <div data-testid="fn-ooo" style={{ color: getStreamingTheme(theme).text }}>
      <AIMarkdown
        content={phase.content}
        streaming={phase.streaming}
        colorScheme={theme}
        streamingCursor={AIMarkdownStreamingCursor}
      />
    </div>
  );
};

export const OutOfOrderTargetsTheRightLi: Story = {
  render: (_args, context) => (
    <StrictMode>
      <OutOfOrderHarness theme={context.globals.theme === 'dark' ? 'dark' : 'light'} />
    </StrictMode>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="fn-ooo"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    await waitFor(
      () => {
        const ind = indicator(root());
        const lis = root().querySelectorAll<HTMLElement>('section[data-footnotes] li');
        expect(ind).not.toBeNull();
        expect(lis.length).toBe(2);
        const indTop = ind!.getBoundingClientRect().top;
        const beta = lis[0].getBoundingClientRect(); // first-referenced → first li
        // The indicator sits within beta's li (the streaming def), not
        // after alpha's completed one below it.
        expect(indTop).toBeGreaterThanOrEqual(beta.top - 1);
        expect(indTop).toBeLessThan(beta.bottom + 1);
      },
      { timeout: 15_000 }
    );
  },
};

const LINKDEF_TAIL = 'Some body text.\n\n[ref]: https://example.com/still-typing-the-u';

/** A streaming link-reference definition renders nothing: the cursor must
 *  HIDE (before the fix it lingered at the body tail, pointing at prose
 *  that stopped growing). */
const LinkDefHarness = ({ theme }: { theme: 'light' | 'dark' }) => {
  const [phase] = useState({ content: LINKDEF_TAIL, streaming: true });
  return (
    <div data-testid="fn-linkdef" style={{ color: getStreamingTheme(theme).text }}>
      <AIMarkdown
        content={phase.content}
        streaming={phase.streaming}
        colorScheme={theme}
        streamingCursor={AIMarkdownStreamingCursor}
      />
    </div>
  );
};

const CITATION_DOC = `## Research summary

Recent work on adaptive buffering shows measurable gains in perceived latency[^smith2024]. Follow-up studies confirmed the effect across device classes[^lee2025], though replication in embedded contexts remains an open question[^embedded].

The consensus recommendation is to hold roughly one burst of content in the buffer[^smith2024], trading a bounded delay for a steady cadence.

[^smith2024]: Smith, A. et al. (2024). *Adaptive jitter buffering for text streams.* Journal of Interface Latency, 12(3), 45–67. https://example.com/smith2024
[^lee2025]: Lee, B. (2025). *Typewriter pacing in production chat systems.* Proceedings of the Streaming UI Workshop. https://example.com/lee2025
[^embedded]: Preliminary results only — see the workshop notes at https://example.com/embedded-notes for raw data and the replication checklist.
`;

/**
 * THE reported scenario, live: a citation-heavy document streamed token by
 * token, ending in a run of footnote definitions. Watch the cursor follow
 * the body prose, then drop into the footnote footer and track each
 * definition's entry in turn as the model writes it (before the fix it
 * stayed blinking at the body tail throughout the footer stream). Replay
 * with the restart button. No assertions — this is the eyeball story; the
 * geometry pins live in the sibling stories.
 */
export const Demo: Story = {
  render: (_args, context) => {
    const currentTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
    const theme = getStreamingTheme(currentTheme);
    return (
      <StreamingReplay
        text={CITATION_DOC}
        // Small tokens, brisk cadence: slow enough to watch the cursor jump
        // between footer entries, fast enough to replay comfortably.
        options={{ chunkSizeMin: 3, chunkSizeMax: 14, chunkDelayMin: 25, chunkDelayMax: 90 }}
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
          <AIMarkdown
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

export const InvisibleDefinitionHidesTheCursor: Story = {
  render: (_args, context) => (
    <StrictMode>
      <LinkDefHarness theme={context.globals.theme === 'dark' ? 'dark' : 'light'} />
    </StrictMode>
  ),
  play: async ({ canvasElement }) => {
    const root = () => {
      const el = canvasElement.querySelector<HTMLElement>('[data-testid="fn-linkdef"]');
      if (!el) throw new Error('harness not mounted');
      return el;
    };
    // The marker commits with the content; once it is present the shell's
    // next measure hides the indicator. Converge on both.
    await waitFor(
      () => {
        expect(root().querySelector('[data-aimd-tail-kind="invisible-def"]')).not.toBeNull();
        expect(indicator(root())).toBeNull();
      },
      { timeout: 15_000 }
    );
  },
};
