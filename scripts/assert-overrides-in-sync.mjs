/* global process, console */

/**
 * Asserts that the `overrides:` block in pnpm-workspace.yaml matches what the
 * lockfile records as actually applied. A disagreement means the lockfile is
 * stale — someone edited the overrides without re-running `pnpm install` — and
 * the rules people believe are in force are not the rules that resolved the
 * tree.
 *
 * Why a script exists for this at all: overrides used to live in
 * package.json#pnpm.overrides, which pnpm 10 read and pnpm 11 ignores. During
 * the 10→11 transition this repo carried both copies and this script kept the
 * three in agreement. pnpm is pinned to 11 now, package.json#pnpm is gone, and
 * only the workspace-file-vs-lockfile check remains — the part that catches a
 * stale lockfile, which is version-independent.
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

/** Order is irrelevant to pnpm, so compare as sorted key=value pairs. */
const normalize = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${v}`)
    .sort();

const DECLARED = 'pnpm-workspace.yaml (the source of truth)';
const APPLIED = 'pnpm-lock.yaml (what was actually applied)';

const declared = normalize(readYamlOverrides('pnpm-workspace.yaml'));
const applied = normalize(readYamlOverrides('pnpm-lock.yaml'));

// A stray `pnpm` field would be silently ignored by pnpm 11 — flag it rather
// than let someone add rules there that never take effect.
const strayPnpmField = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).pnpm;

if (declared.join('\n') !== applied.join('\n') || strayPnpmField) {
  console.error('\npnpm overrides are out of sync.\n');

  if (strayPnpmField) {
    console.error(
      `package.json has a \`pnpm\` field (${Object.keys(strayPnpmField).join(', ')}).` +
        '\npnpm 11 does not read it — move those settings into pnpm-workspace.yaml.\n'
    );
  }

  const missing = declared.filter((line) => !applied.includes(line));
  const extra = applied.filter((line) => !declared.includes(line));
  if (missing.length > 0 || extra.length > 0) {
    console.error(`${APPLIED} disagrees with ${DECLARED}:`);
    for (const l of missing) console.error(`    only in ${DECLARED}:  ${l}`);
    for (const l of extra) console.error(`    only in ${APPLIED}:  ${l}`);
    console.error('\nThe lockfile is stale — run `pnpm install` to apply the declared overrides.\n');
  }

  process.exit(1);
}

console.log(`pnpm overrides in sync (${declared.length} rules).`);
