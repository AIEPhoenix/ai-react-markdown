import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { augmentSourceWithPhantoms, SENTINEL_LINK_URL, SENTINEL_FN_CONTENT } from './remarkInjectPhantomDefs';
import type { Root as MdastRoot } from 'mdast';

function parseAugmented(source: string, missingFootnotes: Set<string>, missingLinks: Set<string>): MdastRoot {
  const augmented = augmentSourceWithPhantoms(source, { missingFootnotes, missingLinks });
  return unified().use(remarkParse).use(remarkGfm).parse(augmented) as MdastRoot;
}

describe('augmentSourceWithPhantoms', () => {
  test('returns source unchanged when no labels missing', () => {
    expect(augmentSourceWithPhantoms('hello', { missingFootnotes: new Set(), missingLinks: new Set() })).toBe('hello');
  });

  test('appends sentinel link def for missing link label', () => {
    const out = augmentSourceWithPhantoms('hello', {
      missingFootnotes: new Set(),
      missingLinks: new Set(['X']),
    });
    expect(out.endsWith(`[X]: ${SENTINEL_LINK_URL}\n`)).toBe(true);
  });

  test('appends sentinel footnote def for missing footnote label', () => {
    const out = augmentSourceWithPhantoms('hello', {
      missingFootnotes: new Set(['X']),
      missingLinks: new Set(),
    });
    expect(out.endsWith(`[^X]: ${SENTINEL_FN_CONTENT}\n`)).toBe(true);
  });

  test('multi label batch', () => {
    const out = augmentSourceWithPhantoms('hello', {
      missingFootnotes: new Set(['A']),
      missingLinks: new Set(['B', 'C']),
    });
    expect(out).toContain(`[B]: ${SENTINEL_LINK_URL}`);
    expect(out).toContain(`[C]: ${SENTINEL_LINK_URL}`);
    expect(out).toContain(`[^A]: ${SENTINEL_FN_CONTENT}`);
  });
});

describe('augmentSourceWithPhantoms integration with remark-parse', () => {
  test('linkReference is parsed when phantom def is appended', () => {
    const tree = parseAugmented('[click][X]', new Set(), new Set(['X']));
    let found = false;
    visit(tree, 'linkReference', (n) => {
      if ((n.identifier as string).toUpperCase() === 'X') found = true;
    });
    expect(found).toBe(true);
  });

  test('footnoteReference is parsed when phantom footnote def is appended', () => {
    const tree = parseAugmented('See [^X].', new Set(['X']), new Set());
    let found = false;
    visit(tree, 'footnoteReference', () => {
      found = true;
    });
    expect(found).toBe(true);
  });

  test('escape-bearing label (the only real bracket form) round-trips identically', () => {
    // micromark keeps source backslash escapes inside identifiers: a real
    // definition `[foo\]bar]: /url` yields the identifier `foo\]bar`. Labels
    // with a BARE `]` therefore cannot come out of a real parse — the only
    // bracket-bearing labels the registry can ever hold carry the backslash.
    // Injecting the identifier verbatim must reparse to the SAME identifier,
    // so the phantom def actually matches the reference (escaping here would
    // double the backslash and break the match).
    const sourceLabel = String.raw`FOO\]BAR`;
    const tree = parseAugmented(String.raw`[click][foo\]bar]`, new Set(), new Set([sourceLabel]));
    const defIdentifiers: string[] = [];
    visit(tree, 'definition', (n) => {
      defIdentifiers.push(n.identifier);
    });
    let refIdentifier: string | undefined;
    visit(tree, 'linkReference', (n) => {
      refIdentifier = n.identifier;
    });
    // Phantom def parsed as a definition (not a leaked paragraph) …
    expect(defIdentifiers).toHaveLength(1);
    // … and its identifier matches the in-content reference case-insensitively
    // (identifiers are case-folded; normalizeId uppercases the registry side).
    expect(defIdentifiers[0].toUpperCase()).toBe(refIdentifier!.toUpperCase());
    // Nothing from the injected suffix may surface as visible text.
    let leaked = false;
    visit(tree, 'text', (n) => {
      if (n.value.includes(SENTINEL_LINK_URL) || n.value.includes(SENTINEL_FN_CONTENT)) leaked = true;
    });
    expect(leaked).toBe(false);
  });

  test('without augmentation, orphan ref is dropped to literal text', () => {
    const tree = parseAugmented('See [^X].', new Set(), new Set());
    let found = false;
    visit(tree, 'footnoteReference', () => {
      found = true;
    });
    expect(found).toBe(false); // micromark dropped the ref
  });
});
