/**
 * `rehypeRaw` with an explicit nesting bound and a typed signal for the one
 * failure the engine owns.
 *
 * The raw-HTML expansion step reparses the tree with parse5 and converts the
 * result back to hast. From here on every walker in the production path is
 * recursive and bounded by the INPUT, not by the grammar: the converter
 * (`hast-util-from-parse5`), sanitize, KaTeX, the planner and the React and
 * Vue renderers all recurse once per nesting level, and the renderers give
 * out first. A run of a few hundred to a few thousand nested `<div>` tags
 * exhausts the call stack somewhere in that path, and where depends on the
 * engine: Firefox's parser tolerates more depth than Vue's mount does, so a
 * frame the engine parsed without error still took the adapter subtree down.
 *
 * The guard therefore checks the tree ITERATIVELY as soon as the raw step
 * returns it: an explicit-stack walk computes the maximum element nesting
 * depth, and a tree deeper than `RAW_HTML_MAX_DEPTH` is rejected with
 * `EngineRawHtmlDepthError` before any later recursive walker sees it. The
 * bound is set from measurements with a wide margin below the shallowest
 * overflow in Chromium, Firefox and WebKit (see `RAW_HTML_MAX_DEPTH`).
 *
 * As a secondary safety net the raw step itself is also wrapped: should its
 * own recursion overflow before the check runs, that exception, raised
 * inside this step, is rethrown as the same typed error with the original
 * error as `cause`. Stack exhaustion is recognised by error name and
 * message, never by a global constructor: V8 throws `RangeError: Maximum
 * call stack size exceeded`, JavaScriptCore `RangeError: Maximum call stack
 * size exceeded.` (trailing period), and Firefox `InternalError: too much
 * recursion`, whose constructor does not exist in Node or the other engines.
 *
 * A consumer such as `@ai-markdown/core`'s pipeline session degrades the
 * frame to plain text on `instanceof EngineRawHtmlDepthError` and lets
 * everything else propagate: a throwing user plugin before or after this
 * step, and any `RangeError` whose message is not a stack overflow (`Invalid
 * array length`), are bugs the consumer must see, not frames to render as
 * text. Nothing here wraps user render components or arbitrary plugins.
 *
 * @module components/rehypeRawGuard
 */
import rehypeRaw from '@ai-markdown/rehype-raw';
import type { Options as RehypeRawOptions } from '@ai-markdown/rehype-raw';
import type { Nodes, Root } from 'hast';
import type { VFile } from 'vfile';

/**
 * Maximum element nesting depth a frame may carry past the raw-HTML step
 * (root is depth 0; `<div>x</div>` is depth 1; N nested `<div>` is depth N).
 *
 * First failing depth on nested `<div>`, measured with
 * `scripts/measure-raw-depth.mjs` (2026-09-11, Playwright Chromium, Firefox
 * and WebKit, default stacks; stack limits move with JIT state, so read the
 * numbers as approximate):
 *
 *   browser   raw step   Vue adapter   React adapter
 *   Chromium  ~1920      ~1024         > raw (raw step gave out first)
 *   Firefox   ~8193      ~2048         ~4864
 *   WebKit    ~8193      ~4096         > raw (raw step gave out first)
 *
 * The shallowest is Vue in Chromium at about 1024; 256 keeps a four-fold
 * margin below it and stays far above ordinary content: 64 levels of nested
 * lists is depth 128 (`ul` + `li` per level), and a nested blockquote is one
 * level each. A frame deeper than this is hostile or broken, not prose.
 */
export const RAW_HTML_MAX_DEPTH = 256;

/** Thrown by `rehypeRawGuard` for a frame nested deeper than the bound, or
 *  in place of the raw step's own stack overflow (then with a `cause`). */
export class EngineRawHtmlDepthError extends Error {
  override readonly name = 'EngineRawHtmlDepthError';
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
  }
}

/** True for the exception a JavaScript engine raises on stack exhaustion:
 *  V8 and JavaScriptCore `RangeError` naming the call stack, Firefox
 *  `InternalError: too much recursion`. Name and message only. */
export function isStackExhaustion(error: unknown): error is Error {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (typeof name !== 'string' || typeof message !== 'string') return false;
  return (
    (name === 'RangeError' && /call stack/i.test(message)) ||
    (name === 'InternalError' && /too much recursion/i.test(message))
  );
}

/** Maximum element nesting depth of `tree`, computed with an explicit stack
 *  so the measurement itself cannot overflow on the input it measures. */
export function maxElementDepth(tree: Nodes): number {
  let max = 0;
  const stack: Array<[Nodes, number]> = [[tree, 0]];
  while (stack.length > 0) {
    const [node, ancestors] = stack.pop()!;
    const depth = node.type === 'element' ? ancestors + 1 : ancestors;
    if (depth > max) max = depth;
    if ('children' in node) for (const child of node.children) stack.push([child, depth]);
  }
  return max;
}

export interface RehypeRawGuardOptions extends RehypeRawOptions {
  /** Nesting bound; defaults to `RAW_HTML_MAX_DEPTH`. Measurement only. */
  maxDepth?: number;
}

/** `rehypeRaw` followed by the iterative depth check; a frame past the bound
 *  or the step's own stack overflow surfaces as `EngineRawHtmlDepthError`,
 *  every other exception propagates unchanged. */
export default function rehypeRawGuard(options?: RehypeRawGuardOptions | null): (tree: Root, file: VFile) => Root {
  const { maxDepth = RAW_HTML_MAX_DEPTH, ...rawOptions } = options ?? {};
  const transform = rehypeRaw(rawOptions);
  return function guarded(tree, file) {
    let result: Root;
    try {
      result = transform(tree, file);
    } catch (error) {
      if (isStackExhaustion(error))
        throw new EngineRawHtmlDepthError('Raw HTML nesting exhausted the call stack while reparsing the tree', error);
      throw error;
    }
    const depth = maxElementDepth(result);
    if (depth > maxDepth)
      throw new EngineRawHtmlDepthError(`Element nesting depth ${depth} exceeds the engine bound of ${maxDepth}`);
    return result;
  };
}
