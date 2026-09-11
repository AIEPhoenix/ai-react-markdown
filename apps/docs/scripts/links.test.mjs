import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteUrl, normalizeBase } from './links.mjs';

const entries = [
  { source: 'docs/guide.md', slug: 'docs/guides/guide' },
  { source: 'packages/vue/README.md', slug: 'docs/vue' },
];
test('repository links preserve anchors and deployment prefixes', () => {
  assert.equal(
    rewriteUrl('../../docs/guide.md#setup', 'packages/vue/README.md', entries, '/preview/docs/'),
    '/preview/docs/docs/guides/guide/#setup'
  );
  assert.equal(rewriteUrl('../packages/vue/README.md', 'docs/guide.md', entries), '/docs/vue/');
  assert.equal(
    rewriteUrl('https://github.com/ai-markdown/ai-markdown/blob/main/docs/guide.md#setup', 'docs/guide.md', entries),
    '/docs/guides/guide/#setup'
  );
});
test('source references and external URLs keep their intended destinations', () => {
  assert.equal(
    rewriteUrl('../packages/vue/src/index.ts', 'docs/guide.md', entries),
    'https://github.com/ai-markdown/ai-markdown/blob/main/packages/vue/src/index.ts'
  );
  for (const url of ['#setup', 'https://example.com/a', 'mailto:hello@example.com', '//example.com/a'])
    assert.equal(rewriteUrl(url, 'docs/guide.md', entries), url);
});
test('examples use the configured catalog or useful local instructions', () => {
  assert.equal(rewriteUrl('storybook:vue/', 'docs/guide.md', entries, '/preview/'), '/preview/docs/guides/storybook/');
  assert.equal(
    rewriteUrl(
      'storybook:react/?path=/docs/example--docs',
      'docs/guide.md',
      entries,
      '/',
      'https://example.com/catalog/'
    ),
    'https://example.com/catalog/react/?path=/docs/example--docs'
  );
});
test('base must be a pathname', () => {
  assert.equal(normalizeBase('/preview/docs'), '/preview/docs/');
  assert.equal(normalizeBase('/'), '/');
  assert.throws(() => normalizeBase('https://example.com/'));
});

test('query strings and anchors both survive rewriting', () => {
  assert.equal(
    rewriteUrl('./guide.md?mode=full#setup', 'docs/guide.md', entries),
    '/docs/guides/guide/?mode=full#setup'
  );
});

test('Markdown, reference and raw HTML links rewrite without altering code examples', async () => {
  const { createMarkdownProcessor } = await import('@astrojs/markdown-remark');
  const { default: rehypeRaw } = await import('rehype-raw');
  const { repositoryLinks } = await import('./links.mjs');
  const { generated } = await import('./content.mjs');
  const { pathToFileURL } = await import('node:url');
  const renderer = await createMarkdownProcessor({
    syntaxHighlight: false,
    rehypePlugins: [rehypeRaw, [repositoryLinks, { base: '/preview/' }]],
  });
  const source =
    '[Vue](../packages/vue/README.md)\n\n[Vue ref][v]\n\n[v]: ../packages/vue/README.md\n\n<a href="../packages/vue/README.md">Vue HTML</a>\n\n```md\n[Vue](../packages/vue/README.md)\n```';
  const { code } = await renderer.render(source, {
    fileURL: pathToFileURL(`${generated}/docs/guides/getting-started.md`),
  });
  assert.equal((code.match(/href="\/preview\/docs\/vue\/"/g) || []).length, 3);
  assert.match(code, /\[Vue\]\(\.\.\/packages\/vue\/README\.md\)/);
});

test('embedded examples keep the deployment base', () => {
  assert.equal(rewriteUrl('examples:', 'docs/guide.md', entries, '/preview/'), '/preview/examples/');
  assert.equal(rewriteUrl('examples:', 'docs/guide.md', entries, '/'), '/examples/');
});
