#!/usr/bin/env node
/* global process, console */

// Sync all versions across the monorepo.
//
// Usage: node scripts/version-packages.mjs <new-version>
//
// - Updates "version" in every packages/*/package.json
// - For non-core packages, updates peerDependencies["@ai-react-markdown/core"] to ^<new-version>

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

  pkg.version = newVersion;

  // For non-core packages, sync peerDependencies on core
  if (pkg.name !== CORE_PKG_NAME && pkg.peerDependencies?.[CORE_PKG_NAME]) {
    pkg.peerDependencies[CORE_PKG_NAME] = `^${newVersion}`;
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkg.name}: ${oldVersion} → ${newVersion}`);
}

console.log('\nDone. Run `pnpm install` to update the lockfile.');
