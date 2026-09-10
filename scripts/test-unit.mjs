/* global process */
import { execFileSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';

// Aggregate gates always use the committed core state-sequence budget.
// For individual seed/path replay, invoke the core package test directly.
const env = { ...process.env };
for (const key of ['CORE_SEQUENCE_SEED', 'CORE_SEQUENCE_PATH', 'CORE_SEQUENCE_RUNS']) delete env[key];
try {
  execFileSync('pnpm', ['-r', 'test', ...process.argv.slice(2)], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env,
    stdio: 'inherit',
  });
} catch (error) {
  process.exitCode = error.status || 1;
}
