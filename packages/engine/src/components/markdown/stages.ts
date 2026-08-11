/**
 * The pure pipeline stages, lifted verbatim from core's Markdown.tsx
 * (boundary action ②): parseStage / transformStage are framework-agnostic
 * (mdast/hast in, hast out) and are consumed by the incremental-parse
 * engine, so they live engine-side; renderHastSubtree and the `<Markdown>`
 * component stay in core.
 *
 * The deprecation table and validation travel with parseStage — every
 * caller (React or not) must get identical validation semantics.
 *
 * @module components/markdown/stages
 */

import { unreachable } from 'devlop';
import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import type { Processor } from 'unified';
import type { VFile } from 'vfile';
import { createFile, createProcessor } from './processor';
import type { Deprecation, PipelineOptions } from './types';

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
function validateOptions(options: Readonly<PipelineOptions>): void {
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
export function parseStage(options: Readonly<PipelineOptions>): ParsedMarkdown {
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
