import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { env, stdout } from 'node:process';
import { URL } from 'node:url';
import { fromHtml } from 'hast-util-from-html';
import { visit } from 'unist-util-visit';
import { root, pages } from './content.mjs';
import { normalizeBase } from './links.mjs';

const dist = resolve(root, env.DOCS_DIST || 'apps/docs/dist');
const base = normalizeBase(env.DOCS_BASE);
const origin = new URL(env.DOCS_SITE_URL || 'https://docs.invalid').origin;
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? dir === dist && entry.name === 'storybook'
            ? []
            : files(resolve(dir, entry.name))
          : resolve(dir, entry.name)
      )
    )
  ).flat();
}
const html = (await files(dist)).filter((file) => file.endsWith('.html'));
const documents = new Map();
for (const file of html) {
  const tree = fromHtml(await readFile(file, 'utf8'));
  const ids = new Set();
  const links = [];
  visit(tree, 'element', (node) => {
    if (node.properties.id) ids.add(node.properties.id);
    // Astro gives the generated 404 a virtual /404/ canonical, not a routable page.
    if (file === resolve(dist, '404.html') && node.tagName === 'link' && node.properties.rel?.includes('canonical'))
      return;
    for (const key of ['href', 'src']) if (typeof node.properties[key] === 'string') links.push(node.properties[key]);
  });
  documents.set(file, { ids, links, tree });
}
const failures = [];
for (const [route, sidebar] of [
  ['', false],
  ['docs', true],
  ['examples', false],
]) {
  const document = documents.get(resolve(dist, route, 'index.html'));
  assert(document, `Missing ${route || 'homepage'}`);
  let html;
  const options = [];
  visit(document.tree, 'element', (node) => {
    if (node.tagName === 'html') html = node;
    if (node.tagName === 'option') options.push(node);
  });
  assert.equal(html.properties.lang, 'en');
  assert.equal('dataHasSidebar' in html.properties, sidebar, `Wrong sidebar on ${route || 'homepage'}`);
  for (const theme of ['auto', 'light', 'dark']) assert(options.some((option) => option.properties.value === theme));
  assert(options.some((option) => option.children.some((child) => child.type === 'text' && child.value === 'English')));
  assert(document.links.includes(`${base}docs/`), 'Docs navigation must enter the documentation area');
  assert(document.links.includes(`${base}examples/`), 'Examples navigation must enter the embedded workspace');
  if (route === 'examples') {
    let embedded = false;
    visit(document.tree, 'element', (node) => {
      if (node.tagName === 'iframe' && node.properties.id === 'examples-catalog') {
        embedded = Boolean(node.properties.src && node.properties.title);
      }
    });
    assert(embedded, 'Examples must include an accessible Storybook iframe');
  }
}
for (const { slug } of pages())
  if (!documents.has(resolve(dist, slug, 'index.html'))) failures.push(`Missing page: ${slug || '/'}`);
for (const [file, { links }] of documents) {
  const pathname = `${base}${relative(dist, file)
    .replaceAll('\\', '/')
    .replace(/index\.html$/, '')}`;
  for (const href of links) {
    const url = new URL(href, `${origin}${pathname}`);
    // Standalone docs CI has no Storybook artifact; the assembled Pages check validates it.
    if (!env.DOCS_DIST && url.pathname.startsWith(`${base}storybook/`)) continue;
    if (url.origin !== origin) continue;
    if (!url.pathname.startsWith(base)) {
      failures.push(`${pathname}: outside base: ${href}`);
      continue;
    }
    let target = resolve(dist, decodeURIComponent(url.pathname.slice(base.length)));
    try {
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
    } catch {
      failures.push(`${pathname}: missing ${href}`);
      continue;
    }
    if (url.hash && documents.has(target) && !documents.get(target).ids.has(decodeURIComponent(url.hash.slice(1))))
      failures.push(`${pathname}: missing anchor ${href}`);
  }
}
// Search is part of the static deliverable, not just a development affordance.
await stat(resolve(dist, 'pagefind/pagefind.js'));
if (failures.length) throw new Error(`Built-site links failed:\n${failures.join('\n')}`);
stdout.write(`Checked ${documents.size} HTML pages, all local links/anchors, and the Pagefind bundle.\n`);
