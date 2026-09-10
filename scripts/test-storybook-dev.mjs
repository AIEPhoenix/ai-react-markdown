/* eslint-disable no-undef */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
  assert.deepEqual(failures, [], 'Both development refs must load without browser errors');
  await browser.close();
  browser = undefined;
  child.kill('SIGTERM');
  assert.equal(await exited, 143);
  assert(!(await Promise.all(ports.map(isReady))).some(Boolean), 'No development servers may remain');
  console.log(
    'Storybook development acceptance passed: both cross-port refs, composed rendering, reload and shutdown.'
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
