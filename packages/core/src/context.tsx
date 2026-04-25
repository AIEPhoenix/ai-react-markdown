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
 * @typeParam TConfig - Expected configuration shape (defaults to {@link AIMarkdownRenderConfig}).
 * @returns The current render state (does not include metadata — use {@link useAIMarkdownMetadata} for that).
 *
 * @example
 * ```tsx
 * function CustomCodeBlock({ children }: PropsWithChildren) {
 *   const { streaming, config } = useAIMarkdownRenderState();
 *   // ...
 * }
 * ```
 */
export function useAIMarkdownRenderState<TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig>() {
  const context = useContext(AIMarkdownRenderStateContext) as AIMarkdownRenderState<TConfig>;

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
 * @typeParam TMetadata - Expected metadata shape (defaults to {@link AIMarkdownMetadata}).
 * @returns The current metadata, or `undefined` if none was provided.
 */
export function useAIMarkdownMetadata<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>() {
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
