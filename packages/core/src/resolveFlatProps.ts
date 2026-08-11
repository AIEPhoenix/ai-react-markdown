/**
 * Single-point resolver for the flat engine/behavior props (v2.0.0).
 *
 * Precedence has exactly two levels (EXECUTION-PLAN §3.7):
 *
 * > An explicitly passed prop overrides the shipped default; an absent prop
 * > falls to the shipped default. "Explicit" is defined library-wide as
 * > `v != null` — explicitly passing `null` counts as absent, guarding
 * > against serialization boundaries (RSC, persistence) materializing
 * > "not passed" as `null` and punching through defaults.
 *
 * Resolution happens exactly once, in `<AIMarkdown>`; both the internal
 * pipeline props and the context payloads derive from this single
 * resolution. Resolved values are handed to the pipeline as individual
 * props — never as a bag (no whole-object ever enters a deps array or
 * cache identity; see EXECUTION-PLAN §3.4).
 *
 * @module resolveFlatProps
 */

import { defaultEnginePlugins } from '@ai-react-markdown/engine';
import { getEnginePluginInternals, type AIMarkdownEnginePlugin } from '@ai-react-markdown/engine';

/** Module-scope dev flag — resolved at build time (see `useReferenceFlipWarning`'s docblock). */
const __DEV__ = process.env.NODE_ENV !== 'production';

/**
 * Shipped defaults of the three Behaviors switches — the SINGLE source of
 * truth, shared by {@link resolveEngineValues} and the direct-provider
 * destructure defaults in `context.tsx` (in-repo stories / test harnesses
 * composing `AIMarkdownProvider` without `<AIMarkdown>` must see the same
 * values).
 * @internal
 */
export const SHIPPED_BEHAVIOR_DEFAULTS = Object.freeze({
  blockMemo: true,
  incrementalParse: true,
  preserveOrphanReferences: true,
} as const);

/** Flat props the resolver consumes. `null` is tolerated at runtime (≡ absent). */
export interface AIMarkdownFlatEngineProps {
  blockMemo?: boolean | null;
  incrementalParse?: boolean | null;
  preserveOrphanReferences?: boolean | null;
  enginePlugins?: readonly AIMarkdownEnginePlugin[] | null;
}

/** Fully resolved values for every engine-consumed field. */
export interface ResolvedEngineValues {
  blockMemo: boolean;
  incrementalParse: boolean;
  preserveOrphanReferences: boolean;
  /** Sanitized selection; absent prop → `defaultEnginePlugins` (all five). */
  enginePlugins: readonly AIMarkdownEnginePlugin[];
}

/**
 * Validate a user-supplied plugin selection: duplicate members (by name)
 * are deduplicated and objects without sealed metadata (forged / foreign)
 * are dropped — dev builds warn in both cases. Returns the INPUT array
 * identity when nothing was removed, so downstream chain memos keyed on
 * the selection identity stay warm.
 *
 * Chain position never depends on this array's order — the canonical
 * per-stage tables in `pluginChain.ts` fix each plugin's splice position.
 */
export function sanitizeEnginePlugins(plugins: readonly AIMarkdownEnginePlugin[]): readonly AIMarkdownEnginePlugin[] {
  let kept: AIMarkdownEnginePlugin[] | null = null;
  const seen = new Set<string>();
  for (let index = 0; index < plugins.length; index++) {
    const plugin = plugins[index];
    let drop = false;
    if (getEnginePluginInternals(plugin) === null) {
      drop = true;
      if (__DEV__) {
        console.warn(
          `[AIMarkdown] \`enginePlugins\` received an object that is not a sealed engine plugin` +
            `${plugin && typeof plugin === 'object' && 'name' in plugin ? ` (name: ${String(plugin.name)})` : ''}. ` +
            `Only the core-exported plugins from '@ai-react-markdown/core/plugins' are accepted; ` +
            `the entry was ignored. Third-party content extension goes through ` +
            `\`contentPreprocessors\` and \`customComponents\`.`
        );
      }
    } else if (seen.has(plugin.name)) {
      drop = true;
      if (__DEV__) {
        console.warn(
          `[AIMarkdown] \`enginePlugins\` contains duplicate entries for "${plugin.name}"; duplicates are ignored.`
        );
      }
    } else {
      seen.add(plugin.name);
    }
    if (drop) {
      kept ??= plugins.slice(0, index) as AIMarkdownEnginePlugin[];
    } else {
      kept?.push(plugin);
    }
  }
  return kept ?? plugins;
}

/**
 * Resolve the flat props against the shipped defaults. The three boolean
 * defaults here ARE the shipped defaults of the Behaviors system — note
 * the v2.0.0 absence-semantics flip: an absent `incrementalParse` now
 * means the shipped default (`true`), not the v1.x custom-`defaultConfig`
 * trap value (`false`).
 */
export function resolveEngineValues(flat: AIMarkdownFlatEngineProps): ResolvedEngineValues {
  return {
    blockMemo: flat.blockMemo ?? SHIPPED_BEHAVIOR_DEFAULTS.blockMemo,
    incrementalParse: flat.incrementalParse ?? SHIPPED_BEHAVIOR_DEFAULTS.incrementalParse,
    preserveOrphanReferences: flat.preserveOrphanReferences ?? SHIPPED_BEHAVIOR_DEFAULTS.preserveOrphanReferences,
    enginePlugins: flat.enginePlugins != null ? sanitizeEnginePlugins(flat.enginePlugins) : defaultEnginePlugins,
  };
}
