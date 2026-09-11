import { posix, relative } from 'node:path';
import { visit } from 'unist-util-visit';
import { generated, pages, repo } from './content.mjs';

export function normalizeBase(base = '/') {
  if (!base.startsWith('/') || /[?#\\]/.test(base))
    throw new Error('DOCS_BASE must be a URL pathname, e.g. /preview/docs/');
  return `${base.replace(/\/+$/, '')}/`;
}

export function rewriteUrl(url, source, entries, base = '/', storybook = '') {
  if (url === 'examples:') return `${normalizeBase(base)}examples/`;
  if (url.startsWith('storybook:')) {
    if (!storybook) return `${normalizeBase(base)}docs/guides/storybook/`;
    const suffix = url.slice('storybook:'.length);
    return `${storybook.replace(/\/$/, '')}/${suffix}`;
  }
  const prefix = `${repo}/blob/main/`;
  const absoluteRepo = url.startsWith(prefix);
  if (!absoluteRepo && /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(url)) return url;
  const [, pathname, suffix] = (absoluteRepo ? url.slice(prefix.length) : url).match(/^([^?#]*)(.*)$/s);
  if (!pathname) return url;
  const target = absoluteRepo
    ? decodeURI(pathname)
    : posix.normalize(posix.join(posix.dirname(source), decodeURI(pathname)));
  const page = entries.find((entry) => entry.source === target);
  if (page) return `${normalizeBase(base)}${page.slug ? `${page.slug}/` : ''}${suffix}`;
  if (absoluteRepo) return url;
  return `${repo}/blob/main/${target}${suffix}`;
}

// Transform rendered links, including raw HTML anchors and reference links;
// fenced examples are text nodes and remain byte-for-byte untouched.
export function repositoryLinks({ base = '/', storybook = '' } = {}) {
  return (tree, file) => {
    const entries = pages();
    const slug = relative(generated, file.path)
      .replaceAll('\\', '/')
      .replace(/\.md$/, '')
      .replace(/^index$/, '');
    const page = entries.find((entry) => entry.slug === slug);
    if (!page) return;
    visit(tree, 'element', (node) => {
      for (const key of ['href', 'src']) {
        if (typeof node.properties[key] === 'string') {
          const localizedEntries = page.locale
            ? entries
                .map((entry) => ({ ...entry, source: entry.canonicalSource || entry.source }))
                .sort((a, b) => Number(b.locale === page.locale) - Number(a.locale === page.locale))
            : entries;
          node.properties[key] = rewriteUrl(
            node.properties[key],
            page.canonicalSource || page.source,
            localizedEntries,
            base,
            storybook
          );
        }
      }
    });
  };
}
