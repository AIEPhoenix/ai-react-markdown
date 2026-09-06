import { describe, expect, test, vi } from 'vitest';
import { resolveCrossChunkReference } from './resolveCrossChunkReference';
import { sanitizeSchema } from './sanitizeSchema';
import { defaultUrlTransform } from './markdown';

describe('resolved cross-chunk elements', () => {
  test('honors final tag/attribute removal, including image alt and title', () => {
    const schema = { ...sanitizeSchema, attributes: { ...sanitizeSchema.attributes, a: [], img: [], '*': [] } };
    for (const tagName of ['a', 'img'] as const) {
      const result = resolveCrossChunkReference(
        { tagName, url: '/x', title: 'title', alt: 'alt' },
        schema,
        defaultUrlTransform,
        'doc-'
      );
      expect(result.element?.properties).toEqual({});
    }
    const withoutA = { ...sanitizeSchema, tagNames: sanitizeSchema.tagNames!.filter((t) => t !== 'a') };
    expect(resolveCrossChunkReference({ tagName: 'a', url: '/x' }, withoutA, defaultUrlTransform, 'doc-')).toEqual({
      element: null,
      keepChildren: true,
    });
    expect(
      resolveCrossChunkReference(
        { tagName: 'a', url: '/x' },
        { ...withoutA, strip: ['a'] },
        defaultUrlTransform,
        'doc-'
      )
    ).toEqual({ element: null, keepChildren: false });
  });

  test('normalizes, sanitizes and rebases before a single URL transform', () => {
    const transform = vi.fn((url: string) => url + '-transformed');
    const result = resolveCrossChunkReference(
      { tagName: 'a', url: '#章节', title: 'title' },
      sanitizeSchema,
      transform,
      'doc-'
    );
    expect(transform).toHaveBeenCalledTimes(1);
    expect(transform.mock.calls[0][0]).toBe('#doc-%E7%AB%A0%E8%8A%82');
    expect(result.element?.properties.href).toBe('#doc-%E7%AB%A0%E8%8A%82-transformed');
    expect(
      resolveCrossChunkReference({ tagName: 'a', url: '#doc-existing' }, sanitizeSchema, defaultUrlTransform, 'doc-')
        .element?.properties.href
    ).toBe('#doc-existing');
    transform.mockClear();
    expect(
      resolveCrossChunkReference({ tagName: 'a', url: 'javascript:alert(1)' }, sanitizeSchema, transform, 'doc-')
        .element?.properties.href
    ).toBeUndefined();
    expect(transform).not.toHaveBeenCalled();
  });

  test('keeps required properties and legal empty destinations', () => {
    const schema = { ...sanitizeSchema, required: { a: { rel: ['nofollow'] } } };
    expect(
      resolveCrossChunkReference({ tagName: 'a', url: '' }, schema, defaultUrlTransform, 'doc-').element?.properties
    ).toEqual({ href: '', rel: ['nofollow'] });
  });

  test('passes real link children to the URL callback without transforming descendants twice', () => {
    const child = { type: 'element' as const, tagName: 'img', properties: { src: '/nested' }, children: [] };
    const callback = vi.fn((url: string, _key: string, node: import('hast').Element) => {
      expect(node.children).toEqual([child]);
      return url;
    });
    resolveCrossChunkReference(
      { tagName: 'a', url: '/target', node: { children: [child] } },
      sanitizeSchema,
      callback,
      'doc-'
    );
    expect(callback).toHaveBeenCalledTimes(1);
    expect(child.properties.src).toBe('/nested');
  });
});
