/**
 * Type definitions for the sealed engine plugin system (v2 input surface).
 *
 * An "engine plugin" is a first-class, core-exported description of one
 * configurable entry in the unified plugin chain. The five shipped plugins
 * replace the two v1.x enums (`AIMarkdownRenderExtraSyntax` /
 * `AIMarkdownRenderDisplayOptimizeAbility`) as the public way to select
 * optional parse-level capability.
 *
 * ## Why the set is sealed
 *
 * The incremental (prefix-freeze) parse engine's boundary scanner is
 * syntax-aware — it must know the boundary rules of every multiline
 * construct in the chain (see `computeFreezeBoundary`'s `defListEnabled`
 * option). Open plugin injection would void the engine's verification
 * record (50k-sample fuzz, direction batteries, byte equivalence), so
 * plugins are born where the certification rig lives: `packages/core`.
 * Wrappers curate (bundle default sets, filter, facade sugar); consumers
 * select. New parse-level capability lands via an upstream PR into core.
 * Third-party *content* extension stays open through `contentPreprocessors`
 * and `customComponents`.
 *
 * ## Seal mechanics
 *
 * The seal is a type-level contract and design declaration, not runtime
 * tamper-proofing — the same guarantee class as `Object.freeze`. The
 * `'~sealed'` marker key makes accidental construction impossible while
 * keeping the type structural, which is required for the type to remain
 * assignable across the package's two build entries (the root entry and
 * the `/plugins` subpath each bundle their own copy of this declaration;
 * a `unique symbol` brand would make those two copies mutually
 * incompatible). Deliberately forging the marker voids the engine's
 * verification record.
 *
 * @module plugins/defs
 */

/** Names of the five shipped engine plugins. Closed set — see module docs. */
export type AIMarkdownEnginePluginName = 'highlight' | 'definitionList' | 'smartypants' | 'pangu' | 'removeComments';

/**
 * A sealed engine plugin. Values are core-exported singletons from
 * `@ai-react-markdown/core/plugins`; pass them to the `enginePlugins` prop
 * of `<AIMarkdown>`.
 *
 * - Passing an array replaces the default set wholesale (array-atomic
 *   semantics); omitting the prop means `defaultEnginePlugins` (all five).
 * - The produced chain position of each plugin comes from its internal
 *   stage metadata — the order of the user-supplied array is irrelevant.
 * - Duplicate members are deduplicated with a dev warning.
 * - Plugin objects are not serializable; use {@link AIMarkdownEnginePlugin.name}
 *   as the escape hatch for remote-config scenarios (map names back to the
 *   exported singletons at the edge).
 */
export interface AIMarkdownEnginePlugin {
  /** Stable identifier; the serialization escape hatch. */
  readonly name: AIMarkdownEnginePluginName;
  /**
   * @internal Type-level seal — constructible only inside core. Third-party
   * construction (including deliberately forging this marker) voids the
   * incremental engine's verification record.
   */
  readonly '~sealed': 'ai-react-markdown/engine-plugin';
}

/**
 * Chain stage a plugin belongs to. Determines the plugin's splice position
 * in the produced remark chain — user array order never does.
 * @internal
 */
export type EnginePluginStage = 'extraSyntax' | 'displayOptimize';

/**
 * Runtime metadata carried by every sealed plugin object. Not part of the
 * public type — internal consumers read it through
 * {@link getEnginePluginInternals}.
 * @internal
 */
export interface EnginePluginInternals {
  readonly stage: EnginePluginStage;
}

/**
 * Read a sealed plugin's internal metadata. Returns `null` for objects that
 * do not carry it (a forged or foreign object) so callers can reject them
 * defensively instead of crashing.
 * @internal
 */
export function getEnginePluginInternals(plugin: AIMarkdownEnginePlugin): EnginePluginInternals | null {
  const candidate = plugin as unknown as Partial<EnginePluginInternals>;
  return candidate.stage != null ? (candidate as EnginePluginInternals) : null;
}
