/* global process, console */

/**
 * pnpm reads dependency overrides from exactly ONE of two places, and which
 * one depends on its major version:
 *
 *   pnpm 10  →  package.json  #pnpm.overrides   (this block is ignored, silently)
 *   pnpm 11  →  pnpm-workspace.yaml  overrides: (package.json is ignored, with a warning)
 *
 * There is no merge and no fallback. This repo therefore keeps both copies,
 * identical, so the rules hold across the version boundary — and this script
 * is what stops them from drifting apart. It also checks the lockfile, which
 * records what the installed pnpm actually applied: if that disagrees, the
 * lockfile is stale and someone needs to re-run `pnpm install`.
 *
 * Runs first in `pnpm preflight`. Exit code 1 on any mismatch.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal reader for the `overrides:` block of a pnpm YAML file. The format is
 * fully under our control (two-space indent, one `key: value` per line), so a
 * real YAML parser would be a dependency we don't otherwise need.
 */
function readYamlOverrides(file) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  const start = lines.findIndex((l) => l === 'overrides:');
  if (start === -1) throw new Error(`${file}: no \`overrides:\` block found`);

  const out = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith('  ')) break; // dedent ends the block
    const at = line.indexOf(': ');
    if (at === -1) throw new Error(`${file}: cannot parse override line: ${line}`);
    const key = line.slice(2, at).trim();
    const value = line
      .slice(at + 2)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}

function readJsonOverrides(file) {
  const pkg = JSON.parse(readFileSync(join(root, file), 'utf8'));
  const overrides = pkg.pnpm?.overrides;
  if (!overrides) throw new Error(`${file}: no \`pnpm.overrides\` block found`);
  return overrides;
}

/** Order is irrelevant to pnpm, so compare as sorted key=value pairs. */
const normalize = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${v}`)
    .sort();

const sources = {
  'package.json (pnpm 10 reads this)': readJsonOverrides('package.json'),
  'pnpm-workspace.yaml (pnpm 11 reads this)': readYamlOverrides('pnpm-workspace.yaml'),
  'pnpm-lock.yaml (what was actually applied)': readYamlOverrides('pnpm-lock.yaml'),
};

const [reference, ...others] = Object.entries(sources);
const failures = [];

for (const [name, overrides] of others) {
  const a = normalize(reference[1]);
  const b = normalize(overrides);
  if (a.join('\n') === b.join('\n')) continue;

  const missing = a.filter((line) => !b.includes(line));
  const extra = b.filter((line) => !a.includes(line));
  failures.push(
    [
      `${name} disagrees with ${reference[0]}:`,
      ...missing.map((l) => `    only in ${reference[0]}:  ${l}`),
      ...extra.map((l) => `    only in ${name}:  ${l}`),
    ].join('\n')
  );
}

if (failures.length > 0) {
  console.error('\npnpm overrides are out of sync.\n');
  console.error(failures.join('\n\n'));
  console.error(
    '\nEvery override must be written identically in package.json and' +
      '\npnpm-workspace.yaml, then applied with `pnpm install`. See the comment' +
      '\nat the top of pnpm-workspace.yaml for why both copies exist.\n'
  );
  process.exit(1);
}

console.log(`pnpm overrides in sync across all three files (${normalize(reference[1]).length} rules).`);
