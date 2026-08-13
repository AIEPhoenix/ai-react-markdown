import React, { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown, { AIMarkdownDocuments, AIMarkdownStreamingCursor, useDocumentSmoothStream } from '../../src/index';
import '../../src/components/typography/variants/all.scss';
import { useStoryColorScheme, PAGE_PALETTE } from '../_shared/colorScheme';
import { ThemedReplayButton } from '../_shared/streaming';
import { docsLink } from '../_shared/docsLinks';
import { getStreamingTheme } from './theme';

const FIRST =
  'Let me check the retrieval index before answering. Three sources matched, and the top hit was cached, so this came back quickly.';
const SECOND =
  'Based on those sources: throttling is applied per organization rather than per key, so a burst from one worker slows the others down.';

/** The scripted arrival of one answer split into two chat messages. */
interface Phase {
  content: string;
  streaming: boolean;
}

const INITIAL: Phase[] = [
  { content: '', streaming: true },
  { content: '', streaming: true },
];

/**
 * The script. Both messages' *sources* run concurrently, and the second one
 * finishes producing text before the first one is done — which is exactly the
 * situation turn-taking exists for, and exactly what a naive renderer would
 * show out of order.
 */
const SCRIPT: readonly (readonly [number, number, Phase])[] = [
  [60, 0, { content: FIRST.slice(0, 34), streaming: true }],
  [420, 0, { content: FIRST, streaming: true }],
  [900, 0, { content: FIRST, streaming: false }],
  [200, 1, { content: SECOND.slice(0, 40), streaming: true }],
  [520, 1, { content: SECOND, streaming: true }],
  [700, 1, { content: SECOND, streaming: false }],
];

const Bubble = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const scheme = useStoryColorScheme();
  const theme = getStreamingTheme(scheme);
  const style: CSSProperties = {
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 10,
    color: PAGE_PALETTE[scheme].text,
    marginBottom: 12,
    minHeight: '3em',
    padding: '10px 14px',
  };
  return (
    <div>
      <div
        style={{
          color: theme.textMuted,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={style}>{children}</div>
    </div>
  );
};

/** One chat message, revealed through the document-level smooth stream. */
const Message = ({ phase, colorScheme }: { phase: Phase; colorScheme: 'light' | 'dark' }) => {
  const smooth = useDocumentSmoothStream({
    documentId: 'turn-taking-demo',
    content: phase.content,
    streaming: phase.streaming,
  });
  return (
    <AIMarkdown
      {...smooth}
      documentId="turn-taking-demo"
      colorScheme={colorScheme}
      streamingCursor={AIMarkdownStreamingCursor}
    />
  );
};

const TurnTakingChat = () => {
  const colorScheme = useStoryColorScheme();
  const [phases, setPhases] = useState<Phase[]>(INITIAL);
  const [run, setRun] = useState(0);
  const timers = useRef<number[]>([]);

  const restart = useCallback(() => {
    setPhases(INITIAL);
    setRun((n) => n + 1);
  }, []);

  useEffect(() => {
    timers.current = SCRIPT.map(([at, index, phase]) =>
      window.setTimeout(() => setPhases((prev) => prev.map((p, k) => (k === index ? phase : p))), at)
    );
    const ids = timers.current;
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [run]);

  const sourcesDone = phases.every((p) => !p.streaming);

  return (
    <div>
      <ThemedReplayButton streaming={!sourcesDone} onRestart={restart} />
      {/* Remounting on replay resets the coordinator queue along with the
          messages — a fresh run rather than a rewind of a half-finished one. */}
      <AIMarkdownDocuments key={run}>
        <Bubble label="message 1 — source streaming">
          <Message phase={phases[0]} colorScheme={colorScheme} />
        </Bubble>
        <Bubble label="message 2 — source finishes early, reveal waits its turn">
          <Message phase={phases[1]} colorScheme={colorScheme} />
        </Bubble>
      </AIMarkdownDocuments>
    </div>
  );
};

/**
 * Two chat bubbles, one answer, revealed in order.
 */
const meta: Meta<typeof TurnTakingChat> = {
  title: 'Core/Streaming/Turn Taking',
  tags: ['autodocs'],
  component: TurnTakingChat,
  parameters: {
    // Always 'todo' for streaming stories: axe samples whatever the reveal had
    // produced at that instant, and a partially typed line is a legitimately
    // different DOM every run.
    a11y: { test: 'todo' },
    chromatic: { disableSnapshot: true },
    docs: {
      description: {
        component: [
          'A model answer often arrives as several chat messages — a preamble, a tool',
          'call, a conclusion — and their sources overlap. The server does not wait: the',
          'second message can finish producing text while the first is still going. Render',
          'each message independently and the reader watches two typewriters race, or worse,',
          'reads the conclusion before the reasoning.',
          '',
          'Turn-taking fixes the *reveal* order without touching the *arrival* order. Give',
          'the messages a shared `documentId` inside an `<AIMarkdownDocuments>` wrapper, and',
          'each one reveals only after its predecessors have finished revealing. Nothing is',
          'buffered upstream and nothing is delayed on the network — a message that finished',
          'early simply waits for its turn, then plays out at normal speed rather than',
          'snapping into place.',
          '',
          '```tsx',
          'const smooth = useDocumentSmoothStream({ documentId, content, streaming });',
          '',
          '<AIMarkdownDocuments>',
          '  {messages.map((m) => (',
          '    <AIMarkdown key={m.id} {...smoothFor(m)} documentId={documentId} />',
          '  ))}',
          '</AIMarkdownDocuments>',
          '```',
          '',
          'Queues are per `documentId`, so two conversations on one page never wait on each',
          'other. Only messages sharing an id are ordered.',
          '',
          `See ${docsLink('smooth-streaming', 'smooth streaming')} for the pacing model and`,
          `${docsLink('cross-chunk-coordination', 'cross-chunk coordination')} for what else a shared`,
          '`documentId` buys — footnotes and link references resolving across message',
          'boundaries.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Press Restart and watch the second bubble.
 *
 * Its source completes at 700ms — before the first message's source ends at
 * 900ms — so by the time the first bubble is still typing, the second already
 * has its full text in hand. It stays empty anyway. Only once the first bubble
 * has finished revealing does the second begin, and when it does it types out
 * at the normal pace instead of appearing all at once.
 *
 * The streaming cursor is the other thing to watch: there is never more than
 * one on screen. A waiting message is not "streaming" from the reader's point
 * of view, so it shows nothing at all — no cursor, no placeholder, no empty
 * bubble flicker.
 *
 * What this does **not** do is slow the network down. Both sources ran
 * concurrently the whole time; the only thing that waited was the reveal.
 */
export const TwoChunkTurnTaking: StoryObj<typeof TurnTakingChat> = {};
