import { expect, test } from 'vitest';
import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';
import { buildTransform } from '@ai-markdown/engine';
import { cloneHastForRender } from './cloneHastForRender';

test('URL bookkeeping stays render-owned when parser data is frozen', () => {
  const data = Object.freeze({ referenceAncestors: ['p'] });
  const tree: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: Object.freeze({ href: 'https://example.com' }),
        data: data as Element['data'],
        children: [],
      },
    ],
  };
  const render = cloneHastForRender(tree);
  visit(
    render,
    buildTransform({
      urlTransform: (url) => url + '?render',
      allowElement: undefined,
      allowedElements: undefined,
      disallowedElements: undefined,
      skipHtml: undefined,
      unwrapDisallowed: undefined,
    })
  );
  expect(render.children[0]).toMatchObject({
    properties: { href: 'https://example.com?render' },
    data: { originalUrls: { href: 'https://example.com' } },
  });
  expect(tree.children[0]).toMatchObject({ properties: { href: 'https://example.com' }, data });
  expect(data).not.toHaveProperty('originalUrls');
});

test('pre-existing URL stashes are copied without deep-cloning arbitrary plugin data', () => {
  const originalUrls = Object.freeze({ href: '/original' });
  const plugin = { shared: true };
  const tree: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { href: '/changed' },
        data: Object.freeze({ originalUrls, plugin }) as Element['data'],
        children: [],
      },
    ],
  };
  const copy = cloneHastForRender(tree);
  const copied = copy.children[0].data as { originalUrls: Record<string, string>; plugin: object };
  expect(copied.originalUrls).not.toBe(originalUrls);
  copied.originalUrls.href = '/local';
  expect(originalUrls.href).toBe('/original');
  expect(copied.plugin).toBe(plugin);
});
