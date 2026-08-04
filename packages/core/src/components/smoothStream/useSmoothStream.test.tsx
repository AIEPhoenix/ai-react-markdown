/**
 * Node-environment coverage: SSR transparency of the smooth-stream shell
 * and the hook's server snapshot. Client pacing behavior (drain animation,
 * onDrained edge, cursor retention) needs real frames and lives in the
 * SmoothStream Storybook smoke.
 */
import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdown, { AIMarkdownSmoothStream, AIMarkdownStreamingCursor } from '../../index';

const CONTENT = '# Title\n\nStreaming **body** with 中文 and `code`.';

describe('<AIMarkdownSmoothStream> SSR', () => {
  test('server output is byte-identical to plain <AIMarkdown> mid-stream', () => {
    // The server snapshot is the full content: no truncated prefix, no
    // hydration mismatch, no typewriter replay on the client.
    const smooth = renderToString(<AIMarkdownSmoothStream content={CONTENT} streaming />);
    const plain = renderToString(<AIMarkdown content={CONTENT} streaming />);
    expect(smooth).toBe(plain);
  });

  test('server output is byte-identical when not streaming', () => {
    const smooth = renderToString(<AIMarkdownSmoothStream content={CONTENT} streaming={false} />);
    const plain = renderToString(<AIMarkdown content={CONTENT} streaming={false} />);
    expect(smooth).toBe(plain);
  });

  test('streaming cursor slot follows the user-facing streaming flag on the server', () => {
    const streamingHtml = renderToString(
      <AIMarkdownSmoothStream content={CONTENT} streaming streamingCursor={AIMarkdownStreamingCursor} />
    );
    const doneHtml = renderToString(
      <AIMarkdownSmoothStream content={CONTENT} streaming={false} streamingCursor={AIMarkdownStreamingCursor} />
    );
    expect(streamingHtml).toContain('data-aimd-streaming-cursor');
    expect(doneHtml).not.toContain('data-aimd-streaming-cursor');
  });

  test('smooth* props do not leak onto the base component or the DOM', () => {
    const smooth = renderToString(
      <AIMarkdownSmoothStream
        content={CONTENT}
        streaming
        smoothCharsPerSecond={80}
        smoothCatchUpWindowMs={400}
        smoothDrainMs={100}
        onSmoothDrained={() => {}}
      />
    );
    const plain = renderToString(<AIMarkdown content={CONTENT} streaming />);
    expect(smooth).toBe(plain);
  });
});
