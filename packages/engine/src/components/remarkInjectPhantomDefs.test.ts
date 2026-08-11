import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { buildPhantomSuffix, SENTINEL_LINK_URL, SENTINEL_FN_CONTENT } from './remarkInjectPhantomDefs';
import type { Root as MdastRoot } from 'mdast';

function parseAugmented(source: string, missingFootnotes: Set<string>, missingLinks: Set<string>): MdastRoot {
  const augmented = source + buildPhantomSuffix({ missingFootnotes, missingLinks });
  return unified().use(remarkParse).use(remarkGfm).parse(augmented) as MdastRoot;
}

describe('buildPhantomSuffix', () => {
  test('returns source unchanged when no labels missing', () => {
    expect(buildPhantomSuffix({ missingFootnotes: new Set(), missingLinks: new Set() })).toBe('');
  });

  test('appends sentinel link def for missing link label', () => {
    const out =
      'hello' +
      buildPhantomSuffix({
        missingFootnotes: new Set(),
        missingLinks: new Set(['X']),
      });
    expect(out.endsWith(`[X]: ${SENTINEL_LINK_URL}\n`)).toBe(true);
  });

  test('appends sentinel footnote def for missing footnote label', () => {
    const out =
      'hello' +
      buildPhantomSuffix({
        missingFootnotes: new Set(['X']),
        missingLinks: new Set(),
      });
    expect(out.endsWith(`[^X]: ${SENTINEL_FN_CONTENT}\n`)).toBe(true);
  });

  test('multi label batch', () => {
    const out =
      'hello' +
      buildPhantomSuffix({
        missingFootnotes: new Set(['A']),
        missingLinks: new Set(['B', 'C']),
      });
    expect(out).toContain(`[B]: ${SENTINEL_LINK_URL}`);
    expect(out).toContain(`[C]: ${SENTINEL_LINK_URL}`);
    expect(out).toContain(`[^A]: ${SENTINEL_FN_CONTENT}`);
  });
});

describe('buildPhantomSuffix integration with remark-parse', () => {
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

  test('without augmentation, orphan ref is dropped to literal text', () => {
    const tree = parseAugmented('See [^X].', new Set(), new Set());
    let found = false;
    visit(tree, 'footnoteReference', () => {
      found = true;
    });
    expect(found).toBe(false); // micromark dropped the ref
  });
});
