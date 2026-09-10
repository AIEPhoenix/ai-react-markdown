/* eslint-disable no-undef */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readCatalogResource } from './storybook-readiness.mjs';
import { createProcessSupervisor } from './storybook-processes.mjs';
import { readFileSync, rmSync } from 'node:fs';

const argv = process.argv.slice(2);
const skipBuild = argv.includes('--skip-build');
const positional = argv.filter((arg) => arg !== '--skip-build');
const [mode, target = 'all'] = positional;
if (
  positional.length > 2 ||
  (skipBuild && mode !== 'build') ||
  !['dev', 'build'].includes(mode) ||
  !['all', 'react', 'vue'].includes(target) ||
  (mode === 'build' && target !== 'all')
) {
  throw new Error('Usage: node scripts/storybook.mjs dev [all|react|vue] | build [--skip-build]');
}
const supervisor = createProcessSupervisor();
const require = createRequire(import.meta.url);
const packagePath = require.resolve('storybook/package.json');
const storybookBin = resolve(dirname(packagePath), JSON.parse(readFileSync(packagePath, 'utf8')).bin);
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, () => {
    process.exitCode = code;
    void supervisor.stop();
  });
}
function command(label, args, executable = 'pnpm') {
  return supervisor.run(label, executable, args, {
    stdio: 'inherit',
    env: { ...process.env, ...(mode === 'build' ? { STORYBOOK_BUILD: '1' } : {}) },
  });
}
async function run(framework, port) {
  const args = [storybookBin, mode === 'dev' ? 'dev' : 'build', '-c', `apps/storybook-${framework}/.storybook`];
  if (mode === 'dev') args.push('-p', String(port), '--no-open', '--ci', '--exact-port');
  else args.push('-o', framework === 'hub' ? 'storybook-static' : `storybook-static/${framework}`);
  if (mode === 'dev') console.log(`[storybook] Starting ${framework} on port ${port}`);
  await command(framework, args, process.execPath);
  if (mode === 'dev' && !supervisor.stopping) throw new Error(`${framework} stopped unexpectedly`);
}
async function waitForCatalog(port) {
  const deadline = Date.now() + 120_000;
  let lastError = 'No response yet';
  while (!supervisor.stopping && Date.now() < deadline) {
    try {
      const base = `http://localhost:${port}`;
      const index = await readCatalogResource(`${base}/index.json`, { json: true });
      if (!index.entries) throw new Error(`${base}/index.json: missing entries`);
      // Storybook probes iframe.html when classifying public composition refs.
      await readCatalogResource(`${base}/iframe.html`);
      console.log(`[storybook] Catalog HTTP endpoints ready on port ${port}`);
      return;
    } catch (error) {
      lastError = error.message;
      // Cold compilation can outlast a probe; every attempt has a body deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    supervisor.stopping
      ? 'Storybook command interrupted'
      : `Storybook on port ${port} did not become ready: ${lastError}`
  );
}
try {
  if (mode === 'build') {
    if (!skipBuild) {
      console.log('Building Storybook package dependencies...');
      await command('Package build', ['run', 'build']);
    }
    if (supervisor.stopping) throw new Error('Storybook command interrupted');
    rmSync('storybook-static', { recursive: true, force: true });
    // The hub clears its output directory. Build children afterwards.
    await run('hub');
    await run('react');
    await run('vue');
  } else if (target !== 'all') await run(target, target === 'react' ? 6007 : 6008);
  else {
    await Promise.all([
      run('react', 6007),
      run('vue', 6008),
      (async () => {
        await Promise.all([waitForCatalog(6007), waitForCatalog(6008)]);
        if (!supervisor.stopping) await run('hub', 6006);
      })(),
    ]);
  }
} catch (error) {
  if (!supervisor.stopping) console.error(error);
  await supervisor.stop();
  process.exitCode ||= 1;
}
