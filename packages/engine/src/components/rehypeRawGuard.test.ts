/**
 * The raw-HTML expansion step is the engine-owned boundary after which every
 * walker in the production path recurses once per nesting level. The guard
 * bounds the tree's element depth there with an iterative check, so no later
 * recursive walker (sanitize, KaTeX, the planner, the React and Vue
 * renderers) sees a tree that could exhaust its stack, and rethrows the raw
 * step's own stack exhaustion as the same typed error as a safety net.
 *
 * First failing depth on nested `<div>` (`scripts/measure-raw-depth.mjs`,
 * 2026-09-11, Playwright, default stacks, approximate): raw step Chromium
 * ~1920 / Firefox ~8193 / WebKit ~8193; Vue adapter ~1024 / ~2048 / ~4096;
 * React adapter above the raw step in Chromium and WebKit, ~4864 in Firefox.
 * Under Node 24 the raw walk overflows between 1,900 and 2,000 levels. The
 * bound, 256, sits four-fold below the shallowest of these. Nothing here
 * depends on the exact numbers.
 */
import { describe, expect, test, vi } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from '@ai-markdown/rehype-raw';
import type { Root } from 'hast';
import type { Plugin } from 'unified';
import rehypeRawGuard, { EngineRawHtmlDepthError, RAW_HTML_MAX_DEPTH, maxElementDepth } from './rehypeRawGuard';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins, buildCoreRemarkRehypeOptions } from './pluginChain';
import { sanitizeSchema } from './sanitizeSchema';
import { parseStage, transformStage } from './markdown';

const chain = (raw: typeof rehypeRaw) =>
  unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true }).use(raw, { passThrough: [] });
const run = (raw: typeof rehypeRaw, content: string): Root => {
  const processor = chain(raw);
  return processor.runSync(processor.parse(content)) as Root;
};
const nestedDivs = (depth: number) => '<div>'.repeat(depth) + 'x';
const production = (content: string) =>
  transformStage(
    parseStage({
      children: content,
      remarkPlugins: buildCoreRemarkPlugins([]),
      rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, 'guard-', { provenance: 'guard-test' }),
      remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
    })
  );
const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};
// A throwing `children` getter makes the raw step fail from inside its walk.
const failingTree = (error: unknown): Root => {
  const tree: Root = { type: 'root', children: [] };
  Object.defineProperty(tree, 'children', {
    get() {
      throw error;
    },
  });
  return tree;
};

describe('rehypeRawGuard', () => {
  test('produces the same tree as the unguarded step for ordinary raw HTML', () => {
    for (const content of ['plain', '<b>bold</b> and <i>italic</i>', '<div><p>nested</p></div>', nestedDivs(50)])
      expect(run(rehypeRawGuard, content)).toEqual(run(rehypeRaw, content));
  });

  test('maxElementDepth counts element ancestors iteratively', () => {
    expect(maxElementDepth({ type: 'root', children: [] })).toBe(0);
    expect(maxElementDepth(run(rehypeRaw, 'text'))).toBe(1); // <p>
    expect(maxElementDepth(run(rehypeRaw, nestedDivs(7)))).toBe(7);
    // Far past any call stack: the measurement must not recurse.
    let deep: Root['children'][number] = { type: 'text', value: 'x' };
    for (let level = 0; level < 100_000; level++)
      deep = { type: 'element', tagName: 'div', properties: {}, children: [deep] };
    expect(maxElementDepth({ type: 'root', children: [deep] })).toBe(100_000);
  });

  test('depth equal to the bound passes and one level more degrades', () => {
    const atBound = run(rehypeRawGuard, nestedDivs(RAW_HTML_MAX_DEPTH));
    expect(maxElementDepth(atBound)).toBe(RAW_HTML_MAX_DEPTH);
    expect(atBound).toEqual(run(rehypeRaw, nestedDivs(RAW_HTML_MAX_DEPTH)));
    const error = caught(() => run(rehypeRawGuard, nestedDivs(RAW_HTML_MAX_DEPTH + 1)));
    expect(error).toBeInstanceOf(EngineRawHtmlDepthError);
    expect((error as Error).message).toMatch(
      new RegExp(`depth ${RAW_HTML_MAX_DEPTH + 1} exceeds .* ${RAW_HTML_MAX_DEPTH}`)
    );
    expect((error as Error).cause).toBeUndefined();
  });

  test('ordinary deeply nested content renders unchanged through the production chain', () => {
    // 64 levels each of nested lists (ul + li per level), blockquotes and
    // raw divs, and the three combined, all stay well inside the bound.
    const lists = Array.from({ length: 64 }, (_, level) => `${'  '.repeat(level)}- level ${level}`).join('\n');
    const quotes = `${'> '.repeat(64)}deep quote`;
    const divs = `${'<div>'.repeat(64)}text${'</div>'.repeat(64)}`;
    for (const content of [lists, quotes, divs, `${quotes}\n\n${lists}\n\n${divs}`]) {
      const tree = production(content);
      expect(maxElementDepth(tree)).toBeGreaterThan(60);
      expect(maxElementDepth(tree)).toBeLessThanOrEqual(RAW_HTML_MAX_DEPTH);
      expect(JSON.stringify(tree)).toContain(
        content.includes('quote') ? 'deep quote' : content.includes('- ') ? 'level 63' : 'text'
      );
    }
  });

  test('the production chain reports deep raw nesting as EngineRawHtmlDepthError', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const depth of [RAW_HTML_MAX_DEPTH + 1, 3000])
        expect(caught(() => production(nestedDivs(depth)))).toBeInstanceOf(EngineRawHtmlDepthError);
    } finally {
      spy.mockRestore();
    }
  });

  test('the raw step overflowing on its own is rethrown as the typed error carrying the cause', () => {
    // With the bound lifted the walk itself gives out under Node's stack.
    const unbounded = { passThrough: [], maxDepth: Infinity };
    expect(() => run(rehypeRaw, nestedDivs(10_000))).toThrow(RangeError);
    const processor = unified()
      .use(remarkParse)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRawGuard, unbounded);
    const error = caught(() => processor.runSync(processor.parse(nestedDivs(10_000))));
    expect(error).toBeInstanceOf(EngineRawHtmlDepthError);
    expect((error as Error).name).toBe('EngineRawHtmlDepthError');
    expect((error as Error).cause).toBeInstanceOf(RangeError);
    expect(((error as Error).cause as RangeError).message).toMatch(/call stack/i);
    expect(error).not.toBeInstanceOf(RangeError);
  });

  // Firefox has no RangeError for stack exhaustion: it throws InternalError,
  // a constructor that does not exist in Node or the other engines, so the
  // guard must recognise the shape by name and message.
  const firefoxOverflow = () => Object.assign(new Error('too much recursion'), { name: 'InternalError' });
  // JavaScriptCore's text carries a trailing period (verified in WebKit).
  const webkitOverflow = () => new RangeError('Maximum call stack size exceeded.');

  test('browser stack-exhaustion shapes raised inside the step become the typed error', () => {
    for (const make of [firefoxOverflow, webkitOverflow]) {
      const overflow = make();
      const error = caught(() => rehypeRawGuard({ passThrough: [] })(failingTree(overflow), {} as never));
      expect(error).toBeInstanceOf(EngineRawHtmlDepthError);
      expect((error as EngineRawHtmlDepthError).cause).toBe(overflow);
    }
  });

  test('a Firefox-shaped error thrown by a later rehype plugin propagates unchanged', () => {
    const overflow = firefoxOverflow();
    const throwingPlugin: Plugin<[], Root> = () => () => {
      throw overflow;
    };
    const processor = chain(rehypeRawGuard).use(throwingPlugin);
    const error = caught(() => processor.runSync(processor.parse('<b>fine</b>')));
    expect(error).toBe(overflow);
    expect(error).not.toBeInstanceOf(EngineRawHtmlDepthError);
  });

  test('a RangeError from inside the step that is not a stack overflow propagates unchanged', () => {
    const boom = new RangeError('Invalid array length');
    expect(caught(() => rehypeRawGuard({ passThrough: [] })(failingTree(boom), {} as never))).toBe(boom);
  });

  test('an ordinary Error from inside the step propagates unchanged', () => {
    const boom = new Error('plugin boom');
    expect(caught(() => rehypeRawGuard({ passThrough: [] })(failingTree(boom), {} as never))).toBe(boom);
  });
});
