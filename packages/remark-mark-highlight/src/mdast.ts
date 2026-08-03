/**
 * mdast extensions for `==mark==` highlight: from-markdown (build a `mark`
 * node rendered as `<mark>` via `data.hName`, so no custom hast handler is
 * needed downstream) and to-markdown (serialize back to `==…==`).
 *
 * Node shape and serialization rules are pinned against
 * `remark-mark-highlight@0.1.1` (see `parity.test.ts`).
 *
 * @module mdast
 */

import type { Data, Parent, PhrasingContent } from 'mdast';
import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown';
import type { ConstructName, Handle as ToMarkdownHandle, Options as ToMarkdownExtension } from 'mdast-util-to-markdown';

/** A `==highlight==` span, rendered as `<mark>` through `data.hName`.
 *  `data` stays assignable to mdast's `Data` (hProperties/hChildren etc.) so
 *  generic tree visitors that write those fields still compile on `mark`. */
export interface Mark extends Parent {
  type: 'mark';
  children: PhrasingContent[];
  data?: Data & { hName?: 'mark' };
}

declare module 'mdast' {
  interface PhrasingContentMap {
    mark: Mark;
  }
  interface RootContentMap {
    mark: Mark;
  }
}

declare module 'mdast-util-to-markdown' {
  interface ConstructNameMap {
    highlight: 'highlight';
  }
}

/** Constructs inside which a `=` needs no escaping when serializing. */
const constructsWithoutEquals: ConstructName[] = [
  'autolink',
  'destinationLiteral',
  'destinationRaw',
  'reference',
  'titleQuote',
  'titleApostrophe',
];

function enterMark(this: CompileContext, token: Token): undefined {
  this.enter({ type: 'mark', children: [], data: { hName: 'mark' } }, token);
}

function exitMark(this: CompileContext, token: Token): undefined {
  this.exit(token);
}

/** From-markdown extension: map `highlight` tokens to `mark` nodes. */
export const markHighlightFromMarkdown: FromMarkdownExtension = {
  canContainEols: ['mark'],
  enter: { highlight: enterMark },
  exit: { highlight: exitMark },
};

const handleMark: ToMarkdownHandle = function (node: Mark, _, state, info) {
  const tracker = state.createTracker(info);
  const exit = state.enter('highlight');
  let value = tracker.move('==');
  value += state.containerPhrasing(node, { ...tracker.current(), before: value, after: '=' });
  value += tracker.move('==');
  exit();
  return value;
};

(handleMark as ToMarkdownHandle & { peek(): string }).peek = function (): string {
  return '=';
};

/** To-markdown extension: serialize `mark` nodes back to `==…==`. */
export const markHighlightToMarkdown: ToMarkdownExtension = {
  unsafe: [{ character: '=', inConstruct: 'phrasing', notInConstruct: constructsWithoutEquals }],
  handlers: { mark: handleMark },
};
