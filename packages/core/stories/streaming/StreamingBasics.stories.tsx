import type { StoryObj } from '@storybook/react-vite';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { AIMarkdownStreamingCursor } from '../../src/index';
import { WithScheme, type StoryColorScheme } from '../_shared/colorScheme';
import type { CoreMeta } from '../_shared/meta';
import { docsLink } from '../_shared/docsLinks';
import { StreamingReplay, ThemedReplayButton, STREAMING_DEMO_CONTENT } from '../_shared/streaming';
import { getStreamingTheme } from './theme';

/**
 * The entry point for everything under Streaming: one prop, a growing string,
 * and a document that holds its shape while it is still half-written.
 */
const meta: CoreMeta = {
  title: 'Core/Streaming/Streaming Basics',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    // Streaming stories never trial 'error': axe samples the DOM at whatever
    // instant it happens to run, and a heading caught half-typed reports
    // `empty-heading` at random.
    a11y: { test: 'todo' },
    // Mid-stream markup is nondeterministic by construction.
    chromatic: { disableSnapshot: true },
    docs: {
      description: {
        component: [
          'Streaming here means one thing: you keep passing the accumulated text so far as',
          '`content`, and you set `streaming` while more is coming.',
          '',
          '```tsx',
          '<AIMarkdown content={accumulated} streaming={!done} />',
          '```',
          '',
          'There is no append API and no token queue — the component is a pure function of',
          'the string you hand it, which is what makes it safe against retries, edits, and',
          'regenerations. What `streaming` adds is knowledge of *why* the document looks',
          'unfinished: an unclosed fence is a fence still being written rather than a',
          'syntax error, a lone `$$` is the start of a formula rather than two stray',
          'dollars, and a table with one row is a table waiting for its second.',
          '',
          'Underneath, the renderer avoids re-doing work it has already done. The',
          'incremental parser re-parses only the tail below a frozen boundary, and',
          'block-level memoization reuses the React subtree of every block whose source',
          'has not changed. Both are on by default and neither changes a rendered byte —',
          'they are visible only in the profiler, which is what Performance Lab is for.',
          '',
          'The rest of this section builds on that: a cursor that follows the tail, a',
          'typewriter that evens out bursty arrivals, and the incremental parser with its',
          'boundary exposed.',
          '',
          `See ${docsLink('streaming-and-performance', 'streaming & performance')} for the mechanics and`,
          `${docsLink('streaming-chat-example', 'the streaming chat example')} for a full application wiring.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * The replay shell as a real component, so the story's `render` slot stays a
 * plain function and the pacing args have somewhere typed to land.
 */
const StreamingBasicsDemo = ({
  content,
  chunkSizeMin,
  chunkSizeMax,
  chunkDelayMin,
  chunkDelayMax,
  cursor,
  colorScheme,
}: {
  content: string;
  chunkSizeMin: number;
  chunkSizeMax: number;
  chunkDelayMin: number;
  chunkDelayMax: number;
  cursor: boolean;
  colorScheme: StoryColorScheme;
}) => (
  <StreamingReplay
    text={content}
    options={{ chunkSizeMin, chunkSizeMax, chunkDelayMin, chunkDelayMax }}
    style={{ color: getStreamingTheme(colorScheme).text }}
    renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
  >
    {(streamed, streaming) => (
      <AIMarkdown
        content={streamed}
        streaming={streaming}
        colorScheme={colorScheme}
        streamingCursor={cursor ? AIMarkdownStreamingCursor : undefined}
      />
    )}
  </StreamingReplay>
);

/**
 * A document that arrives a few characters at a time. The payload is chosen
 * for the shapes that break naive renderers: inline and block math, a fenced
 * code block, a table, and a blockquote — each one spends several seconds
 * being an incomplete token.
 *
 * Drive the cadence from the controls. Small chunks with long gaps read like a
 * slow model and make the incomplete-token handling easy to watch; large
 * chunks with short gaps read like a fast one. The arrival pattern is
 * generated from a seeded PRNG rather than `Math.random()`, so replaying the
 * same settings replays the same stream — if something looks wrong, you can
 * look at it twice.
 *
 * `streaming` is what the shell passes down while text is still arriving; it
 * flips to `false` on the last chunk, which is also what unmounts the cursor.
 */
export const Demo: StoryObj<typeof StreamingBasicsDemo> = {
  args: {
    content: STREAMING_DEMO_CONTENT,
    chunkSizeMin: 2,
    chunkSizeMax: 8,
    chunkDelayMin: 15,
    chunkDelayMax: 60,
    cursor: true,
  },
  argTypes: {
    content: { control: 'text', description: 'The full document to stream. Paste your own.' },
    chunkSizeMin: { control: { type: 'number', min: 1, max: 200 }, description: 'Smallest chunk, in characters.' },
    chunkSizeMax: { control: { type: 'number', min: 1, max: 200 }, description: 'Largest chunk, in characters.' },
    chunkDelayMin: { control: { type: 'number', min: 0, max: 2000 }, description: 'Shortest gap between chunks (ms).' },
    chunkDelayMax: { control: { type: 'number', min: 0, max: 2000 }, description: 'Longest gap between chunks (ms).' },
    cursor: { control: 'boolean', description: 'Mount the built-in streaming cursor.' },
    colorScheme: { table: { disable: true } },
  },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingBasicsDemo
          content={args.content ?? STREAMING_DEMO_CONTENT}
          chunkSizeMin={args.chunkSizeMin ?? 2}
          chunkSizeMax={args.chunkSizeMax ?? 8}
          chunkDelayMin={args.chunkDelayMin ?? 15}
          chunkDelayMax={args.chunkDelayMax ?? 60}
          cursor={args.cursor ?? true}
          colorScheme={colorScheme}
        />
      )}
    </WithScheme>
  ),
};
