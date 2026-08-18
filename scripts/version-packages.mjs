#!/usr/bin/env node
/* global process, console */

// Sync all versions across the monorepo.
//
// Usage: node scripts/version-packages.mjs <new-version>
//
// - Updates "version" in every LOCKSTEP package (core, engine, mantine — the
//   release train); independently versioned packages (remark-mark-highlight)
//   are reported and skipped
// - For non-core lockstep packages, updates peerDependencies["@ai-react-markdown/core"] to ^<new-version>
// - Rewrites core version references in README files (install snippets, examples)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const newVersion = process.argv[2];
if (!newVersion) {
  console.error('Usage: node scripts/version-packages.mjs <new-version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) {
  console.error(`Invalid version: "${newVersion}". Expected format: x.y.z or x.y.z-tag`);
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const CORE_PKG_NAME = '@ai-react-markdown/core';

// Release-train LOCKSTEP set: these ship together at the train version and
// get their core peer range rewritten. Every other workspace package (e.g.
// plugin packages like @ai-react-markdown/remark-mark-highlight) versions
// INDEPENDENTLY: it is skipped here, published from a train tag only when
// its own version was bumped (`pnpm publish -r` skips already-published
// versions), or standalone via a `<pkg>-vX.Y.Z` tag.
const LOCKSTEP = new Set([CORE_PKG_NAME, '@ai-react-markdown/mantine', '@ai-react-markdown/engine']);

// Update root package.json
const rootPkgPath = join(ROOT, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
const rootOldVersion = rootPkg.version;
rootPkg.version = newVersion;
writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
console.log(`${rootPkg.name} (root): ${rootOldVersion} → ${newVersion}`);

// Update each package
const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const dir of packageDirs) {
  const pkgPath = join(PACKAGES_DIR, dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const oldVersion = pkg.version;

  if (!LOCKSTEP.has(pkg.name)) {
    console.log(`${pkg.name}: ${oldVersion} (independent — not part of the release train)`);
    continue;
  }

  pkg.version = newVersion;

  // For non-core packages, sync peerDependencies on core
  if (pkg.name !== CORE_PKG_NAME && pkg.peerDependencies?.[CORE_PKG_NAME]) {
    pkg.peerDependencies[CORE_PKG_NAME] = `^${newVersion}`;
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkg.name}: ${oldVersion} → ${newVersion}`);
}

// Sync core version references in READMEs (peer-dep install snippets like
// `"@ai-react-markdown/core": "^1.4.5"` and inline examples like
// `@ai-react-markdown/core@1.4.5`) so docs don't drift behind releases.
const readmePaths = [join(ROOT, 'README.md'), ...packageDirs.map((dir) => join(PACKAGES_DIR, dir, 'README.md'))];
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[\w.]+)?`;
const README_PATTERNS = [
  [new RegExp(`("${CORE_PKG_NAME}":\\s*"\\^)${VERSION}(")`, 'g'), `$1${newVersion}$2`],
  [new RegExp(`(${CORE_PKG_NAME}@)${VERSION}`, 'g'), `$1${newVersion}`],
];
for (const readmePath of readmePaths) {
  if (!existsSync(readmePath)) continue;
  const before = readFileSync(readmePath, 'utf-8');
  let after = before;
  for (const [pattern, replacement] of README_PATTERNS) {
    after = after.replace(pattern, replacement);
  }
  if (after !== before) {
    writeFileSync(readmePath, after);
    console.log(`${readmePath.slice(ROOT.length + 1)}: core version refs → ${newVersion}`);
  }
}

console.log('\nDone. Run `pnpm install` to update the lockfile.');
