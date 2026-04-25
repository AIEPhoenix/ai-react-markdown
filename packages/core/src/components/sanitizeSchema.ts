/**
 * Builds the `rehype-sanitize` schema used by {@link MarkdownContent}.
 *
 * Extracted into its own module so the merge logic can be unit-tested in
 * isolation without pulling in React or the full markdown pipeline.
 *
 * @module components/sanitizeSchema
 */

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
    typeof current === 'string'
      ? ['className', ...extraClassNames]
      : [...current, ...extraClassNames];
  entries[idx] = merged;
  return entries;
}

/**
 * The full sanitize schema used by the markdown renderer: extends
 * `defaultSchema` to allow `<mark>` and the KaTeX math class names.
 */
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    code: mergeClassNameAllowlist(defaultSchema.attributes?.code, [
      'math-inline',
      'math-display',
    ]),
  },
};
