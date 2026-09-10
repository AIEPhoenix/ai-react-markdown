/* eslint-disable no-undef */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const [mode, target = 'all'] = process.argv.slice(2);
if (
  !['dev', 'build'].includes(mode) ||
  !['all', 'react', 'vue'].includes(target) ||
  (mode === 'build' && target !== 'all')
) {
  throw new Error('Usage: node scripts/storybook.mjs dev [all|react|vue] | build');
}
const children = new Set();
let stopping = false;
const stop = () => {
  stopping = true;
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
};
process.on('SIGINT', () => {
  process.exitCode = 130;
  stop();
});
process.on('SIGTERM', () => {
  process.exitCode = 143;
  stop();
});
function command(label, args) {
  if (stopping) throw new Error('Storybook command interrupted');
  const child = spawn('pnpm', args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, ...(mode === 'build' ? { STORYBOOK_BUILD: '1' } : {}) },
  });
  children.add(child);
  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      children.delete(child);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      children.delete(child);
      if (code === 0 || (signal && stopping)) resolve();
      else reject(new Error(`${label} exited ${code}`));
    });
  });
}
function run(framework, port) {
  const args = ['exec', 'storybook', mode === 'dev' ? 'dev' : 'build', '-c', `apps/storybook-${framework}/.storybook`];
  if (mode === 'dev') args.push('-p', String(port), '--no-open', '--ci');
  else args.push('-o', framework === 'hub' ? 'storybook-static' : `storybook-static/${framework}`);
  if (mode === 'dev') console.log(`[storybook] Starting ${framework} on port ${port}`);
  return command(framework, args);
}
async function waitForCatalog(port) {
  const deadline = Date.now() + 120_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const base = `http://localhost:${port}`;
      const index = await fetch(`${base}/index.json`, { signal: AbortSignal.timeout(1000) });
      if (index.ok && (await index.json()).entries) {
        // Storybook probes iframe.html when classifying public composition refs.
        const preview = await fetch(`${base}/iframe.html`, { signal: AbortSignal.timeout(1000) });
        await preview.arrayBuffer();
        if (preview.ok) {
          console.log(`[storybook] Catalog HTTP endpoints ready on port ${port}`);
          return;
        }
      }
    } catch {
      // A listening server can still be preparing its index and preview.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(stopping ? 'Storybook command interrupted' : `Storybook on port ${port} did not become ready`);
}
try {
  console.log('Building Storybook package dependencies...');
  const buildArgs =
    target === 'all'
      ? ['run', 'build']
      : ['--filter', target === 'vue' ? '@ai-markdown/vue...' : '@ai-markdown/react-mantine...', 'run', 'build'];
  await command('Package build', buildArgs);
  if (stopping) process.exit(process.exitCode);
  if (mode === 'build') {
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
        if (!stopping) await run('hub', 6006);
      })(),
    ]);
  }
} catch (error) {
  console.error(error);
  stop();
  process.exitCode ||= 1;
}
