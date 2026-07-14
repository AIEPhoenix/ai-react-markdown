/**
 * THE single source of the production plugin chain.
 *
 * `MarkdownContent`'s memos, the splice-equivalence arbiter's option
 * catalog (`incrementalParse/testPluginCatalog.ts`), and the prefixFreeze
 * experiment harness all build their chains HERE — plugin-order drift
 * between the renderer and its verification suites previously required
 * hand-synchronized copies, and a missed copy would silently leave the
 * arbiter testing a non-production pipeline.
 *
 * Two deliberate NON-consumers, kept as independent mirrors on purpose:
 * - `byteEquivalence.test.tsx`'s `legacyPlugins()` — it is the REFERENCE
 *   implementation the new pipeline is compared against; importing this
 *   module would make that comparison circular.
 * - `positionPropagation.test.ts` — it pins the position-retention
 *   contract of the exact stack and must fail loudly when the stack
 *   changes, not silently follow it.
 *
 * @module components/pluginChain
 */

import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import { remarkMark as remarkMarkHighlight } from 'remark-mark-highlight';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkSmartypants from 'remark-smartypants';
import remarkPangu from 'remark-pangu';
import remarkRemoveComments from 'remark-remove-comments';

import type { Options as MarkdownOptions } from './markdown';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import rehypeFooterAdorn from './rehypeFooterAdorn';
import type { SanitizeSchema } from './extendSanitizeSchema';
import { AIMarkdownRenderDisplayOptimizeAbility, AIMarkdownRenderExtraSyntax } from '../defs';

export type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>;
export type RehypePlugins = NonNullable<MarkdownOptions['rehypePlugins']>;
export type RemarkRehypeOptions = NonNullable<MarkdownOptions['remarkRehypeOptions']>;

/** Maps display optimization abilities to their corresponding remark plugins. */
const DisplayOptimizeRemarkPluginMap = {
  [AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS]: remarkRemoveComments,
  [AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS]: remarkSmartypants,
  [AIMarkdownRenderDisplayOptimizeAbility.PANGU]: remarkPangu,
};

/** Maps extra syntax extensions to their corresponding remark plugins. */
const ExtraSyntaxRemarkPluginMap = {
  [AIMarkdownRenderExtraSyntax.HIGHLIGHT]: remarkMarkHighlight,
  [AIMarkdownRenderExtraSyntax.DEFINITION_LIST]: remarkDefinitionList,
};

/** The always-on remark chain with config-gated extras spliced at their
 *  contractual positions. ORDER IS LOAD-BEARING — see the arbiter suite. */
export function buildCoreRemarkPlugins(
  extraSyntaxSupported: readonly AIMarkdownRenderExtraSyntax[],
  displayOptimizeAbilities: readonly AIMarkdownRenderDisplayOptimizeAbility[]
): RemarkPlugins {
  return [
    // --- Core plugins (always active) ---
    remarkGfm,
    [
      remarkMath,
      {
        // Disable single-dollar inline math to avoid conflicts with currency
        // signs and other dollar usages; the preprocessor converts $...$ to $$...$$.
        singleDollarTextMath: false,
      },
    ],
    // --- Configurable extra syntax plugins ---
    ...extraSyntaxSupported.map((syntax) => ExtraSyntaxRemarkPluginMap[syntax]),
    // --- Formatting & normalization ---
    remarkBreaks,
    remarkEmoji,
    remarkSqueezeParagraphs,
    remarkCjkFriendly,
    remarkCjkFriendlyGfmStrikethrough,
    // --- Configurable display optimizations ---
    ...displayOptimizeAbilities.map((ability) => DisplayOptimizeRemarkPluginMap[ability]),
  ] as RemarkPlugins;
}

/** The rehype chain. `clobberPrefix` namespaces ids per instance; pass ''
 *  for unprefixed output (test harnesses). */
export function buildCoreRehypePlugins(sanitizeSchema: SanitizeSchema, clobberPrefix: string): RehypePlugins {
  return [
    // Allow raw HTML through so rehype-sanitize can handle it.
    [rehypeRaw, { passThrough: [] }],
    // Sanitize HTML while allowing <mark> (highlight), KaTeX class names,
    // and any extra protocols the caller permitted via the `sanitizeSchema`
    // prop. Override `clobberPrefix` with the instance-scoped value — the
    // spread order is intentional: our prefix wins over any caller-supplied
    // prefix on the schema.
    [rehypeSanitize, { ...sanitizeSchema, clobberPrefix }],
    // Normalize the auto-generated `<section data-footnotes>`: strip the
    // sr-only `<h2>Footnotes</h2>` label and prepend `<hr>`. Keeps standalone
    // single-doc rendering visually consistent with the cross-chunk aggregate
    // footer (which builds the same shape from scratch).
    rehypeFooterAdorn,
    // Re-prefix intra-document hash hrefs so they match the ids that
    // rehype-sanitize just clobbered. Must use the SAME prefix as the schema
    // above.
    [rehypeRebaseHashLinks, { prefix: clobberPrefix }],
    rehypeKatex,
    rehypeUnwrapImages,
  ] as RehypePlugins;
}

/** Base remark-rehype options (before the standalone/coordinated handler
 *  merge that `MarkdownContent`'s pipeline memo layers on top). */
export function buildCoreRemarkRehypeOptions(enableDefinitionList: boolean): RemarkRehypeOptions {
  return {
    allowDangerousHtml: true,
    // Suppress mdast-util-to-hast's `user-content-` prefix on footnote
    // ids/hrefs; rehype-sanitize will apply the same prefix downstream
    // and `rehypeRebaseHashLinks` mirrors it onto matching hash hrefs.
    // Without this, ids would end up double-prefixed
    // (`user-content-user-content-fn-x`).
    clobberPrefix: '',
    handlers: {
      // Inject definition-list HAST handlers when the extension is active.
      ...(enableDefinitionList ? defListHastHandlers : {}),
    },
  };
}
