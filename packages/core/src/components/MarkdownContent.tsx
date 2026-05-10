/**
 * Core markdown rendering component.
 *
 * Wraps the local `Markdown` (a vendored fork of react-markdown — see
 * `./markdown/`) with a curated set of remark and rehype plugins for GFM,
 * math/LaTeX, emoji, CJK support, and configurable extra syntax extensions
 * and display optimizations. Plugin selection is driven by the
 * {@link AIMarkdownRenderConfig} from context.
 *
 * @module components/MarkdownContent
 */

import { memo, useMemo } from 'react';
import Markdown, { type Options as MarkdownOptions } from './markdown';

type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>;
type RehypePlugins = NonNullable<MarkdownOptions['rehypePlugins']>;
type RemarkRehypeOptions = NonNullable<MarkdownOptions['remarkRehypeOptions']>;
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import rehypeSanitize from 'rehype-sanitize';
import { sanitizeSchema } from './sanitizeSchema';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import remarkBreaks from 'remark-breaks';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import remarkSupersub from 'remark-supersub';
import { remarkMark as remarkMarkHighlight } from 'remark-mark-highlight';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkSmartypants from 'remark-smartypants';
import remarkPangu from 'remark-pangu';
import remarkRemoveComments from 'remark-remove-comments';
import { useAIMarkdownRenderState } from '../context';
import {
  AIMarkdownCustomComponents,
  AIMarkdownRenderDisplayOptimizeAbility,
  AIMarkdownRenderExtraSyntax,
} from '../defs';

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
  [AIMarkdownRenderExtraSyntax.SUBSCRIPT]: remarkSupersub,
};

/** Stable empty object to avoid unnecessary re-renders when no custom components are given. */
const DefaultCustomComponents: AIMarkdownCustomComponents = {};

interface AIMarkdownContentProps {
  /** Preprocessed markdown string to render. */
  content: string;
  /** Optional react-markdown component overrides (e.g. custom code block renderer). */
  customComponents?: AIMarkdownCustomComponents;
}

/**
 * Internal component that assembles the remark/rehype plugin chain based on
 * the current render config and delegates to `Markdown`.
 */
const AIMarkdownContent = memo(({ content, customComponents }: AIMarkdownContentProps) => {
  const { config } = useAIMarkdownRenderState();

  // Resolve extra-syntax remark plugins and check if definition list HAST handlers are needed.
  const { extraSyntaxRemarkPlugins, enableDefinitionList } = useMemo(
    () => ({
      extraSyntaxRemarkPlugins: config.extraSyntaxSupported.map((syntax) => ExtraSyntaxRemarkPluginMap[syntax]),
      enableDefinitionList: config.extraSyntaxSupported.includes(AIMarkdownRenderExtraSyntax.DEFINITION_LIST),
    }),
    [config.extraSyntaxSupported]
  );

  const displayOptimizeRemarkPlugins = useMemo(() => {
    return config.displayOptimizeAbilities.map((ability) => DisplayOptimizeRemarkPluginMap[ability]);
  }, [config.displayOptimizeAbilities]);

  const usedComponents = useMemo(() => {
    return customComponents ? { ...DefaultCustomComponents, ...customComponents } : DefaultCustomComponents;
  }, [customComponents]);

  // Stable plugin/options arrays so this component's React.memo wrapper can
  // skip re-renders when only the parent re-rendered. The vendored sync
  // `<Markdown>` rebuilds the unified processor on every call regardless —
  // there is no internal processor cache to feed.
  const remarkPlugins = useMemo<RemarkPlugins>(
    () => [
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
      ...extraSyntaxRemarkPlugins,
      // --- Formatting & normalization ---
      remarkBreaks,
      remarkEmoji,
      remarkSqueezeParagraphs,
      remarkCjkFriendly,
      remarkCjkFriendlyGfmStrikethrough,
      // --- Configurable display optimizations ---
      ...displayOptimizeRemarkPlugins,
    ],
    [extraSyntaxRemarkPlugins, displayOptimizeRemarkPlugins]
  );

  const rehypePlugins = useMemo<RehypePlugins>(
    () => [
      // Allow raw HTML through so rehype-sanitize can handle it.
      [rehypeRaw, { passThrough: [] }],
      // Sanitize HTML while allowing <mark> (highlight) and KaTeX class names.
      [rehypeSanitize, sanitizeSchema],
      // Re-prefix intra-document hash hrefs so they match the ids that
      // rehype-sanitize just clobbered (paired with `clobberPrefix: ''`
      // below to keep the prefix layer single and clean).
      rehypeRebaseHashLinks,
      rehypeKatex,
      rehypeUnwrapImages,
    ],
    []
  );

  const remarkRehypeOptions = useMemo<RemarkRehypeOptions>(
    () => ({
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
    }),
    [enableDefinitionList]
  );

  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={remarkRehypeOptions}
      components={usedComponents}
      // NOTE: The default `urlTransform` in Windows environments treats local
      // paths (e.g. `C:/...`) as unsafe. Uncomment the line below if needed:
      // urlTransform={(url: string) => url}
    >
      {content}
    </Markdown>
  );
});

AIMarkdownContent.displayName = 'AIMarkdownContent';

export default AIMarkdownContent;
