/**
 * The raw-HTML expansion step is the only place in the production chain
 * whose recursion depth is bounded by the INPUT rather than by the grammar:
 * `hast-util-from-parse5` walks the reparsed tree recursively, so a run of
 * nested tags deeper than the call stack throws `RangeError: Maximum call
 * stack size exceeded` from inside `rehypeRaw`. The guard turns exactly that
 * exception into a typed `EngineRawHtmlDepthError` so a consumer can degrade
 * the frame, and leaves every other exception (a RangeError with any other
 * message included) untouched.
 */
import { describe, expect, test, vi } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from '@ai-markdown/rehype-raw';
import type { Root } from 'hast';
import rehypeRawGuard, { EngineRawHtmlDepthError } from './rehypeRawGuard';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins, buildCoreRemarkRehypeOptions } from './pluginChain';
import { sanitizeSchema } from './sanitizeSchema';
import { parseStage, transformStage } from './markdown';

const chain = (raw: typeof rehypeRaw) =>
  unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true }).use(raw, { passThrough: [] });
const run = (raw: typeof rehypeRaw, content: string): Root => {
  const processor = chain(raw);
  return processor.runSync(processor.parse(content)) as Root;
};

// Under Node 24's default stack the walk overflows somewhere between 1,900
// and 2,000 nested `<div>` (about 10 KB of source); the exact depth moves
// with JIT state and the frames already on the stack, so the tests use a
// depth well past it and never assert the number.
const nested = '<div>'.repeat(3000) + 'x';

describe('rehypeRawGuard', () => {
  test('produces the same tree as the unguarded step for ordinary raw HTML', () => {
    for (const content of ['plain', '<b>bold</b> and <i>italic</i>', '<div><p>nested</p></div>', '<div>'.repeat(50)])
      expect(run(rehypeRawGuard, content)).toEqual(run(rehypeRaw, content));
  });

  test('the unguarded step overflows on deep nesting and the guard rethrows a typed error carrying it', () => {
    expect(() => run(rehypeRaw, nested)).toThrow(RangeError);
    let caught: unknown;
    try {
      run(rehypeRawGuard, nested);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EngineRawHtmlDepthError);
    const typed = caught as EngineRawHtmlDepthError;
    expect(typed.name).toBe('EngineRawHtmlDepthError');
    expect(typed.cause).toBeInstanceOf(RangeError);
    expect((typed.cause as RangeError).message).toMatch(/call stack/i);
    expect(typed).not.toBeInstanceOf(RangeError);
  });

  test('a RangeError from inside the step that is not a stack overflow propagates unchanged', () => {
    const boom = new RangeError('Invalid array length');
    const throwing = rehypeRawGuard({ passThrough: [] });
    const tree: Root = { type: 'root', children: [] };
    // The step reads `children`; make that read throw from inside the raw walk.
    Object.defineProperty(tree, 'children', {
      get() {
        throw boom;
      },
    });
    let caught: unknown;
    try {
      throwing(tree, {} as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(boom);
  });

  test('an ordinary Error from inside the step propagates unchanged', () => {
    const boom = new Error('plugin boom');
    const throwing = rehypeRawGuard({ passThrough: [] });
    const tree: Root = { type: 'root', children: [] };
    Object.defineProperty(tree, 'children', {
      get() {
        throw boom;
      },
    });
    expect(() => throwing(tree, {} as never)).toThrow(boom);
  });

  test('the production chain reports deep raw nesting as EngineRawHtmlDepthError', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        transformStage(
          parseStage({
            children: nested,
            remarkPlugins: buildCoreRemarkPlugins([]),
            rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, 'guard-', { provenance: 'guard-test' }),
            remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
          })
        )
      ).toThrow(EngineRawHtmlDepthError);
    } finally {
      spy.mockRestore();
    }
  });
});
