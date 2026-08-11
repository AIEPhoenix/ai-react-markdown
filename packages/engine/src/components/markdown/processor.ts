/**
 * Unified processor and VFile setup. Ported 1:1 from react-markdown
 * v10 `createProcessor` and `createFile`.
 *
 * @module components/markdown/processor
 */

import { unreachable } from 'devlop';
import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import remarkParse from 'remark-parse';
import remarkRehype, { type Options as RemarkRehypeOptions } from 'remark-rehype';
import { type PluggableList, type Processor, unified } from 'unified';
import { VFile } from 'vfile';
import type { PipelineOptions } from './types';

const emptyPlugins: PluggableList = [];
const emptyRemarkRehypeOptions: Readonly<RemarkRehypeOptions> = { allowDangerousHtml: true };

/**
 * Build the unified processor: remark-parse → remarkPlugins → remark-rehype →
 * rehypePlugins. Returns an unfrozen processor — caller is expected to call
 * `.parse()` and `.runSync()` (or `.run()`) on it.
 */
export function createProcessor(
  options: Readonly<PipelineOptions>
): Processor<MdastRoot, MdastRoot, HastRoot, undefined, undefined> {
  const rehypePlugins = options.rehypePlugins || emptyPlugins;
  const remarkPlugins = options.remarkPlugins || emptyPlugins;
  const remarkRehypeOptions = options.remarkRehypeOptions
    ? { ...options.remarkRehypeOptions, ...emptyRemarkRehypeOptions }
    : emptyRemarkRehypeOptions;

  return unified().use(remarkParse).use(remarkPlugins).use(remarkRehype, remarkRehypeOptions).use(rehypePlugins);
}

/**
 * Wrap the markdown string in a VFile so plugins that consume `file.value`
 * work. Mirrors react-markdown: in dev `unreachable` throws an AssertionError
 * for non-string `children`; in prod it silently no-ops, leaving `file.value`
 * undefined and unified treating the input as empty.
 */
export function createFile(options: Readonly<PipelineOptions>): VFile {
  const children = options.children || '';
  const file = new VFile();

  if (typeof children === 'string') {
    file.value = children;
  } else {
    unreachable('Unexpected value `' + String(children) + '` for `children` prop, expected `string`');
  }

  return file;
}
