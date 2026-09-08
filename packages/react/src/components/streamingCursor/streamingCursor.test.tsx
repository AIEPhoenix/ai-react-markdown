import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdown, { AIMarkdownStreamingCursor } from '../../index';

// Node-environment coverage: slot gating and SSR shape. Client behavior
// (measurement, positioning, observers, stall styling) needs a real layout
// engine and lives in the StreamingCursor Storybook smoke.

const CONTENT = 'Hello **world**.';

describe('streamingCursor slot', () => {
  test('renders the shell while streaming', () => {
    const html = renderToString(<AIMarkdown content={CONTENT} streaming streamingCursor={AIMarkdownStreamingCursor} />);
    expect(html).toContain('data-aimd-streaming-cursor');
  });

  test('does not render the shell when streaming is false', () => {
    const html = renderToString(
      <AIMarkdown content={CONTENT} streaming={false} streamingCursor={AIMarkdownStreamingCursor} />
    );
    expect(html).not.toContain('data-aimd-streaming-cursor');
  });

  test('omitting the prop leaves the streaming output byte-identical', () => {
    const withUndefined = renderToString(<AIMarkdown content={CONTENT} streaming streamingCursor={undefined} />);
    const without = renderToString(<AIMarkdown content={CONTENT} streaming />);
    expect(withUndefined).toBe(without);
    expect(without).not.toContain('streaming-cursor');
  });

  test('slot renders after the markdown content', () => {
    const html = renderToString(<AIMarkdown content={CONTENT} streaming streamingCursor={AIMarkdownStreamingCursor} />);
    const contentIndex = html.indexOf('world');
    const cursorIndex = html.indexOf('data-aimd-streaming-cursor');
    expect(contentIndex).toBeGreaterThan(-1);
    expect(cursorIndex).toBeGreaterThan(contentIndex);
  });
});

describe('<AIMarkdownStreamingCursor> SSR shape', () => {
  test('server output contains the inert wrapper but no indicator markup', () => {
    const html = renderToString(<AIMarkdown content={CONTENT} streaming streamingCursor={AIMarkdownStreamingCursor} />);
    // Detection needs a real DOM; on the server the holder renders empty —
    // no visible artifact, no hydration jump. Assertions are scoped to the
    // wrapper's own markup (everything from the wrapper attribute onward is
    // shell output — the wrapper is the last rendered element) so they
    // cannot pass vacuously off content markup.
    const wrapperIndex = html.indexOf('data-aimd-streaming-cursor');
    expect(wrapperIndex).toBeGreaterThan(-1);
    const shellHtml = html.slice(wrapperIndex);
    expect(shellHtml).not.toContain('data-aimd-streaming-indicator');
  });

  test('the shell wrapper is aria-hidden', () => {
    const html = renderToString(<AIMarkdown content={CONTENT} streaming streamingCursor={AIMarkdownStreamingCursor} />);
    const wrapperIndex = html.indexOf('data-aimd-streaming-cursor');
    expect(wrapperIndex).toBeGreaterThan(-1);
    // Forward-only window: the wrapper's own tag carries the attribute, so
    // looking backward could match content-side markup instead.
    const snippet = html.slice(wrapperIndex, wrapperIndex + 300);
    expect(snippet).toContain('aria-hidden="true"');
  });
});
