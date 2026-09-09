/* global process, console, fetch, setTimeout, AbortSignal */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const releaseTag = process.argv[2];
execFileSync(process.execPath, ['scripts/check-release.mjs', releaseTag], { stdio: 'inherit' });
const directories = releaseTag.startsWith('v')
  ? ['remark-mark-highlight', 'engine', 'core', 'react', 'react-mantine']
  : [releaseTag.slice(0, releaseTag.lastIndexOf('-v'))];
const registry = 'https://registry.npmjs.org';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function metadata(path, install = false) {
  const response = await fetch(`${registry}/${path}`, {
    headers: { Accept: install ? 'application/vnd.npm.install-v1+json' : 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  assert(response.ok, `Registry metadata failed: ${response.status} ${path}`);
  return response.json();
}

for (const directory of directories) {
  const pkg = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8'));
  const { name, version } = pkg;
  assert(!pkg.private && name === `@ai-markdown/${directory}`);
  const escaped = name.replace('/', '%2f');
  const tag = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest';
  // Exact-version metadata and the install packument remain usable while
  // npm's full packument may return 404 for a newly created prerelease package.
  let published = await metadata(`${escaped}/${version}`);
  if (!published) published = (await metadata(escaped, true))?.versions?.[version];
  if (published) {
    assert.equal(published.name, name);
    assert.equal(published.version, version);
    console.log(`Already published: ${name}@${version}`);
  } else if (process.env.FIRST_PUBLISH_NPM_TOKEN) {
    const destination = join(process.env.RUNNER_TEMP, 'first-publish-packs');
    mkdirSync(destination, { recursive: true });
    execFileSync('pnpm', ['--filter', `./packages/${directory}`, 'pack', '--pack-destination', destination], {
      stdio: 'inherit',
    });
    const archive = join(destination, `${name.slice(1).replace('/', '-')}-${version}.tgz`);
    execFileSync('npm', ['publish', archive, '--access', 'public', '--provenance', '--tag', tag], { stdio: 'inherit' });
  } else {
    execFileSync(
      'pnpm',
      ['--filter', `./packages/${directory}`, 'publish', '--access', 'public', '--no-git-checks', '--tag', tag],
      { stdio: 'inherit' }
    );
  }
  let visible = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const packument = await metadata(escaped, true);
    const manifest = packument?.versions?.[version];
    if (manifest?.name === name && manifest.version === version && manifest.dist?.tarball) {
      visible = true;
      break;
    }
    await delay(5000);
  }
  assert(visible, `Published dependency is not visible to installers: ${name}@${version}`);
  let tags = await metadata(`-/package/${escaped}/dist-tags`);
  assert.equal(tags?.[tag], version, `${name}: expected ${tag}=${version}`);
  // First creation can synthesize latest even when --tag beta was explicit.
  // Remove only this prerelease's alias, preserving any existing stable latest.
  if (tag !== 'latest' && tags.latest === version) {
    execFileSync('npm', ['dist-tag', 'rm', name, 'latest'], { stdio: 'inherit' });
    tags = await metadata(`-/package/${escaped}/dist-tags`);
    assert.notEqual(tags?.latest, version, `${name}: prerelease remains on latest`);
    assert.equal(tags?.[tag], version);
  }
  console.log(`Verified installer metadata and ${tag} tag: ${name}@${version}`);
}
