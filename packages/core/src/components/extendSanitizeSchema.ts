/**
 * Builds a `rehype-sanitize` schema by handing the caller a deep clone of the
 * library default ({@link sanitizeSchema}) to mutate or replace.
 *
 * The mutate-and-return pattern matches the ergonomics of Next.js's
 * `webpack(config)` and Express middleware: a callback receives a draft,
 * either modifies it in place (returning nothing) or returns a fresh object
 * to replace it. The library guarantees the draft is a deep clone, so direct
 * mutation never leaks into the shared default singleton.
 *
 * @module components/extendSanitizeSchema
 */

import cloneDeep from 'lodash-es/cloneDeep';
import type { defaultSchema } from 'rehype-sanitize';
import { sanitizeSchema } from './sanitizeSchema';

/**
 * The full `rehype-sanitize` schema type. Re-exported as the canonical
 * library-internal alias so other modules don't each redeclare
 * `typeof defaultSchema`.
 *
 * The shape is owned by `rehype-sanitize`; consumers should treat it as
 * tracking that upstream type — it may evolve across rehype-sanitize major
 * versions.
 */
export type SanitizeSchema = typeof defaultSchema;

/**
 * Build a sanitize schema by mutating (or replacing) a deep clone of the
 * library default.
 *
 * Designed to be called ONCE at module scope so the returned object has a
 * stable identity across renders — passing it directly into
 * `<AIMarkdown sanitizeSchema={…}>` keeps the block-memo cache warm.
 *
 * @example Append a custom URL protocol via mutation:
 * ```ts
 * const SCHEMA = extendSanitizeSchema((s) => {
 *   s.protocols!.href!.push('myapp');
 *   s.protocols!.src!.push('myapp');
 * });
 *
 * function App() {
 *   return <AIMarkdown content={…} sanitizeSchema={SCHEMA} />;
 * }
 * ```
 *
 * @example Return-style replacement for wider edits:
 * ```ts
 * const SCHEMA = extendSanitizeSchema((s) => ({
 *   ...s,
 *   tagNames: [...(s.tagNames ?? []), 'my-widget'],
 * }));
 * ```
 *
 * @remarks Allowing a protocol on `protocols.href` lets the URL through the
 * SECOND sanitize gate. The FIRST gate (`urlTransform`) must permit the
 * same protocol independently — see the `urlTransform` prop on
 * `<AIMarkdown>` and the exported {@link defaultUrlTransform} for
 * composition. Keep the two protocol lists in sync.
 *
 * ### Footguns
 *
 * - **Reassigning the local parameter** (`(s) => { s = { …new schema… }; }`)
 *   does NOT replace the draft — JS only rebinds the local variable. Either
 *   mutate the original draft or `return` the new object explicitly.
 * - **Returning `null`** is treated the same as returning nothing (the
 *   modified draft is used). The TypeScript signature does not permit
 *   `null`, but JS callers or `as`-casted code paths could silently hit
 *   this. Prefer `return` with no value, or an explicit `return draft;`.
 * - **Throwing inside the modifier** propagates to the call site
 *   uncaught — there is no try/catch. Callers usually invoke this once at
 *   module load, where a thrown error surfaces as a startup-time crash and
 *   is the correct failure mode.
 *
 * @param modifier - Receives a deep clone of the library default. Mutate it
 *   freely; either return the (possibly different) result, or return
 *   nothing to use the mutated draft. Returning `undefined` (and, by
 *   convention, `null`) is treated the same as a mutate-only call.
 * @returns A new `Schema` object — never the library default singleton.
 */
export function extendSanitizeSchema(
  modifier: (draft: SanitizeSchema) => SanitizeSchema | void
): SanitizeSchema {
  // lodash-es `cloneDeep` over the native `structuredClone` because the
  // latter is unavailable on iOS Safari < 15.4 (March 2022) and on older
  // Android WebViews that are still common on mid-tier devices. lodash-es
  // is already pulled in transitively (useStableValue + context use it),
  // so the marginal bundle cost of importing one more named export is tiny;
  // the helper is called once at module scope, so the speed difference
  // versus the native API is irrelevant. Importantly, lodash `cloneDeep`
  // preserves RegExp — a JSON-based deep clone would silently turn the
  // math/language className regexes into `{}` and corrupt sanitize
  // semantics.
  const draft = cloneDeep(sanitizeSchema);
  const result = modifier(draft);
  return result ?? draft;
}
