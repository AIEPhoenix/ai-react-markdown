/* eslint-disable no-undef */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ports = [6006, 6007, 6008];
async function isReady(port) {
  try {
    return (await fetch(`http://localhost:${port}/index.json`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}
assert(!(await Promise.all(ports.map(isReady))).some(Boolean), 'Stop existing Storybooks before this check');
const child = spawn(process.execPath, ['scripts/storybook.mjs', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', (chunk) => {
  output = (output + chunk).slice(-20000);
});
child.stderr.on('data', (chunk) => {
  output = (output + chunk).slice(-20000);
});
const exited = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code));
});
let browser;
try {
  const deadline = Date.now() + 180_000;
  while (!(await isReady(6006)) && child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(await isReady(6006), 'Composition server must start');
  const hubStart = output.indexOf('[storybook] Starting hub on port 6006');
  assert(hubStart >= 0, 'Composition launch marker must be logged');
  for (const port of [6007, 6008]) {
    const ready = output.indexOf(`[storybook] Catalog HTTP endpoints ready on port ${port}`);
    assert(ready >= 0 && ready < hubStart, `Catalog ${port} must be ready before the hub is launched`);
  }
  assert(!output.includes('`vue-docgen-api` is deprecated'), 'Vue must use the supported docgen engine');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('requestfailed', (request) => {
    if (/^http:\/\/localhost:600[78]\/(index|stories)\.json/.test(request.url())) {
      failures.push(`${request.url()}: ${request.failure()?.errorText}`);
    }
  });
  for (const [framework, port] of [
    ['react', 6007],
    ['vue', 6008],
  ]) {
    const index = await (await fetch(`http://localhost:${port}/index.json`)).json();
    const entry = Object.values(index.entries).find((item) => item.title === 'Playground' && item.type === 'story');
    assert(entry, `${framework} playground must exist`);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(`http://localhost:6006/?path=/story/${framework}_${entry.id}&globals=autoStart:off`);
      await page
        .frameLocator(`iframe[src^="http://localhost:${port}/iframe.html"]`)
        .locator('#storybook-root table')
        .waitFor({ timeout: 60000 });
      assert.equal(await page.getByText('Error: Loading of ref failed', { exact: false }).count(), 0);
    }
  }
  // Probe served modules, not merely Vite's watcher notification. Always restore source files.
  for (const [port, renderer] of [
    [6007, 'react'],
    [6008, 'vue'],
  ]) {
    const index = await (await fetch(`http://localhost:${port}/index.json`)).json();
    const entry = Object.values(index.entries).find((item) => item.title === 'Playground' && item.type === 'story');
    await page.goto(`http://localhost:${port}/iframe.html?id=${entry.id}&globals=autoStart:off`);
    await page.locator('#storybook-root table').waitFor({ timeout: 60000 });
    for (const path of [
      `packages/${renderer}/src/index.${renderer === 'react' ? 'tsx' : 'ts'}`,
      'packages/core/src/index.ts',
      'packages/engine/src/index.ts',
    ]) {
      const original = await readFile(path, 'utf8');
      const marker = `storybook-source-probe-${port}-${Date.now()}`;
      try {
        const updated = page.waitForEvent('console', { predicate: (event) => event.text() === marker, timeout: 60000 });
        await writeFile(path, `${original}\nconsole.info(${JSON.stringify(marker)});\n`);
        await updated;
        await page.locator('#storybook-root table').waitFor({ timeout: 60000 });
      } finally {
        await writeFile(path, original);
      }
    }
  }
  const stylesheet = 'packages/vue/src/styles.css';
  const originalStyle = await readFile(stylesheet, 'utf8');
  try {
    await writeFile(stylesheet, `${originalStyle}\n:root { --storybook-source-probe: ready; }\n`);
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--storybook-source-probe').trim() === 'ready'
    );
  } finally {
    await writeFile(stylesheet, originalStyle);
  }
  assert.deepEqual(failures, [], 'Both development refs must load without browser errors');
  await browser.close();
  browser = undefined;
  child.kill('SIGINT');
  assert.equal(await exited, 130);
  for (const port of ports) {
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
  }
  assert(!(await Promise.all(ports.map(isReady))).some(Boolean), 'No development servers may remain');
  console.log(
    'Storybook development acceptance passed: both cross-port refs, composed rendering, source updates, CSS updates, reload and shutdown.'
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await exited;
  }
}
