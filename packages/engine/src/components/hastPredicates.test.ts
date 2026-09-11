import { describe, expect, test } from 'vitest';
import type { Element as HastElement, Root as HastRoot } from 'hast';

import { isFootnoteSection } from './hastPredicates';
import { parseStage, transformStage } from './markdown';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins, buildCoreRemarkRehypeOptions } from './pluginChain';
import { sanitizeSchema } from './sanitizeSchema';

const synthesized: HastElement = {
  type: 'element',
  tagName: 'section',
  properties: { dataFootnotes: true, className: ['footnotes'] },
  children: [],
};

const authored: HastElement = {
  ...synthesized,
  properties: { dataFootnotes: '' },
  position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 25, offset: 24 } },
};

function run(source: string): HastRoot {
  const parsed = parseStage({
    children: source,
    remarkPlugins: buildCoreRemarkPlugins([]),
    rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, 'doc-user-content-'),
    remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
  });
  return transformStage(parsed);
}

describe('isFootnoteSection', () => {
  test('recognizes the synthesized footer (no source position)', () => {
    expect(isFootnoteSection(synthesized)).toBe(true);
  });

  test('rejects an authored <section data-footnotes> — it carries a source position', () => {
    // The attribute is 24 bytes any document can write; only the footer
    // mdast-util-to-hast synthesizes has no position. Treating the authored
    // element as the footer adorned it, planned it as the synthetic section
    // and, in coordinated mode, dropped it in favour of the aggregate.
    expect(isFootnoteSection(authored)).toBe(false);
  });

  test('rejects other shapes', () => {
    expect(isFootnoteSection({ ...synthesized, tagName: 'div' })).toBe(false);
    expect(isFootnoteSection({ ...synthesized, properties: {} })).toBe(false);
  });

  test('through the pipeline: an authored section is left alone, the real footer is still adorned', () => {
    const hast = run('<section data-footnotes>\n\nauthored body\n\n</section>\n\nclaim[^a]\n\n[^a]: note\n');
    const sections = hast.children.filter((c): c is HastElement => c.type === 'element' && c.tagName === 'section');
    expect(sections).toHaveLength(2);
    const [user, footer] = sections;
    expect(user.position).toBeDefined();
    expect(isFootnoteSection(user)).toBe(false);
    expect(user.properties.ariaLabel).toBeUndefined();
    expect(user.children.some((c) => c.type === 'element' && c.tagName === 'hr')).toBe(false);
    expect(footer.position).toBeUndefined();
    expect(isFootnoteSection(footer)).toBe(true);
    expect(footer.properties.ariaLabel).toBe('Footnotes');
    expect(footer.children[0]).toMatchObject({ type: 'element', tagName: 'hr' });
  });
});
