import { locales } from '../src/i18n/config.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const generated = resolve(root, 'apps/docs/src/content/docs');
export const repo = 'https://github.com/ai-markdown/ai-markdown';

function markdownFiles(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    // Internal planning and review records are intentionally not published.
    if (entry.isDirectory()) return entry.name === 'api' ? markdownFiles(path) : [];
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

export function pages() {
  const english = [
    { source: 'apps/docs/content/index.md', slug: 'docs' },
    { source: 'apps/docs/content/examples.md', slug: 'docs/examples' },
    ...markdownFiles('apps/docs/content/guides').map((source) => ({
      source,
      slug:
        source === 'apps/docs/content/guides/index.md'
          ? 'docs/guides'
          : source.replace(/^apps\/docs\/content\/guides\//, 'docs/guides/').replace(/\.md$/, ''),
    })),
    ...['react', 'vue', 'react-mantine', 'core', 'engine', 'remark-mark-highlight'].map((name) => ({
      source: `packages/${name}/README.md`,
      slug: `docs/${name === 'react-mantine' ? 'react/mantine' : name === 'remark-mark-highlight' ? 'plugins/highlight' : name}`,
    })),
  ];
  const translated = Object.keys(locales)
    .filter((locale) => locale !== 'root')
    .flatMap((locale) =>
      english.flatMap((page) => {
        const source = `apps/docs/content/translations/${locale}/${page.source}`;
        return existsSync(resolve(root, source))
          ? [{ source, slug: `${locale}/${page.slug}`, locale, canonicalSource: page.source }]
          : [];
      })
    );
  return [...english, ...translated];
}

export function syncContent() {
  const entries = pages();
  const expected = new Set();
  for (const { source, slug } of entries) {
    const raw = readFileSync(resolve(root, source), 'utf8');
    const heading = raw.match(/^# (.+)\r?\n/);
    if (!heading) throw new Error(`Expected a leading H1 in ${source}`);
    const title = heading[1].replace(/`/g, '');
    const text = `---\ntitle: ${JSON.stringify(title)}\nslug: ${JSON.stringify(slug)}\neditUrl: ${JSON.stringify(`${repo}/edit/main/${source}`)}\n---\n${raw.slice(heading[0].length)}`;
    const target = resolve(generated, `${slug || 'index'}.md`);
    expected.add(target);
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) writeFileSync(target, text);
  }
  function prune(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) prune(path);
      else if (!expected.has(path)) rmSync(path);
    }
  }
  prune(generated);
}

export function contentIntegration() {
  return {
    name: 'ai-markdown-repository-docs',
    hooks: {
      'astro:config:setup': () => syncContent(),
      'astro:server:setup': ({ server }) => {
        const sources = [resolve(root, 'apps/docs/content'), ...pages().map(({ source }) => resolve(root, source))];
        server.watcher.add(sources);
        server.watcher.on('all', (event, path) => {
          const name = relative(root, path).replaceAll('\\', '/');
          if (
            ['add', 'change', 'unlink'].includes(event) &&
            name.endsWith('.md') &&
            (name.startsWith('apps/docs/content/') || pages().some(({ source }) => source === name))
          )
            syncContent();
        });
      },
    },
  };
}
