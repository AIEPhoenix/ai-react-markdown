/**
 * End-to-end checks for the default `removeComments` engine plugin through
 * `<AIMarkdown>`. The plugin drops only mdast `html` nodes that are nothing
 * but HTML comments; every other html node reaches rehype-raw (parse5)
 * unchanged, which tokenizes comments correctly (a `<!--` inside a quoted
 * attribute is attribute text) and rehype-sanitize drops the resulting
 * comment nodes.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import AIMarkdown from '..';

describe('AIMarkdown — removeComments', () => {
  test('a comment inside a quoted attribute is attribute text, not a comment', () => {
    const html = renderToStaticMarkup(<AIMarkdown content={'<div title="<!-- keep -->">Body</div>'} />);
    expect(html).toContain('title="&lt;!-- keep --&gt;"');
    expect(html).toContain('Body');
  });

  test('a <details> block with a comment inside keeps its summary and body', () => {
    const html = renderToStaticMarkup(
      <AIMarkdown content={'<details>\n<summary>Sum</summary>\n<!-- hidden -->\nBody\n</details>'} />
    );
    expect(html).toContain('<details>');
    expect(html).toContain('Sum');
    expect(html).toContain('Body');
    expect(html).not.toContain('hidden');
  });

  test('visible text after a leading comment renders', () => {
    const html = renderToStaticMarkup(<AIMarkdown content="<!-- note --> visible text" />);
    expect(html).toContain('visible text');
    expect(html).not.toContain('note');
  });

  test('an inline comment between text leaves the text', () => {
    const html = renderToStaticMarkup(<AIMarkdown content="text <!-- c --> text" />);
    expect(html).toContain('text');
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('c -->');
  });

  test('a comment-only block disappears', () => {
    const html = renderToStaticMarkup(<AIMarkdown content={'Before.\n\n<!-- hidden -->\n\nAfter.'} />);
    expect(html).toContain('Before.');
    expect(html).toContain('After.');
    expect(html).not.toContain('hidden');
  });

  test('comment syntax inside code stays literal', () => {
    const html = renderToStaticMarkup(<AIMarkdown content={'`<!-- x -->`\n\n```\n<!-- y -->\n```'} />);
    expect(html).toContain('&lt;!-- x --&gt;');
    expect(html).toContain('&lt;!-- y --&gt;');
  });
});
