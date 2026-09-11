/**
 * The `removeComments` engine plugin removes mdast `html` NODES whose value
 * is nothing but complete HTML comments (and whitespace). It never edits a
 * node's value.
 *
 * Two earlier designs failed in opposite directions. `remark-remove-comments`
 * spliced out any html node whose value merely CONTAINED a comment, and an
 * html block is one node up to its blank line, so a `<details>` block with a
 * comment in it rendered as nothing. The replacement rewrote comment spans
 * to `''` inside the value: that corrupted `<div title="<!-- keep -->">`
 * (the "comment" is attribute text to parse5) and, because the node kept its
 * `position` while losing bytes, every position hast-util-raw derives for
 * the elements after the removed span was shifted — breaking the splice
 * contract (spliced trees equal a full parse, positions included).
 *
 * Comments embedded in other markup need no mdast surgery: rehype-raw
 * tokenizes them as comment nodes and rehype-sanitize drops those.
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
import { assertStreamEquivalence } from './incrementalParse/spliceArbiterHarness';
import { CATALOG } from './incrementalParse/testPluginCatalog';

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

function findElement(node: HastRoot | HastContent, tagName: string): HastContent | undefined {
  if (node.type === 'element' && node.tagName === tagName) return node;
  if (node.type === 'element' || node.type === 'root') {
    for (const child of node.children) {
      const found = findElement(child, tagName);
      if (found) return found;
    }
  }
  return undefined;
}

/** The plugin leaves the whole tree byte-identical (positions included). */
function htmlNodesUntouched(markdown: string): void {
  const processor = unified().use(remarkParse).use(remarkStripComments);
  const parsed = processor.parse(markdown) as MdastRoot;
  const before = JSON.stringify(parsed);
  const tree = processor.runSync(parsed) as MdastRoot;
  expect(JSON.stringify(tree)).toBe(before);
}

describe('remarkStripComments (mdast)', () => {
  test('a comment-only html block is dropped', () => {
    const tree = mdastOf('Before.\n\n<!-- hidden comment -->\n\nAfter.');
    expect(tree.children.map((c) => c.type)).toEqual(['paragraph', 'paragraph']);
  });

  test('a block of several comments separated by whitespace is dropped', () => {
    const tree = mdastOf('<!-- a --> <!-- b -->\n\nAfter.');
    expect(tree.children.map((c) => c.type)).toEqual(['paragraph']);
  });

  test('consecutive comment-only blocks are all dropped', () => {
    const tree = mdastOf('<!-- a -->\n<!-- b -->\n\nAfter.');
    expect(tree.children.map((c) => c.type)).toEqual(['paragraph']);
  });

  test('an inline comment-only html node is dropped, the text around it stays', () => {
    const tree = mdastOf('text <!-- c --> more');
    expect(tree.children).toHaveLength(1);
    const p = tree.children[0];
    expect(p.type === 'paragraph' && p.children.map((c) => c.type)).toEqual(['text', 'text']);
  });

  test('a mixed html block keeps its node and its value (comment included)', () => {
    htmlNodesUntouched('<details>\n<summary>Sum</summary>\n<!-- hidden -->\nBody\n</details>');
  });

  test('a leading comment before visible text on the same line keeps the node', () => {
    htmlNodesUntouched('<!-- note --> visible text');
  });

  test('comment syntax inside a quoted attribute keeps the node', () => {
    htmlNodesUntouched('<div title="<!-- keep -->">Body</div>');
  });

  test('an html node without a comment is left untouched (same object)', () => {
    const processor = unified().use(remarkParse).use(remarkStripComments);
    const parsed = processor.parse('<div>x</div>') as MdastRoot;
    const before = parsed.children[0];
    const tree = processor.runSync(parsed) as MdastRoot;
    expect(tree.children[0]).toBe(before);
  });

  test('a kept node with a comment in it is the same object', () => {
    const processor = unified().use(remarkParse).use(remarkStripComments);
    const parsed = processor.parse('<!-- note --> visible text') as MdastRoot;
    const before = parsed.children[0];
    const tree = processor.runSync(parsed) as MdastRoot;
    expect(tree.children[0]).toBe(before);
  });

  test('an unclosed comment (streaming) is left alone and does not throw', () => {
    htmlNodesUntouched('<!-- still open\nmore');
    htmlNodesUntouched('<!--');
    htmlNodesUntouched('<!-- a --> <!-- b');
  });

  test('the <!--> and <!---> edge forms are not treated as comment-only', () => {
    htmlNodesUntouched('<!-->\n\nAfter.');
    htmlNodesUntouched('<!--->\n\nAfter.');
  });

  test('a body parse5 would close early (--!> or a nested <!--) is not treated as comment-only', () => {
    htmlNodesUntouched('<!-- a --!> b -->\n\nAfter.');
    htmlNodesUntouched('<!-- a <!--> b -->\n\nAfter.');
  });

  test('comment syntax inside code is not an html node and stays literal', () => {
    const tree = mdastOf('`<!-- x -->`\n\n```\n<!-- y -->\n```');
    expect(tree.children.map((c) => c.type)).toEqual(['paragraph', 'code']);
    const p = tree.children[0];
    expect(p.type === 'paragraph' && p.children[0].type === 'inlineCode' && p.children[0].value).toBe('<!-- x -->');
    const code = tree.children[1];
    expect(code.type === 'code' && code.value).toBe('<!-- y -->');
  });
});

describe('removeComments through the production chain', () => {
  test('a comment inside a quoted attribute survives as attribute text', () => {
    const hast = renderHast('<div title="<!-- keep -->">Body</div>');
    const div = findElement(hast, 'div');
    expect(div?.type === 'element' && div.properties.title).toBe('<!-- keep -->');
    expect(textOf(hast)).toBe('Body');
  });

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

  test('an inline comment between text renders the text only', () => {
    const hast = renderHast('text <!-- c --> text');
    expect(tagsOf(hast)).toEqual(['p']);
    expect(textOf(hast)).toBe('text  text');
  });

  test('a pure comment block still disappears', () => {
    const hast = renderHast('Before.\n\n<!-- hidden comment -->\n\nAfter.');
    expect(tagsOf(hast)).toEqual(['p', 'p']);
    expect(textOf(hast)).not.toContain('hidden');
  });

  test('a multi-comment block disappears', () => {
    const hast = renderHast('Before.\n\n<!-- a --> <!-- b -->\n\nAfter.');
    expect(tagsOf(hast)).toEqual(['p', 'p']);
    expect(textOf(hast)).toBe('Before.\nAfter.');
  });

  test('comment syntax inside code stays literal', () => {
    const hast = renderHast('`<!-- x -->`\n\n```\n<!-- y -->\n```');
    expect(textOf(hast)).toContain('<!-- x -->');
    expect(textOf(hast)).toContain('<!-- y -->');
  });

  test('the sealed plugin selects the local transformer', () => {
    const chain = buildCoreRemarkPlugins([removeComments]).map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    expect(chain).toContain(remarkStripComments);
  });
});

/**
 * Splice parity: with the plugin on, every character-granular frame of a
 * document mixing the shapes above must be deep-equal, positions included,
 * to a full parse of the same snapshot. A plugin that edits html values
 * while keeping the node position cannot pass this.
 */
const MIXED_DOC = [
  'Before.',
  '',
  '<!-- hidden comment -->',
  '',
  '<div title="<!-- keep -->">Body</div>',
  '',
  '<details>',
  '<summary>Sum</summary>',
  '<!-- hidden -->',
  'Body',
  '</details>',
  '',
  '<!-- note --> visible text',
  '',
  'text <!-- c --> text',
  '',
  '<!-- a --> <!-- b -->',
  '',
  '`<!-- x -->`',
  '',
  '```',
  '<!-- y -->',
  '```',
  '',
  'After.',
  '',
].join('\n');

function charSnapshots(doc: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= doc.length; i++) out.push(doc.slice(0, i));
  return out;
}

const REMOVE_COMMENTS_CONFIGS = CATALOG.filter((c) => c.removeComments);

describe('removeComments splice parity', () => {
  test.each(REMOVE_COMMENTS_CONFIGS)('char-granular stream equals a full parse at every frame [$label]', (config) => {
    const stats = assertStreamEquivalence('remove-comments-mixed', charSnapshots(MIXED_DOC), config, {
      // 180 of 253 frames spliced when this was written; the floor guards
      // against the pin going vacuous.
      minIncrementalFrames: 100,
    });
    expect(stats.frames).toBe(MIXED_DOC.length);
  });
});
