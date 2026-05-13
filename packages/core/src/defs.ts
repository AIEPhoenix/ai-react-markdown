/**
 * Core type definitions, enums, and default configuration for ai-react-markdown.
 *
 * This module defines the public API surface for configuring the renderer,
 * including extra markdown syntax extensions, display optimization abilities,
 * typography theming, and the shared render state shape.
 *
 * @module defs
 */

import { ComponentType, CSSProperties, PropsWithChildren } from 'react';
import type { Components } from './components/markdown';

/**
 * Custom component overrides for the markdown renderer.
 * Alias for the local Markdown wrapper's `Components` type (a vendored fork of
 * react-markdown's), re-exported under the library's `AIMarkdown` naming
 * convention so consumers don't need a direct `react-markdown` dependency
 * for type imports.
 */
export type AIMarkdownCustomComponents = Components;

/**
 * Extra markdown syntax extensions beyond standard GFM.
 * Enable or disable these via {@link AIMarkdownRenderConfig.extraSyntaxSupported}.
 */
export enum AIMarkdownRenderExtraSyntax {
  /** `==Highlight==` syntax support. */
  HIGHLIGHT = 'HIGHLIGHT',
  /** Definition list syntax. @see https://michelf.ca/projects/php-markdown/extra/#def-list */
  DEFINITION_LIST = 'DEFINITION_LIST',
}

/**
 * Display optimization abilities applied during markdown processing.
 * Enable or disable these via {@link AIMarkdownRenderConfig.displayOptimizeAbilities}.
 */
export enum AIMarkdownRenderDisplayOptimizeAbility {
  /** Strip HTML comments from the content. */
  REMOVE_COMMENTS = 'REMOVE_COMMENTS',
  /** Typographic enhancements via SmartyPants (curly quotes, em-dashes, etc.). @see https://www.npmjs.com/package/smartypants */
  SMARTYPANTS = 'SMARTYPANTS',
  /** Automatically insert spaces between CJK and half-width characters. */
  PANGU = 'PANGU',
}

/**
 * Configuration object controlling which markdown extensions and
 * display optimizations are active during rendering.
 *
 * Arrays are typed `readonly` so the interface is assignable from the frozen
 * {@link defaultAIMarkdownRenderConfig}. Consumers can still pass mutable
 * arrays since `readonly T[]` is assignable from `T[]`. Note: this is a
 * compile-time hint only — user-supplied configs are not deep-frozen at
 * runtime, so the library does not guarantee the object remains unchanged
 * after it is passed in.
 */
export interface AIMarkdownRenderConfig {
  /** Extra syntax extensions to enable. */
  readonly extraSyntaxSupported: readonly AIMarkdownRenderExtraSyntax[];
  /** Display optimization abilities to enable. */
  readonly displayOptimizeAbilities: readonly AIMarkdownRenderDisplayOptimizeAbility[];
  /**
   * Whether to enable block-level memoization across renders.
   *
   * When `true` (default), the renderer splits each rendered document into
   * per-block units and memoizes the React subtree of each block by its
   * source identity (`raw + occurrence + ctx + position`). Unchanged blocks
   * during streaming skip `toJsxRuntime` and React reconcile work, reducing
   * per-frame cost roughly proportional to the unchanged fraction of the
   * document. Output is byte-identical to the disabled path.
   *
   * When `false`, the renderer falls back to the legacy bare `<Markdown>`
   * flow — every render runs the full pipeline end-to-end with no
   * cross-frame reuse. Useful for debugging, for environments where the
   * extra `useRef`-backed cache is undesirable, or as an escape hatch if a
   * future custom rehype plugin interacts badly with the plan abstraction.
   *
   * @default true
   */
  readonly blockMemoEnabled: boolean;
  /**
   * Default `true`. Controls Direction A: whether `<AIMarkdown>` (standalone
   * mode) protects orphan `footnoteDefinition` nodes from being silently
   * dropped by `mdast-util-to-hast` when no corresponding `footnoteReference`
   * exists. Implemented via a custom `footnoteDefinition` handler that
   * proactively registers the label in `state.footnoteOrder`.
   *
   * When `<AIMarkdown>` is wrapped in `<AIMarkdownDocuments>`, this field
   * is ignored — the wrapper's `preserveOrphanReferences` prop overrides
   * unconditionally for all chunks under it.
   */
  readonly preserveOrphanReferences: boolean;
}

/**
 * Sensible default configuration with all extensions and optimizations enabled.
 * Frozen at both the top level and the inner arrays so this shared singleton
 * cannot be mutated by any consumer.
 */
export const defaultAIMarkdownRenderConfig = Object.freeze({
  extraSyntaxSupported: Object.freeze([
    AIMarkdownRenderExtraSyntax.HIGHLIGHT,
    AIMarkdownRenderExtraSyntax.DEFINITION_LIST,
  ]),
  displayOptimizeAbilities: Object.freeze([
    AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS,
    AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS,
    AIMarkdownRenderDisplayOptimizeAbility.PANGU,
  ]),
  blockMemoEnabled: true,
  preserveOrphanReferences: true,
}) satisfies AIMarkdownRenderConfig;

/**
 * Arbitrary metadata that consumers can pass through a dedicated React context.
 * Custom renderers can access this via the {@link useAIMarkdownMetadata} hook.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AIMarkdownMetadata extends Record<string, any> {}

/**
 * Typography variant identifier. Built-in variant is `'default'`;
 * consumers may define additional variants via custom typography components.
 */
export type AIMarkdownVariant = 'default' | (string & {});

/**
 * Color scheme identifier. Built-in schemes are `'light'` and `'dark'`;
 * consumers may define additional schemes via custom typography CSS.
 */
export type AIMarkdownColorScheme = 'light' | 'dark' | (string & {});

/** Props accepted by a typography wrapper component. */
export interface AIMarkdownTypographyProps extends PropsWithChildren {
  /** Resolved CSS font-size value (e.g. `'14px'`, `'0.875rem'`). */
  fontSize: string;
  /** Active typography variant. */
  variant?: AIMarkdownVariant;
  /** Active color scheme. */
  colorScheme?: AIMarkdownColorScheme;
  /**
   * Inline styles injected by the core renderer. Custom Typography implementations
   * **must** merge this object into their root element's `style` to ensure CSS
   * custom properties set by the core are available to all descendant nodes.
   *
   * ### Currently injected variables
   *
   * | Variable                | Value          | Purpose                                                  |
   * |-------------------------|----------------|----------------------------------------------------------|
   * | `--aim-font-size-root`  | `fontSize` prop | Absolute font-size anchor for the component instance.   |
   *
   * #### Why `--aim-font-size-root`?
   *
   * Markdown content frequently nests elements that use relative `em` units
   * (blockquotes, lists, code blocks). Each nesting level compounds the
   * effective size — a `0.875em` code span inside a `1.125em` blockquote
   * becomes `0.984375em` of the parent, not `0.875em` of the root.
   *
   * `--aim-font-size-root` provides the component-level root font-size as an
   * absolute reference so that inner CSS rules can use
   * `font-size: var(--aim-font-size-root)` to opt out of `em` compounding
   * when a stable size is needed.
   *
   * @example
   * ```tsx
   * const MyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
   *   <div className="my-typo" style={{ fontSize, ...style }}>
   *     {children}
   *   </div>
   * );
   * ```
   */
  style?: CSSProperties;
}

/** React component type for the typography wrapper. */
export type AIMarkdownTypographyComponent = ComponentType<AIMarkdownTypographyProps>;

/** Props accepted by an optional extra style wrapper component. */
export interface AIMarkdownExtraStylesProps extends PropsWithChildren {}

/** React component type for an optional extra style wrapper. */
export type AIMarkdownExtraStylesComponent = ComponentType<AIMarkdownExtraStylesProps>;

/**
 * Immutable render state exposed to all descendant components via React context.
 * Access this with the {@link useAIMarkdownRenderState} hook.
 *
 * Metadata is provided via a separate context — use {@link useAIMarkdownMetadata} instead.
 *
 * @typeParam TConfig - Render configuration type (defaults to {@link AIMarkdownRenderConfig}).
 */
export interface AIMarkdownRenderState<TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig> {
  /** Whether the content is currently being streamed (e.g. from an LLM). */
  streaming: boolean;
  /** Resolved CSS font-size value. */
  fontSize: string;
  /** Active typography variant. */
  variant: AIMarkdownVariant;
  /** Active color scheme. */
  colorScheme: AIMarkdownColorScheme;
  /**
   * Stable identifier unique to this *logical markdown document*. Used as
   * the id namespace for clobberable attributes (`id`, hash hrefs) so two
   * documents on the same page don't cross-link — e.g. clicking a footnote
   * `[^1]` in message A won't scroll to the `[^1]` definition in message B.
   *
   * Named `documentId` (not `instanceId`) intentionally: when one logical
   * markdown document is split into multiple `<AIMarkdown>` instances
   * (chunked / streamed rendering), every chunk SHOULD share the same value
   * so id-prefixes align across the chunks.
   *
   * Auto-generated via React's `useId()` (SSR-safe, stable across
   * re-renders) when not provided by the consumer; consumer-supplied values
   * always win.
   */
  documentId: string;
  /**
   * Per-document URI-safe id prefix used by all clobberable attributes
   * (`id="…"` / `href="#…"`). Derived once by the provider and exposed here
   * so downstream consumers (placeholder components, cross-chunk anchor
   * logic) read a single canonical source instead of recomputing locally.
   *
   * Derivation is `${encodeURIComponent(shortenDocumentId(documentId))}-user-content-`:
   * `documentId` is first run through a MurmurHash3 → Base62 shortener
   * (no-op for ids ≤16 chars, ≤6-char hash otherwise) to keep the rendered
   * HTML compact when consumers pass long UUIDs/nanoids. The shortening
   * is purely a render-output concern — `state.documentId` itself is left
   * raw, and registry keying (`useDocumentRegistry`) reads that raw value.
   * Do not reconstruct this prefix from `documentId` at call sites; always
   * read it through this field.
   */
  clobberPrefix: string;
  /** Active render configuration. */
  config: TConfig;
}
