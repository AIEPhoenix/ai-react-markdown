/**
 * Synchronous Markdown component. Ported from react-markdown v10
 * (`Markdown` named/default export) and refactored to expose the pipeline as
 * three independently callable stages so callers can interpose between them
 * (notably the block-memo cache in `MarkdownContent`).
 *
 * Public stages:
 * - {@link parseStage}        — `createProcessor` → `parse` → raw mdast
 * - {@link transformStage}    — `runSync` → final hast root
 * - {@link renderHastSubtree} — visit transform + `toJsxRuntime` on a hast tree or block
 *
 * The legacy synchronous {@link Markdown} export is preserved and now delegates
 * to those three stages so behavior matches react-markdown 1:1.
 *
 * @module components/markdown/Markdown
 */

import { unreachable } from 'devlop';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Element, Root as HastRoot, RootContent } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import type { Processor } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { buildTransform, createFile, createProcessor, defaultUrlTransform } from '@ai-react-markdown/engine';
import { cloneHastForRender } from '../cloneHastForRender';
import type { Deprecation, Options } from './types';

const changelog = 'https://github.com/remarkjs/react-markdown/blob/main/changelog.md';

/** Mirrors the deprecation table react-markdown ships — kept verbatim so error
 *  messages and changelog hashes match upstream. */
const deprecations: ReadonlyArray<Readonly<Deprecation>> = [
  { from: 'astPlugins', id: 'remove-buggy-html-in-markdown-parser' },
  { from: 'allowDangerousHtml', id: 'remove-buggy-html-in-markdown-parser' },
  {
    from: 'allowNode',
    id: 'replace-allownode-allowedtypes-and-disallowedtypes',
    to: 'allowElement',
  },
  {
    from: 'allowedTypes',
    id: 'replace-allownode-allowedtypes-and-disallowedtypes',
    to: 'allowedElements',
  },
  { from: 'className', id: 'remove-classname' },
  {
    from: 'disallowedTypes',
    id: 'replace-allownode-allowedtypes-and-disallowedtypes',
    to: 'disallowedElements',
  },
  { from: 'escapeHtml', id: 'remove-buggy-html-in-markdown-parser' },
  { from: 'includeElementIndex', id: '#remove-includeelementindex' },
  {
    from: 'includeNodeIndex',
    id: 'change-includenodeindex-to-includeelementindex',
  },
  { from: 'linkTarget', id: 'remove-linktarget' },
  { from: 'plugins', id: 'change-plugins-to-remarkplugins', to: 'remarkPlugins' },
  { from: 'rawSourcePos', id: '#remove-rawsourcepos' },
  { from: 'renderers', id: 'change-renderers-to-components', to: 'components' },
  { from: 'source', id: 'change-source-to-children', to: 'children' },
  { from: 'sourcePos', id: '#remove-sourcepos' },
  { from: 'transformImageUri', id: '#add-urltransform', to: 'urlTransform' },
  { from: 'transformLinkUri', id: '#add-urltransform', to: 'urlTransform' },
];

/**
 * Validate options that have nothing to do with the input markdown — kept
 * separate so the block-memo wrapper can validate once per render rather than
 * once per block-render call.
 */
function validateOptions(options: Readonly<Options>): void {
  for (const deprecation of deprecations) {
    if (Object.hasOwn(options, deprecation.from)) {
      unreachable(
        'Unexpected `' +
          deprecation.from +
          '` prop, ' +
          (deprecation.to ? 'use `' + deprecation.to + '` instead' : 'remove it') +
          ' (see <' +
          changelog +
          '#' +
          deprecation.id +
          '> for more info)'
      );
    }
  }

  if (options.allowedElements && options.disallowedElements) {
    unreachable('Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other');
  }
}

/** Bundled processor + parsed mdast + VFile, ready to feed `transformStage`. */
export interface ParsedMarkdown {
  processor: Processor<MdastRoot, MdastRoot, HastRoot, undefined, undefined>;
  file: VFile;
  mdast: MdastRoot;
}

/**
 * Stage 1: validate options, build the unified processor, parse the markdown
 * source into raw (pre-transform) mdast. The returned `mdast` is mutated in
 * place by remark plugins during {@link transformStage}, but its top-level
 * `position` offsets remain valid keys for hast→mdast lookup.
 */
export function parseStage(options: Readonly<Options>): ParsedMarkdown {
  validateOptions(options);
  const processor = createProcessor(options);
  const file = createFile(options);
  const mdast = processor.parse(file);
  return { processor, file, mdast };
}

/**
 * Stage 2: run remark transformers, remark-rehype, and rehype plugins. Returns
 * the final hast Root. The mdast in {@link ParsedMarkdown} may be mutated
 * by remark transformers as a side effect of this call.
 */
export function transformStage(parsed: ParsedMarkdown): HastRoot {
  return parsed.processor.runSync(parsed.mdast, parsed.file);
}

/**
 * Stage 3: apply the hast visit transform (urlTransform, allow/disallow
 * filters, raw HTML handling) and render via `hast-util-to-jsx-runtime`.
 *
 * Accepts either the full hast Root or a single top-level child (typed as
 * `RootContent` to match hast's union of element/text/comment/etc.). When
 * given a single child, the child is wrapped in a synthetic Root so the
 * splice-based filters (`unwrapDisallowed`) have a parent context to work
 * against.
 *
 * Note: the visit transform mutates the tree it walks in place, and callers
 * MAY pass a tree that outlives the call — the block-memo flow re-enters the
 * same memoized hast whenever a render happens without a re-parse (G3 cache
 * flush, registry version bump, urlTransform prop swap). Re-entry is safe
 * because every mutation class is handled:
 *
 * - `urlTransform` overwrites are applied CONVERGENTLY — recomputed from an
 *   original value stashed on `element.data.originalUrls` (see
 *   `buildTransform`), so a non-idempotent transform never compounds and a
 *   swapped transform never sees its predecessor's output. No clone needed.
 * - The raw→text rewrite is value-preserving and self-exhausting (no raw
 *   nodes remain after the first pass). No clone needed.
 * - The element filters (`allowedElements` / `disallowedElements` /
 *   `allowElement`) and `skipHtml` splice children DESTRUCTIVELY — removed
 *   nodes are unrecoverable, so when any of them is set the visit runs on a
 *   private structural clone. `<AIMarkdown>` never sets them (hardcoded
 *   `undefined` in `MarkdownContent`), so its flows never pay the clone.
 *   A caller that OWNS the tree — fresh-parsed, discarded when the call
 *   returns, never re-entered (the legacy `Markdown()` path) — passes
 *   `ownsTree: true` to skip the clone: there is nothing to protect, and
 *   for a react-markdown-compat caller with a filter set the clone would
 *   otherwise cost O(nodes) per render (per token when streaming).
 *
 * Known accepted edge: flipping a filter/skipHtml ON between renders of the
 * SAME shared tree cannot retroactively restore nodes an earlier unfiltered
 * pass already rendered — unreachable from `<AIMarkdown>`, and a content
 * re-parse heals it on the next token in any streaming flow.
 */
export function renderHastSubtree(
  tree: HastRoot | RootContent,
  options: Readonly<Options>,
  opts?: { ownsTree?: boolean }
): ReactNode {
  const needsClone =
    !opts?.ownsTree &&
    Boolean(options.allowedElements || options.disallowedElements || options.allowElement || options.skipHtml);
  const input: HastRoot | RootContent = needsClone ? cloneHastForRender(tree) : tree;
  const root: HastRoot = input.type === 'root' ? input : { type: 'root', children: [input] };

  visit(
    root,
    buildTransform({
      allowedElements: options.allowedElements,
      allowElement: options.allowElement,
      disallowedElements: options.disallowedElements,
      skipHtml: options.skipHtml,
      unwrapDisallowed: options.unwrapDisallowed,
      urlTransform: options.urlTransform || defaultUrlTransform,
    })
  );

  return toJsxRuntime(root, {
    Fragment,
    components: options.components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
}

/**
 * Render a markdown string to React elements.
 *
 * Mirrors `react-markdown`'s synchronous `<Markdown>` exactly: same prop
 * shape, same plugin pipeline (remark-parse → remarkPlugins → remark-rehype →
 * rehypePlugins → toJsxRuntime), same deprecation errors. Use this directly
 * via the local barrel; outside callers should keep using `<AIMarkdown>`.
 */
export function Markdown(options: Readonly<Options>): ReactElement {
  const parsed = parseStage(options);
  const tree = transformStage(parsed);
  // The tree is a local, parsed fresh on every call and dead after it —
  // no shared-tree re-entry exists here, so the destructive filters may
  // splice it in place instead of paying the defensive clone.
  return renderHastSubtree(tree, options, { ownsTree: true }) as ReactElement;
}

export default Markdown;

// Re-export for typing convenience at call sites that hold onto a single
// top-level hast block.
export type { Element as HastElement, HastRoot, RootContent as HastChild };
