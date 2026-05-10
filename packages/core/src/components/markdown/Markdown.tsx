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
import { createFile, createProcessor } from './processor';
import { buildTransform } from './transform';
import type { Deprecation, Options } from './types';
import { defaultUrlTransform } from './urlTransform';

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
 * Note: the visit transform mutates the input tree in place. For the legacy
 * `<Markdown>` flow this is harmless (the tree is freshly produced). For the
 * block-memo flow, hast is also fresh per render, so callers do not need to
 * defensively clone.
 */
export function renderHastSubtree(tree: HastRoot | RootContent, options: Readonly<Options>): ReactNode {
  const root: HastRoot = tree.type === 'root' ? tree : { type: 'root', children: [tree] };

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
  return renderHastSubtree(tree, options) as ReactElement;
}

export default Markdown;

// Re-export for typing convenience at call sites that hold onto a single
// top-level hast block.
export type { Element as HastElement, HastRoot, RootContent as HastChild };
