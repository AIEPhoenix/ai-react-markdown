/**
 * Synchronous Markdown component. Ported 1:1 from react-markdown v10
 * (`Markdown` named/default export). The async `MarkdownAsync` and
 * hooks-based `MarkdownHooks` variants are not ported — they aren't used
 * anywhere in this library.
 *
 * @module components/markdown/Markdown
 */

import { unreachable } from 'devlop';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Root } from 'hast';
import { Fragment, type ReactElement } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { visit } from 'unist-util-visit';
import { createFile, createProcessor } from './processor';
import { buildTransform } from './transform';
import type { Deprecation, Options } from './types';
import { defaultUrlTransform } from './urlTransform';

const changelog =
  'https://github.com/remarkjs/react-markdown/blob/main/changelog.md';

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
 * Render a markdown string to React elements.
 *
 * Mirrors `react-markdown`'s synchronous `<Markdown>` exactly: same prop
 * shape, same plugin pipeline (remark-parse → remarkPlugins → remark-rehype →
 * rehypePlugins → toJsxRuntime), same deprecation errors. Use this directly
 * via the local barrel; outside callers should keep using `<AIMarkdown>`.
 */
export function Markdown(options: Readonly<Options>): ReactElement {
  const processor = createProcessor(options);
  const file = createFile(options);
  return post(processor.runSync(processor.parse(file), file), options);
}

function post(tree: Root, options: Readonly<Options>): ReactElement {
  const allowedElements = options.allowedElements;
  const allowElement = options.allowElement;
  const components = options.components;
  const disallowedElements = options.disallowedElements;
  const skipHtml = options.skipHtml;
  const unwrapDisallowed = options.unwrapDisallowed;
  const urlTransform = options.urlTransform || defaultUrlTransform;

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

  if (allowedElements && disallowedElements) {
    unreachable(
      'Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other'
    );
  }

  visit(
    tree,
    buildTransform({
      allowedElements,
      allowElement,
      disallowedElements,
      skipHtml,
      unwrapDisallowed,
      urlTransform,
    })
  );

  return toJsxRuntime(tree, {
    Fragment,
    components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
}

export default Markdown;
