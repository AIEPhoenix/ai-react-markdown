import assert from 'node:assert/strict';
import { stdout } from 'node:process';
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '_site');
// Validate both builds before replacing the previous assembled artifact.
for (const entry of [
  'apps/docs/dist/index.html',
  'apps/docs/dist/docs/index.html',
  'apps/docs/dist/pagefind/pagefind.js',
  'storybook-static/index.html',
  'storybook-static/react/iframe.html',
  'storybook-static/react/index.json',
  'storybook-static/vue/iframe.html',
  'storybook-static/vue/index.json',
])
  assert((await stat(resolve(root, entry))).isFile(), `Missing build entry: ${entry}`);
await rm(output, { recursive: true, force: true });
await mkdir(output);
await cp(resolve(root, 'apps/docs/dist'), output, { recursive: true });
await cp(resolve(root, 'storybook-static'), resolve(output, 'storybook'), { recursive: true });
await writeFile(resolve(output, '.nojekyll'), '');
stdout.write('Assembled documentation and all Storybook catalogs in _site/\n');
