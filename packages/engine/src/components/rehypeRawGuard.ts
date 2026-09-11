/**
 * `rehypeRaw` with a typed signal for the one failure the engine owns.
 *
 * The raw-HTML expansion step reparses the tree with parse5 and converts the
 * result back to hast through a recursive walk (`hast-util-from-parse5`).
 * That walk's depth is bounded by the INPUT, not by the grammar: a run of a
 * few thousand nested `<div>` tags (about 10 KB of source) exceeds the call
 * stack and the step throws `RangeError: Maximum call stack size exceeded`.
 * Nothing else in the production chain recurses per source byte, so this is
 * the responsible boundary for that failure.
 *
 * The guard catches only that exception, raised inside this step, and
 * rethrows it as `EngineRawHtmlDepthError` with the original error as
 * `cause`. A consumer such as `@ai-markdown/core`'s pipeline session can then
 * degrade the frame to plain text on `instanceof EngineRawHtmlDepthError`
 * and let everything else propagate: a throwing user plugin before or after
 * this step, and any `RangeError` whose message is not a stack overflow
 * (`Invalid array length`, `Invalid string length`), are bugs the consumer
 * must see, not frames to render as text.
 *
 * Firefox reports stack exhaustion as `InternalError: too much recursion`,
 * which is not a `RangeError`; it is deliberately not matched, so on that
 * engine the overflow propagates as it did before this guard existed.
 *
 * The durable fix is a depth cap or an iterative walk in the
 * hast-util-from-parse5 fork, which lives in a separate package.
 *
 * @module components/rehypeRawGuard
 */
import rehypeRaw from '@ai-markdown/rehype-raw';
import type { Options as RehypeRawOptions } from '@ai-markdown/rehype-raw';
import type { Root } from 'hast';
import type { VFile } from 'vfile';

/** Thrown by `rehypeRawGuard` in place of the raw step's stack overflow. */
export class EngineRawHtmlDepthError extends Error {
  override readonly name = 'EngineRawHtmlDepthError';
  constructor(cause: RangeError) {
    super('Raw HTML nesting exceeded the call stack while reparsing the tree', { cause });
  }
}

/** True for the exception V8 and JavaScriptCore raise on stack exhaustion. */
export function isCallStackOverflow(error: unknown): error is RangeError {
  return error instanceof RangeError && /call stack/i.test(error.message);
}

/** `rehypeRaw` whose stack overflow surfaces as `EngineRawHtmlDepthError`;
 *  every other exception propagates unchanged. Same options as `rehypeRaw`. */
export default function rehypeRawGuard(options?: RehypeRawOptions | null): (tree: Root, file: VFile) => Root {
  const transform = rehypeRaw(options);
  return function guarded(tree, file) {
    try {
      return transform(tree, file);
    } catch (error) {
      if (isCallStackOverflow(error)) throw new EngineRawHtmlDepthError(error);
      throw error;
    }
  };
}
