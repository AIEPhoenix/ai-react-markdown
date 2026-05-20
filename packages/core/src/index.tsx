/**
 * @ai-react-markdown/core
 *
 * A batteries-included React component for rendering AI-generated markdown
 * with first-class support for LaTeX math, GFM, CJK text, syntax highlighting,
 * and streaming content.
 *
 * ## Quick Start
 *
 * ```tsx
 * import AIMarkdown from '@ai-react-markdown/core';
 * import '@ai-react-markdown/core/typography/default.css';
 *
 * function App() {
 *   return <AIMarkdown content="Hello **world**!" />;
 * }
 * ```
 *
 * @module @ai-react-markdown/core
 */

'use client';

import { useMemo, memo, useId, type CSSProperties } from 'react';
import AIMarkdownRenderStateProvider, {
  AIMarkdownMetadataProvider,
  AIMarkdownRenderStateProviderProps,
  AIMarkdownMetadataProviderProps,
} from './context';
import { AIMDContentPreprocessor } from './preprocessors/defs';
import preprocessAIMDContent from './preprocessors';
import AIMarkdownContent from './components/MarkdownContent';
import {
  AIMarkdownCustomComponents,
  AIMarkdownRenderConfig,
  AIMarkdownMetadata,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
} from './defs';
import type { SanitizeSchema } from './components/extendSanitizeSchema';
import type { UrlTransform } from './components/markdown';
import useStableValue from './hooks/useStableValue';
import useReferenceFlipWarning from './hooks/useReferenceFlipWarning';
import DefaultTypography from './components/typography/Default';

/**
 * Props for the `<AIMarkdown>` component.
 *
 * @typeParam TConfig - Custom render configuration type (extends {@link AIMarkdownRenderConfig}).
 * @typeParam TRenderData - Custom metadata type (extends {@link AIMarkdownMetadata}).
 */
export interface AIMarkdownProps<
  TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig,
  TRenderData extends AIMarkdownMetadata = AIMarkdownMetadata,
>
  extends
    Omit<AIMarkdownRenderStateProviderProps<TConfig>, 'streaming' | 'fontSize' | 'variant' | 'colorScheme'>,
    AIMarkdownMetadataProviderProps<TRenderData> {
  /**
   * Whether content is actively being streamed (e.g. token-by-token from an LLM).
   * When `true`, the flag is propagated via context so custom components can adapt
   * their behavior (show cursors, disable copy buttons, skip animations, etc.).
   * Defaults to `false`.
   */
  streaming?: boolean;
  /**
   * Base font size for the rendered output.
   * Accepts a CSS length string (e.g. `'14px'`, `'0.875rem'`) or a number
   * which is treated as pixels. Defaults to `'0.9375rem'`.
   */
  fontSize?: number | string;
  /** Raw markdown content to render. */
  content: string;
  /**
   * Additional preprocessors to run on the raw markdown before rendering.
   * These run *after* the built-in LaTeX preprocessor.
   */
  contentPreprocessors?: AIMDContentPreprocessor[];
  /**
   * Custom `react-markdown` component overrides.
   * Use this to replace the default renderers for specific HTML elements
   * (e.g. code blocks, links, images).
   */
  customComponents?: AIMarkdownCustomComponents;
  /**
   * Typography wrapper component. Receives `fontSize`, `variant`, and `colorScheme`.
   * Defaults to the built-in {@link DefaultTypography}.
   */
  Typography?: AIMarkdownTypographyComponent;
  /**
   * Optional extra style wrapper component rendered between the typography
   * wrapper and the markdown content. Useful for injecting additional
   * CSS scope or theme providers.
   */
  ExtraStyles?: AIMarkdownExtraStylesComponent;
  /** Typography variant name. Defaults to `'default'`. */
  variant?: AIMarkdownVariant;
  /** Color scheme name. Defaults to `'light'`. */
  colorScheme?: AIMarkdownColorScheme;
  /**
   * Stable identifier for the *logical markdown document* this `<AIMarkdown>`
   * is rendering. Used as the id namespace for all clobberable attributes
   * (`id`, hash hrefs) so two documents on the same page do not cross-link —
   * e.g. clicking a footnote `[^1]` in message A will not scroll to the
   * `[^1]` definition in message B.
   *
   * Why `documentId` and not `instanceId`: when one logical document is
   * split across multiple `<AIMarkdown>` instances (chunked / streamed
   * rendering), every chunk should share the SAME `documentId` so their
   * id-prefixes line up. The id is per-document, not per-React-instance.
   *
   * When omitted, an id is auto-generated via React's `useId()` (SSR-safe
   * and stable across re-renders). Pass an explicit value when you need
   * deterministic ids (snapshot tests, cross-component deep links) or when
   * multiple instances render the same logical document.
   *
   * Consumer-supplied values pass through `encodeURIComponent` at the prefix
   * construction site, so any string is safe — including ids with reserved
   * characters like `:`, `/`, or spaces.
   */
  documentId?: string;
  /**
   * Override the per-attribute URL rewriter (Gate 2 of the two-gate model).
   * Runs at render time during the hast traversal in `renderHastSubtree`,
   * after Gate 1 (`rehype-sanitize` schema) has already filtered URLs by
   * protocol allowlist in the rehype plugin chain.
   *
   * The default allowlist mirrors `react-markdown` / GitHub: `http`,
   * `https`, `irc`, `ircs`, `mailto`, `xmpp`. Anything else is rewritten
   * to `''`.
   *
   * **Recommended pattern**: compose with the exported
   * {@link defaultUrlTransform} so the built-in XSS protections survive,
   * and define the result at module scope so its identity is stable across
   * renders:
   *
   * ```ts
   * import AIMarkdown, { defaultUrlTransform } from '@ai-react-markdown/core';
   *
   * const ALLOWED = /^(myapp|tel):/i;
   * const URL_TRANSFORM = (url, key, node) =>
   *   ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node);
   *
   * function App() {
   *   return <AIMarkdown urlTransform={URL_TRANSFORM} ... />;
   * }
   * ```
   *
   * **Regex-escaping**: scheme names per RFC 3986 may contain `+`, `-`, and
   * `.` (e.g. `web+app`, `coap+tcp`). All three are regex metacharacters,
   * so write `/^web\+app:/i` rather than `/^web+app:/i`. The latter would
   * match URLs starting with `we`, `wee`, `weee`, … and silently broaden
   * the allowlist.
   *
   * **Reference stability matters.** The block-memo cache treats this prop
   * as a dependency. Defining the function inline (`urlTransform={(url) =>
   * …}`) creates a new closure on every parent render, discards the cache
   * for the entire markdown document on each render, and effectively
   * disables block-level memoization. In development the library will
   * `console.warn` if it detects this pattern.
   *
   * Allowing a protocol here is necessary but **not sufficient** to render
   * a link — Gate 1 (`rehype-sanitize` schema) also enforces its own
   * protocol allowlist and runs first. See the `sanitizeSchema` prop on
   * this component and the {@link extendSanitizeSchema} helper for Gate 1.
   *
   * **API stability**: the `UrlTransform` type tracks the upstream
   * `react-markdown` shape and may change with its major versions.
   */
  urlTransform?: UrlTransform | null;
  /**
   * Override the `rehype-sanitize` schema applied to the rendered output.
   * The library default extends `rehype-sanitize`'s own `defaultSchema`
   * with the `<mark>` tag, the `math-inline` / `math-display` className
   * markers `remark-math` emits on `<code>` (KaTeX's own output classes
   * survive separately because `rehype-katex` runs after `rehype-sanitize`),
   * and the cross-chunk coordination tags (`cross-chunk-link`,
   * `cross-chunk-image`, `footnote-sup`). The default is not exported as a
   * value — see {@link extendSanitizeSchema} for how to inspect or extend
   * it safely.
   *
   * **Recommended pattern**: build the schema with {@link extendSanitizeSchema}
   * (mutate-and-return form) so those library additions stay intact, and
   * define the result at module scope:
   *
   * ```ts
   * import AIMarkdown, { extendSanitizeSchema } from '@ai-react-markdown/core';
   *
   * const SCHEMA = extendSanitizeSchema((s) => {
   *   s.protocols.href.push('myapp');
   *   s.protocols.src.push('myapp');
   * });
   *
   * function App() {
   *   return <AIMarkdown sanitizeSchema={SCHEMA} ... />;
   * }
   * ```
   *
   * **Footgun**: hand-rolling a schema (e.g. spreading from
   * `rehype-sanitize`'s `defaultSchema` directly) silently drops the
   * cross-chunk tag allowlist — coordinated multi-chunk rendering will then
   * lose its placeholders. Prefer the helper unless you have a specific
   * reason to opt out.
   *
   * **Reference stability matters.** An inline call
   * (`sanitizeSchema={extendSanitizeSchema((s) => { … })}`) is mitigated by
   * an internal `useStableValue` deep-equal pass, but the safer pattern is
   * still module-scope. Development builds will `console.warn` on identity
   * flips.
   *
   * **API stability**: the `SanitizeSchema` type tracks the upstream
   * `rehype-sanitize` shape and may change with its major versions.
   */
  sanitizeSchema?: SanitizeSchema;
}

/**
 * Root component that preprocesses markdown content and renders it through
 * a configurable remark/rehype pipeline wrapped in typography and style layers.
 */
const AIMarkdownComponent = <
  TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig,
  TRenderData extends AIMarkdownMetadata = AIMarkdownMetadata,
>({
  streaming = false,
  content,
  fontSize,
  contentPreprocessors,
  customComponents,
  defaultConfig,
  config,
  metadata,
  Typography = DefaultTypography,
  ExtraStyles,
  variant = 'default',
  colorScheme = 'light',
  documentId,
  urlTransform,
  sanitizeSchema,
}: AIMarkdownProps<TConfig, TRenderData>) => {
  // Normalize fontSize: number -> px string, undefined -> default rem value.
  // Branch on `undefined` (not truthiness) so `fontSize={0}` resolves to `'0px'`.
  const usedFontSize = fontSize === undefined ? '0.9375rem' : typeof fontSize === 'number' ? `${fontSize}px` : fontSize;

  // Auto-generate a stable id when the consumer didn't supply one. We hand
  // back React's native `useId()` value verbatim — any URI/HTML-attribute
  // safety transformation happens downstream at the prefix construction site
  // (see `MarkdownContent.tsx`), so the value exposed via context retains its
  // React identity (useful for debugging and DevTools association).
  const generatedId = useId();
  const usedDocumentId = documentId && documentId.length > 0 ? documentId : generatedId;

  // Dev-mode flip-rate warnings on the two cache-sensitive props. These
  // MUST run BEFORE `useStableValue` below, otherwise a deep-equal collapse
  // would mask the very anti-pattern they exist to surface (inline schema
  // re-built every render). Both hook calls become dead code in production
  // via `__DEV__` constant folding inside the hook implementation.
  useReferenceFlipWarning(urlTransform, 'urlTransform');
  useReferenceFlipWarning(sanitizeSchema, 'sanitizeSchema');

  // Stabilize object/array props to prevent unnecessary re-renders
  // when the consumer creates new references on each render.
  //
  // `metadata` is INTENTIONALLY excluded — its shape is opaque to the library
  // and may be arbitrarily large (e.g. full chat session, document tree). A
  // blanket lodash isEqual deep-compare here would penalize every render with
  // an unbounded scan. Stabilizing metadata is the consumer's responsibility:
  // if their custom renderers do reference-equal work on it, they should
  // useMemo their metadata at the call site.
  const stableDefaultConfig = useStableValue(defaultConfig);
  const stableConfig = useStableValue(config);
  const stablePreprocessors = useStableValue(contentPreprocessors);
  const stableCustomComponents = useStableValue(customComponents);
  // Stabilize the sanitize schema so callers who construct it inline (against
  // our recommendation) don't blow the rehypePlugins memo on every render.
  // Also covers the common case of spreading defaults to add a single
  // protocol — the deep-equal check collapses identity churn. The flip
  // warning above runs on the RAW prop (before this stabilize) so the user
  // still sees the warning even though the cache stays warm.
  const stableSanitizeSchema = useStableValue(sanitizeSchema);
  // urlTransform is intentionally NOT stabilized — useStableValue uses
  // lodash isEqual, which is not meaningful for functions (two different
  // closures over the same logic will never be equal). The JSDoc on the
  // prop already requires callers to pass a stable function reference; we
  // forward it as-is so the behavior is honest.

  // Run the preprocessing pipeline (LaTeX normalization + user preprocessors).
  const usedContent = useMemo(
    () => (content ? preprocessAIMDContent(content, stablePreprocessors) : content),
    [content, stablePreprocessors]
  );

  // Stabilize the inline style passed to Typography; otherwise its memo wrapper
  // breaks on every parent render even when the font-size hasn't changed.
  const typographyStyle = useMemo(() => ({ '--aim-font-size-root': usedFontSize }) as CSSProperties, [usedFontSize]);

  return (
    <AIMarkdownMetadataProvider<TRenderData> metadata={metadata}>
      <AIMarkdownRenderStateProvider<TConfig>
        streaming={streaming}
        fontSize={usedFontSize}
        variant={variant}
        colorScheme={colorScheme}
        documentId={usedDocumentId}
        defaultConfig={stableDefaultConfig}
        config={stableConfig}
      >
        <Typography
          fontSize={usedFontSize}
          variant={variant}
          colorScheme={colorScheme}
          // Inject CSS custom properties onto the Typography root element.
          // --aim-font-size-root: absolute font-size anchor so inner CSS can
          //   bypass em-compounding in deeply nested markdown structures.
          // See AIMarkdownTypographyProps.style JSDoc for the full variable list.
          style={typographyStyle}
        >
          {ExtraStyles ? (
            <ExtraStyles>
              <AIMarkdownContent
                content={usedContent}
                customComponents={stableCustomComponents}
                urlTransform={urlTransform ?? undefined}
                sanitizeSchema={stableSanitizeSchema}
              />
            </ExtraStyles>
          ) : (
            <AIMarkdownContent
              content={usedContent}
              customComponents={stableCustomComponents}
              urlTransform={urlTransform ?? undefined}
              sanitizeSchema={stableSanitizeSchema}
            />
          )}
        </Typography>
      </AIMarkdownRenderStateProvider>
    </AIMarkdownMetadataProvider>
  );
};

/**
 * A React component for rendering AI-generated markdown with rich formatting support.
 *
 * Features:
 * - GFM (tables, strikethrough, task lists, autolinks)
 * - LaTeX math rendering via KaTeX
 * - Emoji shortcodes
 * - CJK-friendly line breaking and spacing
 * - Configurable syntax extensions (highlight, definition lists, super/subscript)
 * - Configurable display optimizations (SmartyPants, pangu, comment removal)
 * - Streaming-aware rendering
 * - Customizable typography, color scheme, and component overrides
 *
 * @example
 * ```tsx
 * <AIMarkdown
 *   content={markdownString}
 *   streaming={isStreaming}
 *   colorScheme="dark"
 *   config={{ extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT] }}
 * />
 * ```
 */
const AIMarkdown = memo(AIMarkdownComponent);
AIMarkdown.displayName = 'AIMarkdown';

export default AIMarkdown as typeof AIMarkdownComponent;

// ── Public API re-exports ───────────────────────────────────────────────────

// Types
export type { AIMDContentPreprocessor };
export type {
  AIMarkdownCustomComponents,
  AIMarkdownRenderConfig,
  AIMarkdownRenderState,
  AIMarkdownMetadata,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
} from './defs';

// Enums & Constants
export {
  AIMarkdownRenderExtraSyntax,
  AIMarkdownRenderDisplayOptimizeAbility,
  defaultAIMarkdownRenderConfig,
} from './defs';

// Hooks -- for custom components to access render state & metadata
export { useAIMarkdownRenderState, useAIMarkdownMetadata } from './context';
export { useStableValue };

// URL handling — primitives for the `urlTransform` prop and a factory
// helper for the `sanitizeSchema` prop on `<AIMarkdown>`.
//
// `urlTransform` has no helper because composition with `defaultUrlTransform`
// is already the natural JS pattern (one-line closure). `extendSanitizeSchema`
// is the ONLY supported way to build a custom sanitize schema — it hands the
// caller a deep clone of the library default (which itself includes invariants
// like the cross-chunk tag allowlist and KaTeX className allowlist), so direct
// mutation is safe and the invariants are preserved automatically. The library
// default schema is intentionally NOT exported as a value to prevent the
// classic shallow-spread footgun (`{ ...sanitizeSchema }` aliases nested
// arrays). Consumers who want to read default values can invoke the helper
// with a logging modifier — see `extendSanitizeSchema`'s JSDoc for the
// recipe. Only the `SanitizeSchema` type is exported, for callers building
// typed helpers around the prop.
export { defaultUrlTransform } from './components/markdown';
export type { UrlTransform } from './components/markdown';
export { extendSanitizeSchema } from './components/extendSanitizeSchema';
export type { SanitizeSchema } from './components/extendSanitizeSchema';

// Cross-chunk coordination wrapper + hook
export { AIMarkdownDocuments, useDocumentRegistry } from './components/AIMarkdownDocuments';
export type { AIMarkdownDocumentsProps } from './components/AIMarkdownDocuments';
// Registry types — consumers writing typed helpers around useDocumentRegistry
// (`function helper(r: Registry)`) need these. The Registry shape itself is a
// public contract: we maintain backwards compat across minor versions.
export type { Registry, ChunkData, FootnoteDef, LinkDef, RefRecord, RefKind } from './components/documentRegistry';

// Utils
export type { PartialDeep } from './typings/partial-deep';
