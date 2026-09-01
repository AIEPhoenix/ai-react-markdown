#!/usr/bin/env node
/**
 * Write the corpus documents to `out/` for eyeballing.
 *
 * The documents themselves live in `src/documents.ts` because the benchmark
 * apps import them; this only puts them on disk. `out/` is gitignored — a
 * checked-in copy would be a second source of truth that goes stale the first
 * time a case changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { DOCUMENTS } = await import('../src/documents.ts');

const outDir = join(ROOT, 'out');
mkdirSync(outDir, { recursive: true });

for (const [name, body] of Object.entries(DOCUMENTS)) {
  const path = join(outDir, name);
  writeFileSync(path, body.endsWith('\n') ? body : `${body}\n`);
  const lines = body.split('\n').length;
  process.stdout.write(
    `[corpus] ${name.padEnd(12)} ${(body.length / 1024).toFixed(1).padStart(7)} KB  ${String(lines).padStart(5)} lines  ${path}\n`
  );
}
