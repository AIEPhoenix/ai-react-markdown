import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pages, root, generated, syncContent } from './content.mjs';

test('canonical sources and aliases have unambiguous routes', () => {
  const routes = new Set();
  const sources = new Set();
  for (const page of pages().filter((entry) => !entry.locale)) {
    assert.ok(!routes.has(page.slug), `Duplicate route: ${page.slug}`);
    routes.add(page.slug);
    assert.match(readFileSync(resolve(root, page.source), 'utf8'), /^# .+\n/);
    for (const source of [page.source, ...(page.aliases || [])]) {
      assert.ok(!sources.has(source), `Ambiguous source: ${source}`);
      sources.add(source);
    }
  }
});

test('adapter routes publish complete site references and edit their canonical sources', () => {
  syncContent();
  for (const name of ['react', 'vue', 'react-mantine']) {
    const source = `apps/docs/content/reference/${name}.md`;
    const page = pages().find((entry) => entry.source === source);
    assert.ok(page);
    assert.ok(page.aliases.includes(`packages/${name}/README.md`));
    assert.equal(page.slug, name === 'react-mantine' ? 'docs/react/mantine' : `docs/${name}`);
    const output = readFileSync(resolve(generated, `${page.slug}.md`), 'utf8');
    assert.ok(output.includes(`/edit/main/${source}`));
    assert.ok(output.includes(name === 'vue' ? '## Component props' : '## Props API Reference'));
  }
});
