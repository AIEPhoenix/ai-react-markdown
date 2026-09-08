/**
 * Core type definitions for ai-react-markdown: metadata, typography
 * theming, and the custom-component override surface. Engine/behavior
 * configuration lives on the flat prop surface (see `index.tsx`) and the
 * sealed plugin catalog (`plugins/`).
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
   * The built-in `default` variant consumes this variable: its spacing,
   * font-size, and heading tokens are defined as `calc(var(--aim-font-size-root) * k)`,
   * so the `fontSize` prop proportionally scales every rendered dimension.
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
