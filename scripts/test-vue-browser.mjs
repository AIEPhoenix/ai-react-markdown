/* global console, document, window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const vueRequire = createRequire(resolve('packages/vue/package.json'));
const { createSSRApp, h } = vueRequire('vue');
const { renderToString } = vueRequire('@vue/server-renderer');
const { AIMarkdown } = await import('../packages/vue/dist/index.js');
const markup = await renderToString(
  createSSRApp({ render: () => h(AIMarkdown, { content: '# Hydration\n\n**bold** $x^2$\n\nlocal[^x]\n\n[^x]: body' }) })
);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'aimd-vue-browser-'));
let browser, server;
try {
  const bundle = join(directory, 'bundle.js');
  await build({
    entryPoints: ['packages/vue/src/test-fixtures/browser.fixture.ts'],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    nodePaths: [resolve('packages/vue/node_modules')],
    define: {
      'process.env.NODE_ENV': '"development"',
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
    },
    logLevel: 'silent',
  });
  const source = await readFile(bundle);
  const css = await readFile('packages/vue/dist/styles.css');
  server = createServer((req, res) => {
    res.setHeader(
      'Content-Type',
      req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html; charset=utf-8'
    );
    res.end(
      req.url === '/bundle.js'
        ? source
        : req.url === '/style.css'
          ? css
          : `<link rel="stylesheet" href="/style.css"><div id="hydration">${markup}</div><div id="app"></div><script type="module" src="/bundle.js"></script>`
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /hydration|recursive updates/i.test(msg.text())) errors.push(msg.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(
    () => window.vueProbe && document.querySelector('#reference a[href="https://example.com/one"]')
  );
  assert.equal(await page.locator('#reference img').getAttribute('src'), 'https://example.com/one');
  assert.equal(await page.locator('#isolated').innerText(), '[label][url]');
  assert.equal(await page.locator('#reference [data-footnotes]').count(), 0);
  assert.equal(await page.locator('#definition [data-footnotes]').count(), 1);
  assert.equal(await page.locator('#reference [data-footnote-ref]').innerText(), '1');
  assert(await page.locator('#hydration .katex').count());
  await page.evaluate(() =>
    window.vueProbe.update({ definition: '[url]: https://example.com/two\n\n[^x]: updated body' })
  );
  await page.waitForFunction(() => document.querySelector('#reference a[href="https://example.com/two"]'));
  assert((await page.locator('#definition').innerText()).includes('updated body'));
  await page.evaluate(() => window.vueProbe.update({ show: false }));
  await page.waitForFunction(() => !document.querySelector('#reference img'));
  assert((await page.locator('#reference').innerText()).includes('[label][url]'));
  await page.evaluate(() => window.vueProbe.update({ show: true, doc: 'other' }));
  await page.waitForFunction(() => document.querySelector('#reference a[href="https://example.com/two"]'));
  assert((await page.locator('#reference [data-footnote-ref]').getAttribute('href')).includes('other'));
  await page.evaluate(() => window.vueProbe.update({ streaming: false, code: '```ts\nsecond\n```' }));
  await page.waitForFunction(
    () => document.querySelector('#custom output')?.getAttribute('data-streaming') === 'false'
  );
  assert((await page.locator('#custom output').innerText()).includes('second'));
  assert.equal(await page.locator('#custom .aimd-vue-cursor').count(), 0);
  await page.evaluate(() =>
    window.vueProbe.update({ smooth: 'seed followed by an animated tail 👩‍💻', producing: true })
  );
  await page.evaluate(() => window.vueProbe.update({ producing: false }));
  await page.waitForFunction(
    () => document.querySelector('#smooth')?.textContent === 'seed followed by an animated tail 👩‍💻'
  );
  await page.waitForFunction(() => document.querySelector('#queue-second')?.textContent === 'waiting turn');
  await page.evaluate(() => window.vueProbe.update({ first: 'first chunk', second: 'second chunk', secondDone: true }));
  assert.equal(await page.locator('#queue-second').innerText(), 'waiting turn');
  await page.evaluate(() => window.vueProbe.update({ firstDone: true }));
  await page.waitForFunction(() => document.querySelector('#queue-second')?.textContent === 'second chunk');
  await page.waitForFunction(
    () => document.querySelector('#cursor-probe .aimd-vue-cursor')?.style.visibility === 'visible'
  );
  const cursor = await page.locator('#cursor-probe .aimd-vue-cursor').boundingBox();
  const paragraph = await page.locator('#cursor-probe p').boundingBox();
  assert(
    cursor && paragraph && Math.abs(cursor.y - paragraph.y) < paragraph.height,
    'cursor must occupy the final text line'
  );
  await page.evaluate(() => window.vueProbe.update({ cursor: '[hidden]: https://example.com' }));
  await page.waitForFunction(
    () => document.querySelector('#cursor-probe .aimd-vue-cursor')?.style.visibility === 'hidden'
  );
  await page.evaluate(() => window.vueProbe.update({ cursor: '```ts\ncode tail\n```' }));
  assert.equal(
    await page.locator('#cursor-probe .aimd-vue-cursor').evaluate((node) => node.style.visibility),
    'hidden'
  );
  await page.evaluate(() => window.vueProbe.unmount());
  assert.equal(await page.locator('#app .aimd-vue').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'Vue browser: hydration, references, isolation, definition removal, document switch, custom components, smooth drain/turn-taking, cursor layout and unmount PASS'
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
