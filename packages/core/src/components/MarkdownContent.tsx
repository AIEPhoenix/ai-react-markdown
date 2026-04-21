/**
 * Core markdown rendering component.
 *
 * Wraps `react-markdown` with a curated set of remark and rehype plugins
 * for GFM, math/LaTeX, emoji, CJK support, and configurable extra syntax
 * extensions and display optimizations. Plugin selection is driven by the
 * {@link AIMarkdownRenderConfig} from context.
 *
 * @module components/MarkdownContent
 */

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import rehypeSanitize from 'rehype-sanitize';
import { sanitizeSchema } from './sanitizeSchema';
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
 * the current render config and delegates to `ReactMarkdown`.
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

  return (
    <ReactMarkdown
      remarkPlugins={[
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
      ]}
      rehypePlugins={[
        // Allow raw HTML through so rehype-sanitize can handle it.
        [
          rehypeRaw,
          {
            passThrough: [],
          },
        ],
        // Sanitize HTML while allowing <mark> (highlight) and KaTeX class names.
        [rehypeSanitize, sanitizeSchema],
        rehypeKatex,
        rehypeUnwrapImages,
      ]}
      remarkRehypeOptions={{
        allowDangerousHtml: true,
        handlers: {
          // Inject definition-list HAST handlers when the extension is active.
          ...(enableDefinitionList ? defListHastHandlers : {}),
        },
      }}
      components={usedComponents}
      // NOTE: The default `urlTransform` in Windows environments treats local
      // paths (e.g. `C:/...`) as unsafe. Uncomment the line below if needed:
      // urlTransform={(url: string) => url}
    >
      {content}
    </ReactMarkdown>
  );
});

AIMarkdownContent.displayName = 'AIMarkdownContent';

export default AIMarkdownContent;
