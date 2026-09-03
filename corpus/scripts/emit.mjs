#!/usr/bin/env node
/**
 * Write the corpus documents to `documents/`, which IS committed.
 *
 * It used to be `out/`, gitignored, on the reasoning that "a checked-in copy
 * would be a second source of truth that goes stale the first time a case
 * changes". The staleness worry is real and is answered by a gate rather than
 * by hiding the file: `validate.mjs` re-emits and compares byte for byte, the
 * same shape `generated.ts` already uses against the installed KaTeX.
 *
 * What hiding it cost: the corpus is the thing that says what this library
 * claims to support, and while the documents were gitignored a change to a
 * generator or a case moved that claim with nothing visible in review. Now a
 * mermaid case edit shows up as a diff in `documents/mermaid.md`, which is
 * the artefact a person would actually read.
 *
 * The old header also said the benchmark apps import `src/documents.ts`. They
 * do not, and could not — the package's `exports` map had no working entry for
 * it. That map is gone; see the note in `validate.mjs` about who consumes this
 * package (nobody, programmatically, and deliberately so).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { DOCUMENTS } = await import('../src/documents.ts');

const outDir = join(ROOT, 'documents');
mkdirSync(outDir, { recursive: true });

for (const [name, body] of Object.entries(DOCUMENTS)) {
  const path = join(outDir, name);
  writeFileSync(path, body.endsWith('\n') ? body : `${body}\n`);
  const lines = body.split('\n').length;
  process.stdout.write(
    `[corpus] ${name.padEnd(12)} ${(body.length / 1024).toFixed(1).padStart(7)} KB  ${String(lines).padStart(5)} lines  ${path}\n`
  );
}
