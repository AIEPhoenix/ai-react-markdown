/* global process, console */
import { execFileSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env };
// Replay controls belong to direct test invocations, never to the gate.
for (const key of ['CORE_SEQUENCE_SEED', 'CORE_SEQUENCE_PATH', 'CORE_SEQUENCE_RUNS']) delete env[key];
for (const args of [
  ['--filter', '@ai-markdown/core...', 'build'],
  ['--filter', '@ai-markdown/core', 'typecheck'],
  ['--filter', '@ai-markdown/core', 'test'],
])
  execFileSync('pnpm', args, { cwd, env, stdio: 'inherit' });
console.log(
  'Core contracts PASS: source tests, fixed-seed state sequences, declarations and headless distribution entries'
);
