/* global process */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('Vue bootstrap scopes npm credentials to Vue; other train packages use OIDC', () => {
  const root = mkdtempSync(join(tmpdir(), 'aimd-publish-auth-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'state'));
    mkdirSync(join(root, 'runner'));
    for (const script of ['publish-packages.mjs', 'check-release.mjs'])
      copyFileSync(resolve('scripts', script), join(root, 'scripts', script));
    copyFileSync('package.json', join(root, 'package.json'));
    const packages = ['engine', 'core', 'react', 'react-mantine', 'vue', 'remark-mark-highlight'];
    for (const name of packages) {
      mkdirSync(join(root, 'packages', name), { recursive: true });
      copyFileSync(resolve('packages', name, 'package.json'), join(root, 'packages', name, 'package.json'));
    }
    const command = `#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2), tool = path.basename(process.argv[1]);
if (args.includes('pack')) process.exit(0);
let name;
if (tool === 'npm') {
  name = 'vue';
  const config = process.env.NPM_CONFIG_USERCONFIG;
  if (!config || !fs.readFileSync(config, 'utf8').includes('$'+'{FIRST_PUBLISH_NPM_TOKEN}')) throw Error('missing isolated placeholder config');
} else {
  name = args[args.indexOf('--filter') + 1].split('/').pop();
  if (process.env.NPM_CONFIG_USERCONFIG) throw Error('bootstrap credential leaked to OIDC subprocess');
}
fs.writeFileSync(path.join('state', name), tool);
`;
    for (const name of ['pnpm', 'npm']) {
      const file = join(root, 'bin', name);
      writeFileSync(file, command);
      chmodSync(file, 0o755);
    }
    const mock = `import fs from 'node:fs';
globalThis.fetch = async (url) => {
 const decoded = decodeURIComponent(url).replace('https://registry.npmjs.org/', '');
 const name = decoded.replace('-/package/', '').split('/')[1];
 const pkg = JSON.parse(fs.readFileSync('packages/' + name + '/package.json'));
 const published = fs.existsSync('state/' + name);
 const tags = { [pkg.version.includes('-') ? 'beta' : 'latest']: pkg.version };
 if (decoded.startsWith('-/package/')) return Response.json(tags);
 if (!published) return new Response('', { status: 404 });
 const manifest = { name: pkg.name, version: pkg.version, dist: { tarball: 'https://example.invalid/packed.tgz' } };
 return Response.json(decoded.split('/').length > 2 ? manifest : { versions: { [pkg.version]: manifest } });
};`;
    writeFileSync(join(root, 'mock.mjs'), mock);
    const env = {
      ...process.env,
      PATH: join(root, 'bin') + ':' + process.env.PATH,
      RUNNER_TEMP: join(root, 'runner'),
      FIRST_PUBLISH_NPM_TOKEN: 'test-placeholder-only',
      FIRST_PUBLISH_PACKAGE: '@ai-markdown/vue',
    };
    delete env.NPM_CONFIG_USERCONFIG;
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    execFileSync(
      process.execPath,
      ['--import', join(root, 'mock.mjs'), 'scripts/publish-packages.mjs', 'v' + version],
      { cwd: root, env, stdio: 'pipe', timeout: 15000 }
    );
    assert.equal(readFileSync(join(root, 'state/vue'), 'utf8'), 'npm');
    for (const name of packages.filter((name) => name !== 'vue'))
      assert.equal(readFileSync(join(root, 'state', name), 'utf8'), 'pnpm');
    assert(!readdirSync(join(root, 'runner/first-publish-packs')).includes('first-publish.npmrc'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
