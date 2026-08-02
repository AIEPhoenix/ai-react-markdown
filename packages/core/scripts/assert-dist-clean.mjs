/* global process, console */

/**
 * Fails the build if any executable dist artifact still references
 * `process.env`. The dual dev/prod build must fold NODE_ENV at build time —
 * `env: { NODE_ENV }` on BOTH tsup configs is load-bearing (see
 * CONTRIBUTING.md, "Dev-only gates") — because an unresolved reference
 * would throw `ReferenceError: process is not defined` at import time in
 * no-bundler runtimes (browser native ESM/CDN, Deno). Source maps are
 * exempt: they embed original source text and are never executed.
 */
import { readdirSync, readFileSync } from 'node:fs';

// Recursive: subpath entries (e.g. dist/plugins/) must satisfy the same
// invariant as the root entry.
const offenders = readdirSync('dist', { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
  .filter((f) => readFileSync(`dist/${f}`, 'utf8').includes('process.env'));

if (offenders.length > 0) {
  console.error(
    `assert-dist-clean: process.env leaked into ${offenders.join(', ')} — ` +
      'check that both tsup configs still set env: { NODE_ENV }.'
  );
  process.exit(1);
}
