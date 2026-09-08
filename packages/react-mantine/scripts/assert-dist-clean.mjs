/* global process, console */

/**
 * Fails the build if any executable dist artifact references `process.env`.
 * Same invariant as core/engine (see core/scripts/assert-dist-clean.mjs for
 * the full rationale): an unresolved reference throws at import time in
 * no-bundler runtimes (CDN ESM, Deno). mantine has no dev/prod dual build
 * today because nothing in its source reads the environment — this check
 * makes that an ENFORCED invariant rather than a happy accident: the first
 * dev-only gate added here must come with `env: { NODE_ENV }` folding in
 * tsup (and a `development` exports condition), or the build fails right
 * here instead of in a consumer's browser (2026-08 project review,
 * infra-10). Source maps are exempt: they embed original source text.
 */
import { readdirSync, readFileSync } from 'node:fs';

const offenders = readdirSync('dist', { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
  .filter((f) => readFileSync(`dist/${f}`, 'utf8').includes('process.env'));

if (offenders.length > 0) {
  console.error(
    `assert-dist-clean: process.env leaked into ${offenders.join(', ')} — ` +
      'mantine has no NODE_ENV folding — add env: { NODE_ENV } dual builds to tsup before shipping a dev-only gate.'
  );
  process.exit(1);
}
