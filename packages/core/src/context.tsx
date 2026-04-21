/**
 * React context for the AIMarkdown render state.
 *
 * Provides an immutable {@link AIMarkdownRenderState} object to all descendant
 * components. The provider deep-merges user-supplied partial configuration with
 * the built-in defaults so that consumers always receive a complete config.
 *
 * @module context
 */

import { PropsWithChildren, createContext, useContext, useMemo } from 'react';
import mergeWith from 'lodash-es/mergeWith';
import {
  AIMarkdownRenderConfig,
  AIMarkdownMetadata,
  AIMarkdownRenderState,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
  defaultAIMarkdownRenderConfig,
} from './defs';
import type { PartialDeep } from './typings/partial-deep';

const AIMarkdownRenderStateContext = createContext<AIMarkdownRenderState<AIMarkdownRenderConfig> | null>(null);

const AIMarkdownMetadataContext = createContext<AIMarkdownMetadata | undefined>(undefined);

/**
 * Access the current {@link AIMarkdownRenderState} from within the `<AIMarkdown>` tree.
 *
 * Must be called inside a component rendered as a descendant of `<AIMarkdown>`.
 * Throws if called outside the provider boundary.
 *
 * ### `TConfig` is a caller-asserted type, not a derived one
 *
 * The generic parameter is **an assertion the caller makes about the provider
 * above it** — TypeScript cannot verify that the actual `<AIMarkdown>` in the
 * tree was configured with a matching `defaultConfig: TConfig`. If you pass a
 * wider `TConfig` than what the provider actually carries, field access at
 * compile time will look fine but resolve to `undefined` at runtime.
 *
 * The intended pattern is that extension packages (e.g. `@ai-react-markdown/mantine`)
 * ship their own narrow wrapper hook alongside a matching `defaultConfig`, so the
 * assertion is made *once* next to the provider configuration and consumers of the
 * wrapper never touch the raw generic.
 *
 * @typeParam TConfig - Caller-asserted configuration shape (defaults to
 *   {@link AIMarkdownRenderConfig}). Must be aligned with the provider's
 *   `defaultConfig` — the library does not check this at runtime.
 * @returns The current render state (does not include metadata — use
 *   {@link useAIMarkdownMetadata} for that).
 * @throws If called outside an `<AIMarkdown>` provider tree.
 *
 * @example Base usage — no generic, always safe:
 * ```tsx
 * function CustomCodeBlock({ children }: PropsWithChildren) {
 *   const { streaming, config } = useAIMarkdownRenderState();
 *   // config: AIMarkdownRenderConfig — guaranteed shape
 * }
 * ```
 *
 * @example Wrapper-hook pattern — the intended way to use an extended TConfig:
 * ```tsx
 * // In your extension package (pin the assertion in one place):
 * interface ExtendedConfig extends AIMarkdownRenderConfig {
 *   themeMode: 'light' | 'dark' | 'auto';
 * }
 * export const extendedDefaultConfig: ExtendedConfig = {
 *   ...defaultAIMarkdownRenderConfig,
 *   themeMode: 'auto',
 * };
 * export const useExtendedRenderState = () =>
 *   useAIMarkdownRenderState<ExtendedConfig>();
 *
 * // Provider is always configured with the matching defaultConfig:
 * <AIMarkdown defaultConfig={extendedDefaultConfig} ...>{children}</AIMarkdown>
 *
 * // Consumers use the narrow wrapper — no raw generic anywhere:
 * const { config } = useExtendedRenderState();
 * config.themeMode; // correctly typed and present at runtime
 * ```
 *
 * @see `@ai-react-markdown/mantine` — real-world reference. Its
 *   `MantineAIMarkdownRenderConfig`, `defaultMantineAIMarkdownRenderConfig`,
 *   `<MantineAIMarkdown>` (which passes `defaultConfig` by default), and
 *   `useMantineAIMarkdownRenderState` implement this exact pattern.
 */
export function useAIMarkdownRenderState<TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig>() {
  // `as` is intentional: TConfig is a caller assertion (see JSDoc). The
  // alignment with the provider's `defaultConfig` is the caller's contract.
  const context = useContext(AIMarkdownRenderStateContext) as AIMarkdownRenderState<TConfig> | null;

  if (!context) {
    throw new Error('useAIMarkdownRenderState must be used within an <AIMarkdown /> component.');
  }

  return context;
}

/**
 * Access the current metadata from within the `<AIMarkdown>` tree.
 *
 * Metadata lives in a separate React context so that changes to metadata
 * do not cause re-renders in components that only consume render state
 * (e.g. {@link MarkdownContent}).
 *
 * ### `TMetadata` is a caller-asserted type
 *
 * Same contract as {@link useAIMarkdownRenderState} — the generic is an
 * assertion about the `metadata` prop passed to the provider above, not a
 * value TypeScript can derive.  Unlike render-state config, metadata has no
 * runtime fallback: if the provider received no `metadata`, the hook returns
 * `undefined` regardless of the asserted type. Prefer wrapping this hook in
 * a project-local hook that pins `TMetadata` next to the call site that
 * actually provides the metadata.
 *
 * @typeParam TMetadata - Caller-asserted metadata shape (defaults to
 *   {@link AIMarkdownMetadata}). Caller is responsible for ensuring the
 *   provider's `metadata` prop matches this shape.
 * @returns The current metadata, or `undefined` if none was provided.
 *
 * @see `@ai-react-markdown/mantine` — `useMantineAIMarkdownMetadata` applies
 *   the wrapper pattern to this hook, pinning `MantineAIMarkdownMetadata` in
 *   a single location.
 */
export function useAIMarkdownMetadata<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>() {
  // `as` is intentional: TMetadata is a caller assertion (see JSDoc).
  return useContext(AIMarkdownMetadataContext) as TMetadata | undefined;
}

/** Props for {@link AIMarkdownRenderStateProvider}. */
export interface AIMarkdownRenderStateProviderProps<
  TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig,
> extends PropsWithChildren {
  streaming: boolean;
  fontSize: string;
  variant: AIMarkdownVariant;
  colorScheme: AIMarkdownColorScheme;
  /**
   * Base default config to merge against. When omitted, falls back to
   * {@link defaultAIMarkdownRenderConfig}. Sub-packages (e.g. mantine) can
   * pass their own extended defaults here.
   */
  defaultConfig?: TConfig;
  /** Partial config that will be deep-merged with the default config. */
  config?: PartialDeep<TConfig>;
}

/** Props for {@link AIMarkdownMetadataProvider}. */
export interface AIMarkdownMetadataProviderProps<
  TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata,
> extends PropsWithChildren {
  metadata?: TMetadata;
}

/**
 * Custom lodash `mergeWith` handler: arrays from the source (user config)
 * fully replace the target (default config) instead of being merged by index.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const configMergeCustomizer = (
  _objValue: any,
  srcValue: any,
  _key: string,
  _object: any,
  _source: any,
  _stack: any
) => {
  if (Array.isArray(srcValue)) {
    return srcValue;
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Provider that exposes consumer-provided metadata via a dedicated React context.
 * Separated from render state so that metadata changes do not trigger
 * re-renders in components that only consume render state.
 */
export const AIMarkdownMetadataProvider = <RDT extends AIMarkdownMetadata = AIMarkdownMetadata>({
  metadata,
  children,
}: AIMarkdownMetadataProviderProps<RDT>) => {
  return <AIMarkdownMetadataContext.Provider value={metadata}>{children}</AIMarkdownMetadataContext.Provider>;
};

/**
 * Internal provider that deep-merges user config with defaults and exposes
 * the resulting {@link AIMarkdownRenderState} to the component tree.
 */
const AIMarkdownRenderStateProvider = <RCT extends AIMarkdownRenderConfig = AIMarkdownRenderConfig>({
  streaming,
  fontSize,
  variant,
  colorScheme,
  defaultConfig,
  config,
  children,
}: AIMarkdownRenderStateProviderProps<RCT>) => {
  // Deep-merge user config with defaults into a fresh `{}` so the frozen
  // default is never mutated — avoids the extra cloneDeep pass.
  const baseConfig = defaultConfig ?? defaultAIMarkdownRenderConfig;
  const mergedConfig = useMemo(
    () => (config ? mergeWith({}, baseConfig, config, configMergeCustomizer) as RCT : baseConfig),
    [baseConfig, config]
  );

  // Freeze the state object to enforce immutability downstream.
  const state = useMemo(
    () =>
      Object.freeze({
        streaming,
        fontSize,
        variant,
        colorScheme,
        config: mergedConfig,
      }),
    [streaming, fontSize, variant, colorScheme, mergedConfig]
  );

  return <AIMarkdownRenderStateContext.Provider value={state}>{children}</AIMarkdownRenderStateContext.Provider>;
};

export default AIMarkdownRenderStateProvider;
