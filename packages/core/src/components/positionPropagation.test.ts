/**
 * Validates that hast top-level children retain `position` metadata after
 * passing through the full rehype plugin chain (remark-rehype + rehype-raw +
 * rehype-sanitize + rehype-katex + rehypeRebaseHashLinks + rehype-unwrap-images).
 *
 * This is a load-bearing assumption for Phase 5 block-memo: synthetic nodes
 * (e.g. footnote section) are detected by the absence of `position` after the
 * pipeline runs. If any plugin strips position, the detection breaks.
 *
 * Temporary verification test — delete once Phase 5 is shipped.
 */

import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import { sanitizeSchema } from './sanitizeSchema';
import type { Root, Element } from 'hast';

function runFullPipeline(content: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: '',
    })
    .use(rehypeRaw, { passThrough: [] })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeRebaseHashLinks)
    .use(rehypeKatex)
    .use(rehypeUnwrapImages);

  const file = processor.parse(content);
  return processor.runSync(file, content) as Root;
}

describe('hast position metadata preservation through rehype pipeline', () => {
  test('plain paragraph blocks retain position', () => {
    const hast = runFullPipeline('Hello\n\nWorld');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block.position).toBeDefined();
      expect(block.position?.start.offset).toBeTypeOf('number');
      expect(block.position?.end.offset).toBeTypeOf('number');
    }
  });

  test('heading + paragraph + code block retain position', () => {
    const hast = runFullPipeline('# Title\n\nPara\n\n```js\ncode\n```');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('raw HTML block retains position after rehype-raw + sanitize', () => {
    const hast = runFullPipeline('<h2 id="x">Hello</h2>\n\nPara');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('block with KaTeX math retains position after rehype-katex', () => {
    const hast = runFullPipeline('$$x + y = z$$\n\nPara');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('footnote synthesized section has NO position (key invariant)', () => {
    const hast = runFullPipeline('See[^x].\n\n[^x]: hello');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');

    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const last = blocks[blocks.length - 1];
    expect(last.tagName).toBe('section');
    // dataFootnotes may be '', true, or 'true' across versions — check truthy presence instead
    expect((last.properties as Record<string, unknown>)?.dataFootnotes).toBeDefined();
    expect(last.position).toBeUndefined();

    for (const block of blocks.slice(0, -1)) {
      expect(block.position).toBeDefined();
    }
  });

  test('multi-paragraph doc with raw HTML id and footnotes — combined invariants', () => {
    const md = '<h2 id="t">Title</h2>\n\nIntro[^a].\n\nBody[^b].\n\n[^a]: A\n\n[^b]: B';
    const hast = runFullPipeline(md);
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');

    const realBlocks = blocks.filter((b) => b.position);
    const synthetic = blocks.filter((b) => !b.position);

    expect(synthetic.length).toBe(1);
    expect(synthetic[0].tagName).toBe('section');
    expect((synthetic[0].properties as Record<string, unknown>)?.dataFootnotes).toBeDefined();

    expect(realBlocks.length).toBeGreaterThanOrEqual(3);
  });

  test('thematicBreak + table retain position', () => {
    const md = 'Para\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const hast = runFullPipeline(md);
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });
});
