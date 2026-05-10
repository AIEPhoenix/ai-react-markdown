/**
 * Core markdown rendering component.
 *
 * Wraps the local `Markdown` (a vendored fork of react-markdown — see
 * `./markdown/`) with a curated set of remark and rehype plugins for GFM,
 * math/LaTeX, emoji, CJK support, and configurable extra syntax extensions
 * and display optimizations. Plugin selection is driven by the
 * {@link AIMarkdownRenderConfig} from context.
 *
 * ## Render strategy
 *
 * Two render paths gated by `config.blockMemoEnabled` (default `true`):
 *
 * - **Block-memo path** (`BlockMemoizedRenderer`): the rendered hast is cut
 *   into per-block units and memoized across frames by source identity
 *   (`raw + occurrence + ctx + position triple`). Streaming append where
 *   prior blocks are unchanged skips `toJsxRuntime` + React reconcile for
 *   those blocks.
 *
 * - **Legacy path** (`LegacyRenderer`): the vendored `<Markdown>` is called
 *   directly with no cache. Every render runs the full pipeline; output is
 *   byte-identical to the block-memo path (locked in by
 *   `byteEquivalence.test.tsx`).
 *
 * The branch is at the component-tree level: only one of the two child
 * renderers is mounted at a time, so the disabled path pays no `useRef` /
 * `useMemo` cost from block-memo's bookkeeping. Toggling the option at
 * runtime unmounts one and mounts the other (the discarded path's cache
 * is GC'd).
 *
 * ## Performance contract — block-level memoization
 *
 * For the cache to be effective, props that influence rendered output must
 * be referentially stable across renders. This component stabilizes its own
 * plugin arrays via `useMemo`. The outer `<AIMarkdown>` stabilizes
 * `customComponents` via `useStableValue`. If you wire `<AIMarkdownContent>`
 * directly, ensure `customComponents` is memoized at the call site.
 *
 * @module components/MarkdownContent
 */

import { Fragment, memo, useMemo, useRef } from 'react';
import Markdown, { parseStage, transformStage, type Options as MarkdownOptions } from './markdown';

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
import { buildBlocks, createCache, renderBlocksWithCache, type Cache, type PostOptions } from './blockMemo';
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

interface RendererProps {
  content: string;
  usedComponents: AIMarkdownCustomComponents;
  remarkPlugins: RemarkPlugins;
  rehypePlugins: RehypePlugins;
  remarkRehypeOptions: RemarkRehypeOptions;
}

/**
 * Block-memo render path. Mounted when `config.blockMemoEnabled === true`.
 * Encapsulates the `useRef`-backed cache, G3 sync flush, and the three-stage
 * unified pipeline (parse → transform → buildBlocks → renderBlocksWithCache).
 */
const BlockMemoizedRenderer = memo(
  ({ content, usedComponents, remarkPlugins, rehypePlugins, remarkRehypeOptions }: RendererProps) => {
    // Vendored Markdown options that AIMarkdown does not currently expose. They
    // are tracked in the G3 flush below so the cache stays correct if any of
    // these are ever surfaced upstream.
    const urlTransform: MarkdownOptions['urlTransform'] = undefined;
    const allowedElements: MarkdownOptions['allowedElements'] = undefined;
    const disallowedElements: MarkdownOptions['disallowedElements'] = undefined;
    const allowElement: MarkdownOptions['allowElement'] = undefined;
    const skipHtml: MarkdownOptions['skipHtml'] = undefined;
    const unwrapDisallowed: MarkdownOptions['unwrapDisallowed'] = undefined;

    // G3 — synchronous deps-diff flush. Discards the per-block cache when any
    // option that affects rendered output (but not parse output) changes
    // identity. The check runs synchronously at the top of render: an
    // `useEffect` would only fire after commit, by which time the current
    // render has already read from the (now stale) cache and emitted incorrect
    // output. The cache is best-effort memoization across renders, not state
    // the UI depends on for correctness — concurrent render aborts are safe
    // because (a) cache hits return identical node references, and (b) cache
    // misses always recompute from inputs that are themselves pure.
    //
    // eslint-disable react-hooks/refs — the lint rule (React Compiler purity
    // check) is correct in general but the cache-memoization pattern documented
    // above is an established exception. See design `/tmp/phase5-block-memo-decisions.md` §4.
    /* eslint-disable react-hooks/refs */
    const cacheRef = useRef<Cache>(createCache());
    const depsRef = useRef({
      usedComponents,
      remarkPlugins,
      rehypePlugins,
      remarkRehypeOptions,
      urlTransform,
      allowedElements,
      disallowedElements,
      allowElement,
      skipHtml,
      unwrapDisallowed,
    });
    if (
      depsRef.current.usedComponents !== usedComponents ||
      depsRef.current.remarkPlugins !== remarkPlugins ||
      depsRef.current.rehypePlugins !== rehypePlugins ||
      depsRef.current.remarkRehypeOptions !== remarkRehypeOptions ||
      depsRef.current.urlTransform !== urlTransform ||
      depsRef.current.allowedElements !== allowedElements ||
      depsRef.current.disallowedElements !== disallowedElements ||
      depsRef.current.allowElement !== allowElement ||
      depsRef.current.skipHtml !== skipHtml ||
      depsRef.current.unwrapDisallowed !== unwrapDisallowed
    ) {
      cacheRef.current = createCache();
      depsRef.current = {
        usedComponents,
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions,
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
      };
    }
    /* eslint-enable react-hooks/refs */

    // Stage 1 + 2: parse → run remark/rehype pipeline. The `parsed.mdast` is
    // mutated in place during `transformStage`; the useMemo chain below keeps
    // ordering correct for `buildBlocks`.
    const parsed = useMemo(
      () =>
        parseStage({
          children: content,
          remarkPlugins,
          rehypePlugins,
          remarkRehypeOptions,
        }),
      [content, remarkPlugins, rehypePlugins, remarkRehypeOptions]
    );
    const hast = useMemo(() => transformStage(parsed), [parsed]);

    // Cut hast into per-block units indexed back to mdast for cache identity,
    // and compute the document-wide ctx digest for cross-block invalidation.
    const built = useMemo(() => buildBlocks(parsed.mdast, hast, content), [parsed.mdast, hast, content]);

    const postOptions = useMemo<PostOptions>(
      () => ({
        components: usedComponents,
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
      }),
      [usedComponents, urlTransform, allowedElements, disallowedElements, allowElement, skipHtml, unwrapDisallowed]
    );

    // eslint-disable-next-line react-hooks/refs -- intentional cache memoization, see G3 comment above.
    const rendered = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, postOptions);

    // React keys come from buildBlocks:
    //   - `block-${hastOffset}` for cacheable blocks (the hast element's own
    //     source offset, NOT the mdast offset — this is what makes multi-root
    //     raw HTML produce unique keys when two hast siblings share one mdast
    //     html node)
    //   - `__footnote_section__` for the synthetic footnote section (fixed
    //     literal lets its fiber state survive toggle T1→T2→T3)
    //   - `inline-${offset}` for top-level whitespace / sanitized comments,
    //     falling back to `inline-i${planIndex}` if the inline has no position
    return (
      <>
        {rendered.map(({ node, reactKey }) => (
          <Fragment key={reactKey}>{node}</Fragment>
        ))}
      </>
    );
  }
);
BlockMemoizedRenderer.displayName = 'BlockMemoizedRenderer';

/**
 * Legacy render path. Mounted when `config.blockMemoEnabled === false`.
 * Calls the vendored `<Markdown>` directly — every render runs the full
 * pipeline end-to-end with no cross-frame reuse. Output is byte-identical
 * to the block-memo path (validated by `byteEquivalence.test.tsx`).
 */
const LegacyRenderer = memo(
  ({ content, usedComponents, remarkPlugins, rehypePlugins, remarkRehypeOptions }: RendererProps) => (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={remarkRehypeOptions}
      components={usedComponents}
    >
      {content}
    </Markdown>
  )
);
LegacyRenderer.displayName = 'LegacyRenderer';

/**
 * Internal component that assembles the remark/rehype plugin chain based on
 * the current render config, then dispatches to either the block-memo
 * renderer or the legacy renderer based on `config.blockMemoEnabled`.
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
  // skip re-renders when only the parent re-rendered. The vendored
  // `parseStage` rebuilds the unified processor on every call regardless —
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

  const Renderer = config.blockMemoEnabled ? BlockMemoizedRenderer : LegacyRenderer;
  return (
    <Renderer
      content={content}
      usedComponents={usedComponents}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={remarkRehypeOptions}
    />
  );
});

AIMarkdownContent.displayName = 'AIMarkdownContent';

export default AIMarkdownContent;
