/* global process, console */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Install actual tarballs outside the workspace. No source aliases or symlinks
// can hide missing dependencies, declaration leaks or broken CSS subpaths.
const root = resolve(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'ai-markdown-consumers-'));
const train = ['engine', 'core', 'react', 'react-mantine', 'vue'];
const packages = ['remark-mark-highlight', ...train];
const dependencies = {};
for (const dir of packages) {
  execFileSync('pnpm', ['--filter', `./packages/${dir}`, 'pack', '--pack-destination', out], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const manifest = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
  const file = `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`;
  dependencies[manifest.name] = `file:${join(out, file)}`;
  const packed = JSON.parse(
    execFileSync('tar', ['-xOf', join(out, file), 'package/package.json'], { encoding: 'utf8' })
  );
  assert.equal(packed.private, undefined);
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(packed[field] ?? {})) {
      assert(!name.startsWith('@ai-react-markdown/'), `${dir}: legacy dependency`);
      assert(!version.startsWith('workspace:'), `${dir}: unpublished workspace specifier`);
    }
  }
  if (dir === 'core' || dir === 'react' || dir === 'vue')
    assert.equal(packed.dependencies['@ai-markdown/engine'], manifest.version);
  if (dir === 'react' || dir === 'vue') assert.equal(packed.dependencies['@ai-markdown/core'], manifest.version);
}
Object.assign(dependencies, {
  vue: JSON.parse(readFileSync(join(root, 'packages/vue/node_modules/vue/package.json'), 'utf8')).version,
  '@vue/server-renderer': JSON.parse(
    readFileSync(join(root, 'packages/vue/node_modules/@vue/server-renderer/package.json'), 'utf8')
  ).version,
  react: '19.2.7',
  'react-dom': '19.2.7',
  '@types/react': '^19.2.18',
  '@types/react-dom': '^19.2.7',
  '@mantine/core': '9.5.2',
  '@mantine/hooks': '9.5.2',
  '@mantine/code-highlight': '9.5.2',
  'highlight.js': '^11.11.2',
  katex: '^0.17.0',
  typescript: '^6.0.3',
});
// Resolve the host React version from the already verified workspace.
dependencies.react = JSON.parse(
  readFileSync(join(root, 'packages/react/node_modules/react/package.json'), 'utf8')
).version;
dependencies['react-dom'] = JSON.parse(
  readFileSync(join(root, 'packages/react/node_modules/react-dom/package.json'), 'utf8')
).version;
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify({ name: 'packed-consumer', private: true, type: 'module', dependencies }, null, 2)
);
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: out,
  stdio: 'pipe',
  encoding: 'utf8',
});
const probe = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const react = await import('@ai-markdown/react');
const core = await import('@ai-markdown/core');
const engine = await import('@ai-markdown/engine');
const Vue = await import('vue');
const adapter = await import('@ai-markdown/vue');
const vueServer = await import('@vue/server-renderer');
assert((await vueServer.renderToString(Vue.createSSRApp({ render: () => Vue.h(adapter.AIMarkdown, { content: '**Vue packed**' }) }))).includes('<strong>Vue packed</strong>'));
const cjsVue = require('@ai-markdown/vue');
assert((await require('@vue/server-renderer').renderToString(require('vue').createSSRApp({ render: () => require('vue').h(cjsVue.AIMarkdown, { content: '**Vue CJS**' }) }))).includes('<strong>Vue CJS</strong>'));
const React = await import('react');
const { renderToString } = await import('react-dom/server');
const html = renderToString(React.createElement(react.default, { content: '**Packed** [safe](https://example.com)' }));
assert(html.includes('<strong>Packed</strong>'));
assert(html.includes('https://example.com'));
assert.equal(typeof core.createPipelineSession, 'function');
assert.equal(typeof engine.createRegistry, 'function');
assert(!('DEFAULT_PAYLOAD' in engine));
for (const name of ['@ai-markdown/remark-mark-highlight', '@ai-markdown/core', '@ai-markdown/engine', '@ai-markdown/react', '@ai-markdown/react/plugins', '@ai-markdown/react-mantine', '@ai-markdown/vue']) {
  assert(require(name));
  assert(await import(name));
}
for (const name of ['@ai-markdown/react/typography/default.css', '@ai-markdown/react/typography/all.css', '@ai-markdown/react-mantine/styles.css', '@ai-markdown/vue/styles.css']) assert(require.resolve(name).endsWith('.css'));
assert.equal(typeof require('@ai-markdown/core').createPipelineSession, 'function');
`;
writeFileSync(join(out, 'probe.mjs'), probe);
for (const conditions of [[], ['--conditions=development']])
  execFileSync(process.execPath, [...conditions, 'probe.mjs'], { cwd: out, stdio: 'pipe', encoding: 'utf8' });
const types = `
import { createElement } from 'react';
import { h } from 'vue';
import VueMarkdown, { useSmoothStream as useVueSmooth, type AIMarkdownProps as VueProps } from '@ai-markdown/vue';
const vueProps: VueProps = { content: 'Vue consumer' };
h(VueMarkdown, vueProps); void useVueSmooth;
import AIMarkdown, { AIMarkdownDocuments, createRemendPreprocessor, type AIMarkdownProps } from '@ai-markdown/react';
import MantineAIMarkdown from '@ai-markdown/react-mantine';
import { createPipelineSession, createSmoothCoordinator, createContributionSession } from '@ai-markdown/core';
import { createRegistry } from '@ai-markdown/engine';
import * as plugins from '@ai-markdown/react/plugins';
const props: AIMarkdownProps = { content: 'Example[^x].\\n\\n[^x]: Footnote', contentPreprocessors: [createRemendPreprocessor()], documentId: 'doc' };
createElement(AIMarkdownDocuments, {}, createElement(AIMarkdown, props));
createElement(MantineAIMarkdown, props);
createPipelineSession(); createContributionSession(); void plugins;
const registry = createRegistry();
registry.registerChunk('chunk', new Set(), new Set());
// @ts-expect-error private registry implementation is not an adapter contract
registry._subscribers;
// @ts-expect-error private coordinator implementation is not an adapter contract
createSmoothCoordinator()._refcounts;
`;
for (const ext of ['mts', 'cts']) {
  writeFileSync(join(out, `consumer.${ext}`), types);
  execFileSync(
    process.execPath,
    [
      join(out, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      `consumer.${ext}`,
    ],
    { cwd: out, stdio: 'pipe', encoding: 'utf8' }
  );
}
// Exercise the documented lower bound with the actual packed adapter too.
execFileSync(
  'npm',
  ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'vue@3.5.0', '@vue/server-renderer@3.5.0'],
  { cwd: out, stdio: 'pipe', encoding: 'utf8' }
);
for (const conditions of [[], ['--conditions=development']])
  execFileSync(process.execPath, [...conditions, 'probe.mjs'], { cwd: out, stdio: 'pipe', encoding: 'utf8' });
for (const ext of ['mts', 'cts'])
  execFileSync(
    process.execPath,
    [
      join(out, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      `consumer.${ext}`,
    ],
    { cwd: out, stdio: 'pipe', encoding: 'utf8' }
  );
for (const dir of ['engine', 'core']) {
  const dist = join(out, 'node_modules/@ai-markdown', dir, 'dist');
  for (const file of readdirSync(dist).filter((name) => /\.d\.(ts|cts)$/.test(name))) {
    assert(
      !/RegistryInternal|SmoothCoordinatorInternal|_refcounts|_reactIdMap/.test(readFileSync(join(dist, file), 'utf8')),
      `${dir}/${file}: private type leaked`
    );
  }
}
console.log(`Packed ESM/CJS, development, SSR, CSS, plugin, TypeScript and Vue 3.5.0 consumers passed: ${out}`);
