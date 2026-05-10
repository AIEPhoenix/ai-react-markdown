'use client';

/**
 * Spy `customComponents` that count React component-function invocations
 * per tag — a user-space, dependency-free analogue of react-scan's render
 * tracking, scoped to a single AIMarkdown subtree.
 *
 * When block-memo holds a cached subtree for a block, the returned
 * `ReactNode` reference is the SAME as last frame's. React's reconciler
 * compares element refs (`Object.is`), takes the early-bailout path, and
 * never invokes the children's component functions — so spy components
 * inside that subtree are NOT called, and `record` is NOT triggered.
 *
 * Conversely, without block-memo every commit produces a fresh element
 * tree; React re-invokes every component function in the subtree, and
 * `record` fires once per element.
 *
 * The DIFFERENCE between two sides under identical content streams is the
 * cleanest possible view of "what block-memo saves at the component
 * level."
 *
 * ## Implementation notes
 *
 * The spy must be a *real* object (not a Proxy). `<AIMarkdownContent>`
 * merges `customComponents` into a base object via spread — `{ ...defaults,
 * ...customComponents }` — which only copies own enumerable properties.
 * A Proxy without an `ownKeys` trap would silently produce an empty merge
 * and the spy would never fire (resulting in `elementRenders.total = 0`).
 * A precomputed object covers the tag set the AIMarkdown pipeline actually
 * emits.
 *
 * Under React StrictMode (dev) component bodies run twice per commit, so
 * `record` fires twice for every spy invocation. Concurrent renders that
 * abort also still invoke component bodies. Both sides of the comparison
 * are equally affected, so the cross-side RATIO stays meaningful, but
 * absolute counts are inflated. Trust the ratio, not the absolute value.
 *
 * @module stories/streaming/spyComponents
 */

import { createElement, type ComponentType } from 'react';
import type { AIMarkdownCustomComponents } from '../../src/index';

/**
 * HTML tags that the AIMarkdown rendering pipeline can produce. Covers:
 * - default mdast-util-to-hast output (headings, lists, tables, etc.)
 * - remark-mark-highlight (`mark`)
 * - remark-supersub (`sup`, `sub`)
 * - remark-definition-list (`dl`/`dt`/`dd`)
 * - rehype-raw passthrough of sanitized raw HTML
 * - synthetic footnote section
 *
 * Tags not in this list won't be spy-wrapped and won't count toward
 * `elementRenders.total`. Both sides of the comparison would undercount
 * such tags equally, so the comparison ratio stays meaningful.
 */
const SPY_TAGS = [
  // block / heading / paragraph
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'hr',
  // lists
  'ul',
  'ol',
  'li',
  // inline
  'a',
  'em',
  'strong',
  'del',
  's',
  'code',
  'span',
  'mark',
  'sup',
  'sub',
  'b',
  'i',
  'u',
  'br',
  'abbr',
  'kbd',
  'samp',
  'q',
  'ins',
  // media
  'img',
  // tables
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  // forms (task list checkboxes)
  'input',
  // raw HTML structural
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  // definition lists
  'dl',
  'dt',
  'dd',
  // figures
  'figure',
  'figcaption',
  // details
  'details',
  'summary',
  // miscellaneous inline (sanitizer allows; rehype-raw can pass through)
  'var',
  'cite',
  'dfn',
  'wbr',
  'time',
  // media (HTML5)
  'picture',
  'source',
  'track',
  'video',
  'audio',
  // SVG primitives (raw HTML passthrough, KaTeX-SVG mode, etc.)
  'svg',
  'g',
  'path',
  'line',
  'circle',
  'rect',
  'ellipse',
  'polygon',
  'polyline',
  'text',
] as const;

type SpyTag = (typeof SPY_TAGS)[number];

/**
 * Build a stable `customComponents` map. Every tag in {@link SPY_TAGS} is
 * wrapped in a spy component that calls `record(tag)` exactly once per
 * invocation, then forwards to the underlying HTML tag with the original
 * props (minus the `node` ExtraProp injected by the renderer).
 */
export function createSpyComponents(record: (tag: string) => void): AIMarkdownCustomComponents {
  const components: Partial<Record<SpyTag, ComponentType<Record<string, unknown>>>> = {};
  for (const tag of SPY_TAGS) {
    const Spy = (props: Record<string, unknown>) => {
      record(tag);
      // Strip the `node` ExtraProp before forwarding to the DOM tag,
      // otherwise React will warn about an unknown DOM attribute.
      const { node: _node, ...rest } = props as {
        node?: unknown;
      } & Record<string, unknown>;
      void _node;
      return createElement(tag, rest);
    };
    Spy.displayName = `Spy(${tag})`;
    components[tag] = Spy;
  }
  return components as AIMarkdownCustomComponents;
}
