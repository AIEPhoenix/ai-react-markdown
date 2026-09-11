/**
 * The `smartypants` engine plugin is `remarkCjkQuotes` then
 * `remark-smartypants`, and `pangu` runs after both. SmartyPants alone made
 * both quotes of `中文"引号"中文` closers (a CJK character is a word to it);
 * pangu-before-SmartyPants cured that and broke `中文'引号'中文` instead,
 * because pangu pads each straight `'` on its own. The pass here curls the
 * quotes that touch CJK text by pairing, and the pins below are the outputs
 * of the WHOLE display chain — the only thing a reader sees.
 */
import { describe, expect, test } from 'vitest';
import type { Root as HastRoot, RootContent as HastContent } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import remarkMath from 'remark-math';
import remarkPangu from 'remark-pangu';
import remarkParse from 'remark-parse';
import remarkSmartypants from 'remark-smartypants';
import { unified } from 'unified';
import remarkCjkQuotes, { curlCjkQuotes } from './remarkCjkQuotes';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins } from './pluginChain';
import { parseStage, transformStage } from './markdown';
import { sanitizeSchema } from './sanitizeSchema';
import { defaultEnginePlugins, pangu, smartypants } from '../plugins/catalog';
import type { AIMarkdownEnginePlugin } from '../plugins/defs';
import { CATALOG } from './incrementalParse/testPluginCatalog';
import { assertStreamEquivalence, runFull } from './incrementalParse/spliceArbiterHarness';

function textOf(node: HastRoot | HastContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' || node.type === 'root') return node.children.map(textOf).join('');
  return '';
}

function renderHast(markdown: string, enginePlugins: readonly AIMarkdownEnginePlugin[]): HastRoot {
  return transformStage(
    parseStage({
      children: markdown,
      remarkPlugins: buildCoreRemarkPlugins(enginePlugins),
      rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, ''),
      remarkRehypeOptions: { allowDangerousHtml: true, clobberPrefix: '' },
    })
  );
}

function renderText(markdown: string, enginePlugins: readonly AIMarkdownEnginePlugin[] = defaultEnginePlugins): string {
  return textOf(renderHast(markdown, enginePlugins)).trim();
}

/** Unwrap `[plugin, options]` tuples to the plugin function for identity comparison. */
function chainShape(enginePlugins: readonly AIMarkdownEnginePlugin[]): unknown[] {
  return buildCoreRemarkPlugins(enginePlugins).map((entry) => (Array.isArray(entry) ? entry[0] : entry));
}

function mdastOf(markdown: string, plugins: Array<() => (tree: MdastRoot) => void> = []): MdastRoot {
  const processor = unified().use(remarkParse).use(remarkMath);
  for (const plugin of plugins) processor.use(plugin);
  return processor.runSync(processor.parse(markdown)) as MdastRoot;
}

describe('the display chain — quotes beside CJK text', () => {
  // input → output of the whole default chain (removeComments, smartypants,
  // pangu). The pangu spacing around `“…”` is pangu's own rule; it leaves
  // `‘…’` alone.
  const cases: Array<[string, string]> = [
    ['中文"引号"中文', '中文 “引号” 中文'],
    ["中文'引号'中文", '中文‘引号’中文'],
    ["中文 '引号' 中文", '中文 ‘引号’ 中文'],
    ['中文"English"中文', '中文 “English” 中文'],
    ['中文"多"个"引号"了', '中文 “多” 个 “引号” 了'],
    ['English "quote" 中文', 'English “quote” 中文'],
    ['中文"English" 中文"引号"中文', '中文 “English” 中文 “引号” 中文'],
    ['中文"English quote" 中文', '中文 “English quote” 中文'],
    ['中文 "English quote"中文', '中文 “English quote” 中文'],
    ['日本語"引用"です', '日本語 “引用” です'],
    ['한국어"인용"입니다', '한국어“인용”입니다'],
    // Latin prose: SmartyPants' output, unchanged by the pass.
    ["it's", 'it’s'],
    ["'90s", '’90s'],
    ['a"b"c', 'a”b”c'],
    ['"quoted" text', '“quoted” text'],
    ['He said "hello" -- and "quoted" text...', 'He said “hello” — and “quoted” text…'],
  ];
  test.each(cases)('%s', (input, expected) => {
    expect(renderText(input)).toBe(expected);
  });

  test('the pass alone leaves Latin-only quotes untouched for SmartyPants', () => {
    for (const value of ["it's", "'90s", 'a"b"c', '"quoted" text', 'He said "hello"']) {
      expect(curlCjkQuotes(value)).toBeNull();
    }
  });
});

describe('the display chain — unbalanced quotes and CJK punctuation', () => {
  test('an opening quote with no closer stays an opening quote', () => {
    expect(renderText('中文"引号')).toBe('中文 “引号');
    expect(renderText("中文'引号")).toBe('中文‘引号');
  });

  test('a lone quote between two CJK characters opens (pinned: the pair state starts closed)', () => {
    expect(renderText('引号"中文')).toBe('引号 “中文');
    expect(renderText("引号'中文")).toBe('引号‘中文');
  });

  test('a quote after a fullwidth colon opens; one after a fullwidth stop closes', () => {
    expect(renderText('他说："你好。"')).toBe('他说：“你好。”');
    expect(renderText("他说：'你好。'")).toBe('他说：‘你好。’');
  });

  test('a quote before a fullwidth comma closes', () => {
    expect(renderText('中文"引号"，中文')).toBe('中文 “引号”，中文');
  });

  test('quotes inside fullwidth parentheses pair', () => {
    expect(renderText('中文（"引号"）中文')).toBe('中文（“引号”）中文');
  });

  test('a quote ending the node closes even when the pair state is closed', () => {
    expect(curlCjkQuotes('引号"')).toBe('引号”');
    expect(curlCjkQuotes('中文 引号"')).toBe('中文 引号”');
  });

  test('a Latin word before the quote closes it', () => {
    expect(curlCjkQuotes('English"中文')).toBe('English”中文');
  });
});

describe('remarkCjkQuotes — scope', () => {
  test('only text nodes change; inline code, code blocks, html and math keep straight quotes', () => {
    const md = '中文`"code"`中文\n\n```\n中文"引号"中文\n```\n\n<div title="中文">中文"引号"</div>\n\n$$\n"中文"\n$$';
    const tree = mdastOf(md, [remarkCjkQuotes]);
    const values: string[] = [];
    const walk = (node: { type: string; value?: string; children?: unknown[] }): void => {
      if (typeof node.value === 'string') values.push(`${node.type}:${node.value}`);
      for (const child of node.children ?? []) walk(child as never);
    };
    walk(tree as never);
    expect(values).toEqual([
      'text:中文',
      'inlineCode:"code"',
      'text:中文',
      'code:中文"引号"中文',
      'html:<div title="中文">中文"引号"</div>',
      'math:"中文"',
    ]);
  });

  test('pairing is per text node: bold inside a quote splits the run (pinned limitation)', () => {
    // `"引号**强调**"中文` is three text nodes; the third starts with the
    // closing quote, and a quote at the start of a node opens. SmartyPants
    // pairs across nodes for Latin prose; this pass does not.
    expect(renderText('"引号**强调**"中文')).toBe('“引号强调“中文');
    expect(renderText('**强调**"引号"')).toBe('强调“引号”');
  });

  test('positions are preserved and the original node is not mutated', () => {
    const before = mdastOf('中文"引号"中文');
    const after = mdastOf('中文"引号"中文', [remarkCjkQuotes]);
    const textBefore = (before.children[0] as { children: Array<{ value: string; position: unknown }> }).children[0];
    const textAfter = (after.children[0] as { children: Array<{ value: string; position: unknown }> }).children[0];
    expect(textAfter.value).toBe('中文“引号”中文');
    expect(textAfter.position).toEqual(textBefore.position);
    expect(textBefore.value).toBe('中文"引号"中文');
  });

  test('astral CJK (Han extension B) counts as a CJK neighbour', () => {
    expect(curlCjkQuotes('𠀀"引号"𠀀')).toBe('𠀀“引号”𠀀');
  });

  test('the two quote kinds pair independently', () => {
    expect(curlCjkQuotes('中文"引\'号"中文')).toBe('中文“引‘号”中文');
  });

  test('the canonical chain runs the pass before SmartyPants and pangu after both, whatever the caller order', () => {
    for (const selection of [
      [smartypants, pangu],
      [pangu, smartypants],
    ]) {
      const shape = chainShape(selection);
      const iCjk = shape.indexOf(remarkCjkQuotes);
      const iSmarty = shape.indexOf(remarkSmartypants);
      const iPangu = shape.indexOf(remarkPangu);
      expect(iCjk).toBeGreaterThan(-1);
      expect(iSmarty).toBeGreaterThan(iCjk);
      expect(iPangu).toBeGreaterThan(iSmarty);
    }
    // Only the `smartypants` plugin selects the pass.
    const shape = chainShape([pangu]);
    expect(shape).not.toContain(remarkCjkQuotes);
    expect(shape).not.toContain(remarkSmartypants);
    expect(shape).toContain(remarkPangu);
  });
});

describe('remarkCjkQuotes — streaming', () => {
  const config = CATALOG.find((entry) => entry.label === 'defaults-all-on')!;
  const doc =
    '第一段"引号"中文。\n\n他说："你好。" and "Latin" text.\n\n中文\'引号\'中文 and 中文 \'引号\' 中文\n\n中文"多"个"引号"了\n';

  test('char-granular frames are each equal to a full parse, and the last frame is the settled output', () => {
    const frames: string[] = [];
    for (let i = 1; i <= doc.length; i++) frames.push(doc.slice(0, i));
    const stats = assertStreamEquivalence('cjk quotes', frames, config);
    expect(stats.incrementalFrames).toBeGreaterThan(0);
    expect(
      textOf(runFull(doc, config).hast as HastRoot)
        .trim()
        .split('\n')
    ).toEqual([
      '第一段 “引号” 中文。',
      '他说：“你好。” and “Latin” text.',
      '中文‘引号’中文 and 中文 ‘引号’ 中文',
      '中文 “多” 个 “引号” 了',
    ]);
  });
});
