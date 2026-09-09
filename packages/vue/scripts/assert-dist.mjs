import assert from 'node:assert/strict';
import { readFileSync, copyFileSync } from 'node:fs';
copyFileSync('src/styles.css', 'dist/styles.css');
for (const file of ['index.js', 'index.cjs', 'index.dev.js', 'index.dev.cjs']) {
  const source = readFileSync(`dist/${file}`, 'utf8');
  for (const dependency of ['vue', '@ai-markdown/core', '@ai-markdown/engine'])
    assert(source.includes(dependency), `${file}: missing external ${dependency}`);
  assert(!source.includes('@ai-react-markdown/'), `${file}: legacy dependency`);
  assert(!/from ['"]react['"]|require\(['"]react['"]\)|["']use client["']/.test(source), `${file}: React dependency`);
}
