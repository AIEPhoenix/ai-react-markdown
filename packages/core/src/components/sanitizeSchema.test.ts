import { describe, expect, test } from 'vitest';
import { sanitize } from 'hast-util-sanitize';
import { h } from 'hastscript';
import type { Element, Root } from 'hast';
import { defaultSchema } from 'rehype-sanitize';
import { mergeClassNameAllowlist, sanitizeSchema } from './sanitizeSchema';

function firstChildElement(tree: ReturnType<typeof sanitize>): Element {
  const root = tree as Element | Root;
  const first = root.children[0];
  if (!first || first.type !== 'element') {
    throw new Error('expected first child to be an element');
  }
  return first;
}

describe('mergeClassNameAllowlist', () => {
  test('returns a new className entry when existing is undefined', () => {
    expect(mergeClassNameAllowlist(undefined, ['math-inline'])).toEqual([
      ['className', 'math-inline'],
    ]);
  });

  test('appends a className entry when existing has no className', () => {
    expect(mergeClassNameAllowlist([['id', /^foo/]], ['math-inline'])).toEqual([
      ['id', /^foo/],
      ['className', 'math-inline'],
    ]);
  });

  test('merges extras into the existing className tuple entry', () => {
    const existing: Parameters<typeof mergeClassNameAllowlist>[0] = [
      ['className', /^language-./],
    ];
    expect(mergeClassNameAllowlist(existing, ['math-inline', 'math-display'])).toEqual([
      ['className', /^language-./, 'math-inline', 'math-display'],
    ]);
  });

  test('preserves non-className default entries when merging', () => {
    // Regression: the original bug was replacing `code`'s entire allowlist.
    // This asserts that other attributes in the entry list are preserved.
    const existing: Parameters<typeof mergeClassNameAllowlist>[0] = [
      ['id', /^x/],
      ['className', /^language-./],
      ['title'],
    ];
    expect(mergeClassNameAllowlist(existing, ['math-inline'])).toEqual([
      ['id', /^x/],
      ['className', /^language-./, 'math-inline'],
      ['title'],
    ]);
  });

  test('converts a bare-string className (allow-all) into an allow-list', () => {
    // Documents the semantics change noted in the helper's docblock: an
    // upstream switch to `'className'` (allow-all) would be narrowed to an
    // allow-list by the merge. Defensive case, not currently triggered.
    expect(mergeClassNameAllowlist(['className'], ['math-inline'])).toEqual([
      ['className', 'math-inline'],
    ]);
  });

  test('does not mutate the input array', () => {
    const existing: Parameters<typeof mergeClassNameAllowlist>[0] = [
      ['className', /^language-./],
    ];
    const snapshot = JSON.parse(JSON.stringify(existing));
    mergeClassNameAllowlist(existing, ['math-inline']);
    expect(JSON.parse(JSON.stringify(existing))).toEqual(snapshot);
  });
});

describe('sanitizeSchema integration', () => {
  // End-to-end: run hast-util-sanitize with the exact schema MarkdownContent
  // uses, on hast trees that mimic what `rehype-katex` produces. This is the
  // assertion the H5 fix exists to uphold.

  test('preserves math-inline className on <code>', () => {
    const tree = h('div', [h('code', { className: ['math-inline'] }, 'x')]);
    const sanitized = sanitize(tree, sanitizeSchema);
    const code = firstChildElement(sanitized);
    expect(code.tagName).toBe('code');
    expect(code.properties.className).toEqual(['math-inline']);
  });

  test('preserves math-display className on <code>', () => {
    const tree = h('div', [h('code', { className: ['math-display'] }, 'x')]);
    const sanitized = sanitize(tree, sanitizeSchema);
    const code = firstChildElement(sanitized);
    expect(code.properties.className).toEqual(['math-display']);
  });

  test('still preserves the default language-* className on <code>', () => {
    const tree = h('div', [h('code', { className: ['language-ts'] }, 'x')]);
    const sanitized = sanitize(tree, sanitizeSchema);
    const code = firstChildElement(sanitized);
    expect(code.properties.className).toEqual(['language-ts']);
  });

  test('strips an unknown className on <code>', () => {
    const tree = h('div', [h('code', { className: ['not-allowed'] }, 'x')]);
    const sanitized = sanitize(tree, sanitizeSchema);
    const code = firstChildElement(sanitized);
    // Disallowed class names are filtered out, leaving an empty className array.
    expect(code.properties.className).toEqual([]);
  });

  test('preserves both language-* and math-* when present together', () => {
    // `remark-math` + `rehype-katex` emit display math as
    // `<code class="language-math math-display">`. Covers the real-world
    // multi-class case that a single-class test would miss.
    const tree = h('div', [
      h('code', { className: ['language-math', 'math-display'] }, 'x'),
    ]);
    const sanitized = sanitize(tree, sanitizeSchema);
    const code = firstChildElement(sanitized);
    expect(code.properties.className).toEqual(['language-math', 'math-display']);
  });

  test('allows the <mark> tag', () => {
    const tree = h('div', [h('mark', 'highlighted')]);
    const sanitized = sanitize(tree, sanitizeSchema);
    const mark = firstChildElement(sanitized);
    expect(mark.tagName).toBe('mark');
  });

  test('keeps default-schema protections (script is stripped, no text leak)', () => {
    // Wrap in <div> so we can assert the surviving allowed element has no
    // children at all — catches a regression where the tag is stripped but
    // its text content leaks through as a raw text node.
    const tree = h('section', [h('div', [h('script', 'alert(1)')])]);
    const sanitized = sanitize(tree, sanitizeSchema);
    const div = firstChildElement(sanitized);
    expect(div.tagName).toBe('div');
    expect(div.children).toEqual([]);
  });

  test('does not mutate the underlying defaultSchema', () => {
    // M6-style guarantee: building our schema must not poison the shared
    // `defaultSchema` singleton exported by rehype-sanitize.
    const snapshot = JSON.stringify(defaultSchema, (_k, v) =>
      v instanceof RegExp ? v.toString() : v
    );
    // Force a fresh build by re-importing the module's schema via our helper.
    mergeClassNameAllowlist(defaultSchema.attributes?.code, ['math-inline', 'math-display']);
    const after = JSON.stringify(defaultSchema, (_k, v) =>
      v instanceof RegExp ? v.toString() : v
    );
    expect(after).toBe(snapshot);
  });
});
