/* global process, console */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const tag = process.argv[2];
const train = ['engine', 'core', 'react', 'react-mantine', 'vue'];
const match = /^(?:(v)|([a-z-]+)-v)(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(tag ?? '');
assert(match, `Invalid release tag: ${tag}`);
const [, isTrain, directory, version] = match;
assert(isTrain || directory === 'remark-mark-highlight', 'Only the independent plugin may use a package tag');
const root = read(isTrain ? 'package.json' : `packages/${directory}/package.json`);
assert.equal(root.version, version, 'Tag must match package version');
if (isTrain) {
  for (const name of train) {
    const pkg = read(`packages/${name}/package.json`);
    assert.equal(pkg.name, `@ai-markdown/${name}`);
    assert.equal(pkg.version, version, `${name}: incomplete release train`);
    assert(!pkg.private);
  }
  for (const [name, dependencies] of [
    ['core', ['engine']],
    ['react', ['core', 'engine']],
    ['vue', ['core', 'engine']],
  ]) {
    const pkg = read(`packages/${name}/package.json`);
    for (const dependency of dependencies) assert.equal(pkg.dependencies[`@ai-markdown/${dependency}`], 'workspace:*');
  }
  assert.equal(
    read('packages/react-mantine/package.json').peerDependencies['@ai-markdown/react'],
    version.includes('-') ? version : `^${version}`
  );
  assert.equal(read('packages/engine/package.json').dependencies['@ai-markdown/remark-mark-highlight'], 'workspace:^');
}
console.log(`Verified ${tag}; npm tag: ${version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest'}`);
