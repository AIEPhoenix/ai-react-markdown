import { describe, test, expect } from 'vitest';
import rehypeFooterAdorn from './rehypeFooterAdorn';
import type { Element as HastElement, Root as HastRoot } from 'hast';

function tree(...children: HastElement['children']): HastRoot {
  return { type: 'root', children };
}

function section(...children: HastElement[]): HastElement {
  return {
    type: 'element',
    tagName: 'section',
    properties: { dataFootnotes: true, className: ['footnotes'] },
    children,
  };
}

const h2Label: HastElement = {
  type: 'element',
  tagName: 'h2',
  properties: { id: 'user-content-footnote-label', className: ['sr-only'] },
  children: [{ type: 'text', value: 'Footnotes' }],
};

const ol: HastElement = {
  type: 'element',
  tagName: 'ol',
  properties: {},
  children: [],
};

describe('rehypeFooterAdorn', () => {
  test('strips <h2 ...footnote-label> and prepends <hr> inside <section data-footnotes>', () => {
    const root = tree(section(h2Label, ol));
    rehypeFooterAdorn()(root);
    const sec = root.children[0] as HastElement;
    expect(sec.children.length).toBe(2);
    expect((sec.children[0] as HastElement).tagName).toBe('hr');
    expect((sec.children[1] as HastElement).tagName).toBe('ol');
  });

  test('adds aria-label="Footnotes" to the section landmark', () => {
    const root = tree(section(h2Label, ol));
    rehypeFooterAdorn()(root);
    const sec = root.children[0] as HastElement;
    expect(sec.properties?.ariaLabel).toBe('Footnotes');
  });

  test('idempotent — second pass does not add a second <hr>', () => {
    const root = tree(section(h2Label, ol));
    rehypeFooterAdorn()(root);
    rehypeFooterAdorn()(root);
    const sec = root.children[0] as HastElement;
    const hrCount = sec.children.filter((c) => c.type === 'element' && (c as HastElement).tagName === 'hr').length;
    expect(hrCount).toBe(1);
  });

  test('does not touch <section> without data-footnotes', () => {
    const plainSection: HastElement = {
      type: 'element',
      tagName: 'section',
      properties: {},
      children: [h2Label, ol],
    };
    const root = tree(plainSection);
    rehypeFooterAdorn()(root);
    expect((root.children[0] as HastElement).children).toEqual([h2Label, ol]);
  });

  test('preserves a user-authored <h2> with non-matching id', () => {
    const userH2: HastElement = {
      type: 'element',
      tagName: 'h2',
      properties: { id: 'user-section' },
      children: [{ type: 'text', value: 'Custom' }],
    };
    const root = tree(section(userH2, ol));
    rehypeFooterAdorn()(root);
    const sec = root.children[0] as HastElement;
    const tags = sec.children.map((c) => (c as HastElement).tagName);
    expect(tags).toEqual(['hr', 'h2', 'ol']);
  });
});
