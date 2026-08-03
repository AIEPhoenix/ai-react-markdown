/**
 * `@ai-react-markdown/remark-mark-highlight` — remark plugin for `==mark==`
 * highlight syntax. First-party continuation of the unmaintained
 * `remark-mark-highlight`, byte-compatible with its 0.1.1 output (pinned by
 * the parity corpus) and shipping the dual ESM/CJS build the upstream
 * lacked.
 *
 * ```ts
 * import { remarkMarkHighlight } from '@ai-react-markdown/remark-mark-highlight';
 *
 * unified().use(remarkParse).use(remarkMarkHighlight)
 * // ==text== → mdast `mark` node → <mark>text</mark>
 * ```
 *
 * @module @ai-react-markdown/remark-mark-highlight
 */

import type { Processor } from 'unified';
import { markHighlight } from './syntax.js';
import { markHighlightFromMarkdown, markHighlightToMarkdown } from './mdast.js';

/** remark plugin enabling `==mark==` highlight syntax. */
export function remarkMarkHighlight(this: Processor): undefined {
  const data = this.data() as Record<string, unknown[] | undefined>;

  add('micromarkExtensions', markHighlight());
  add('fromMarkdownExtensions', markHighlightFromMarkdown);
  add('toMarkdownExtensions', markHighlightToMarkdown);

  function add(field: string, value: unknown): void {
    (data[field] ??= []).push(value);
  }
}

/** Drop-in alias matching the upstream `remark-mark-highlight` export name. */
export { remarkMarkHighlight as remarkMark };

export { markHighlight } from './syntax.js';
export { markHighlightFromMarkdown, markHighlightToMarkdown, type Mark } from './mdast.js';
