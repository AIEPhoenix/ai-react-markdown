/**
 * Builds the `rehype-sanitize` schema used by the internal markdown renderer.
 *
 * Extracted into its own module so the merge logic can be unit-tested in
 * isolation without pulling in React or the full markdown pipeline.
 *
 * @module components/sanitizeSchema
 */

import cloneDeep from 'lodash-es/cloneDeep';
import { defaultSchema } from 'rehype-sanitize';

type Schema = typeof defaultSchema;
type AttributeEntry = NonNullable<NonNullable<Schema['attributes']>[string]>[number];

/**
 * Extend the allowlist for a tag's `className` attribute with extra class
 * names while preserving all other default entries.
 *
 * `findDefinition` in hast-util-sanitize returns the *first* matching entry
 * for a given property name, so appending a second `className` entry would be
 * ignored. Instead, merge the allowed values into the existing entry.
 *
 * Edge cases:
 * - `existing` is `undefined` → returns a single new `['className', ...extra]`
 * - `existing` has no `className` entry → appends one with just the extras
 * - `existing` has a bare-string `'className'` entry (hast-util-sanitize's
 *   "allow all values" form) → would be narrowed to an allow-list. This is a
 *   semantics change, but the current `defaultSchema.attributes.code` entry
 *   is always tuple-form, so this branch is defensive only.
 */
export function mergeClassNameAllowlist(
  existing: ReadonlyArray<AttributeEntry> | undefined,
  extraClassNames: readonly string[]
): AttributeEntry[] {
  const entries: AttributeEntry[] = existing ? [...existing] : [];
  const idx = entries.findIndex((entry) =>
    typeof entry === 'string' ? entry === 'className' : entry[0] === 'className'
  );
  if (idx === -1) {
    return [...entries, ['className', ...extraClassNames]];
  }
  const current = entries[idx];
  const merged: AttributeEntry =
    typeof current === 'string' ? ['className', ...extraClassNames] : [...current, ...extraClassNames];
  entries[idx] = merged;
  return entries;
}

const crossChunkTags = ['cross-chunk-link', 'cross-chunk-image', 'footnote-sup'] as const;

/**
 * The full sanitize schema used by the markdown renderer: extends
 * `defaultSchema` to allow `<mark>`, the KaTeX math class names, and the
 * three custom hast tags emitted by cross-chunk coordination handlers.
 *
 * **Owns its arrays and objects.** The shallow spread of `defaultSchema`
 * alone would leave `attributes.a`, `attributes.img`, `protocols`,
 * `ancestors`, and similar nested fields aliased to `rehype-sanitize`'s
 * default singleton. A consumer who reasonably (but mistakenly) writes
 * `sanitizeSchema.protocols.href.push('myapp')` would then poison
 * `rehype-sanitize`'s `defaultSchema` for every other consumer in the
 * process — a cross-package side-effect that's near-impossible to debug.
 *
 * One `cloneDeep` at module init breaks that aliasing without measurable
 * cost (init-time only, single small object graph). The recommended
 * extension API is still {@link extendSanitizeSchema}, which clones again
 * per call; this layer just makes the exported singleton safe if someone
 * skips the helper.
 */
export const sanitizeSchema: Schema = cloneDeep({
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'mark', ...crossChunkTags],
  attributes: {
    ...defaultSchema.attributes,
    code: mergeClassNameAllowlist(defaultSchema.attributes?.code, ['math-inline', 'math-display']),
    'cross-chunk-link': ['label', 'referenceType'],
    'cross-chunk-image': ['label', 'referenceType', 'alt'],
    'footnote-sup': ['label', 'localOccurrence'],
  },
});
