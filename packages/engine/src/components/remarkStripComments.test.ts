/**
 * The `removeComments` engine plugin strips comment SPANS, not nodes. The
 * previous implementation (`remark-remove-comments`) spliced out any `html`
 * mdast node whose value merely CONTAINED a comment, and an html block is
 * one node up to its blank line — so a `<details>` block with a comment in
 * it, or `<!-- note --> visible text`, rendered as nothing at all.
 */
import { describe, expect, test } from 'vitest';
import type { Root as HastRoot, RootContent as HastContent } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import remarkStripComments from './remarkStripComments';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins } from './pluginChain';
import { parseStage, transformStage } from './markdown';
import { sanitizeSchema } from './sanitizeSchema';
import { removeComments } from '../plugins/catalog';

function mdastOf(markdown: string): MdastRoot {
  const processor = unified().use(remarkParse).use(remarkStripComments);
  return processor.runSync(processor.parse(markdown)) as MdastRoot;
}

/** Render through the production chain with only `removeComments` selected. */
function renderHast(markdown: string): HastRoot {
  return transformStage(
    parseStage({
      children: markdown,
      remarkPlugins: buildCoreRemarkPlugins([removeComments]),
      rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, ''),
      remarkRehypeOptions: { allowDangerousHtml: true, clobberPrefix: '' },
    })
  );
}

function textOf(node: HastRoot | HastContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' || node.type === 'root') return node.children.map(textOf).join('');
  return '';
}

function tagsOf(node: HastRoot | HastContent, out: string[] = []): string[] {
  if (node.type === 'element') out.push(node.tagName);
  if (node.type === 'element' || node.type === 'root') for (const child of node.children) tagsOf(child, out);
  return out;
}

describe('remarkStripComments (mdast)', () => {
  test('a comment-only html node is dropped', () => {
    const tree = mdastOf('Before.\n\n<!-- hidden comment -->\n\nAfter.');
    expect(tree.children.map((c) => c.type)).toEqual(['paragraph', 'paragraph']);
  });

  test('two comments making up one node are dropped together', () => {
    const tree = mdastOf('<!-- a -->\n<!-- b -->\n\nAfter.');
    expect(tree.children.map((c) => c.type)).toEqual(['paragraph']);
  });

  test('only the comment span leaves a mixed html block; the rest keeps its node', () => {
    const tree = mdastOf('<details>\n<summary>Sum</summary>\n<!-- hidden -->\nBody\n</details>');
    expect(tree.children).toHaveLength(1);
    const html = tree.children[0];
    expect(html.type).toBe('html');
    expect(html.type === 'html' && html.value).toBe('<details>\n<summary>Sum</summary>\n\nBody\n</details>');
  });

  test('a leading comment before visible text on the same line', () => {
    const tree = mdastOf('<!-- note --> visible text');
    expect(tree.children).toHaveLength(1);
    const html = tree.children[0];
    expect(html.type === 'html' && html.value).toBe(' visible text');
  });

  test('an inline comment inside a paragraph is dropped, the text around it stays', () => {
    const tree = mdastOf('text <!-- c --> more');
    expect(tree.children).toHaveLength(1);
    const p = tree.children[0];
    expect(p.type === 'paragraph' && p.children.map((c) => c.type)).toEqual(['text', 'text']);
  });

  test('an html node without a comment is left untouched (same object)', () => {
    const processor = unified().use(remarkParse).use(remarkStripComments);
    const parsed = processor.parse('<div>x</div>') as MdastRoot;
    const before = parsed.children[0];
    const tree = processor.runSync(parsed) as MdastRoot;
    expect(tree.children[0]).toBe(before);
  });

  test('an unclosed comment (streaming) is left for rehype-raw to handle', () => {
    const tree = mdastOf('<!-- still open\nmore');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('html');
  });
});

describe('removeComments through the production chain', () => {
  test('the <details> block keeps its summary and body', () => {
    const hast = renderHast('<details>\n<summary>Sum</summary>\n<!-- hidden -->\nBody\n</details>');
    expect(tagsOf(hast)).toEqual(['details', 'summary']);
    const text = textOf(hast);
    expect(text).toContain('Sum');
    expect(text).toContain('Body');
    expect(text).not.toContain('hidden');
  });

  test('visible text after a leading comment renders', () => {
    const text = textOf(renderHast('<!-- note --> visible text'));
    expect(text).toContain('visible text');
    expect(text).not.toContain('note');
  });

  test('a pure comment block still disappears', () => {
    const hast = renderHast('Before.\n\n<!-- hidden comment -->\n\nAfter.');
    expect(tagsOf(hast)).toEqual(['p', 'p']);
    expect(textOf(hast)).not.toContain('hidden');
  });

  test('the sealed plugin selects the local transformer', () => {
    const chain = buildCoreRemarkPlugins([removeComments]).map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    expect(chain).toContain(remarkStripComments);
  });
});
