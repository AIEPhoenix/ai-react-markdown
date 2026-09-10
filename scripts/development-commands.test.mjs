/* global process */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import test from 'node:test';

function runWithPnpm(script, args = [], extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'aimd-command-test-'));
  const log = join(directory, 'calls.jsonl');
  try {
    writeFileSync(
      join(directory, 'pnpm'),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMMAND_TEST_LOG, JSON.stringify({
  args, exportMode: process.env.STORYBOOK_DOCS_EXPORT,
  seed: process.env.CORE_SEQUENCE_SEED, path: process.env.CORE_SEQUENCE_PATH,
  runs: process.env.CORE_SEQUENCE_RUNS
}) + '\\n');
if (args.includes(process.env.COMMAND_TEST_FAIL)) process.exit(7);
`,
      { mode: 0o755 }
    );
    const result = spawnSync(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        STORYBOOK_DOCS_EXPORT: '',
        ...extraEnv,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        COMMAND_TEST_LOG: log,
      },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  'preflight reuses one build and runs both Storybook acceptance modes',
  { skip: process.platform === 'win32' },
  () => {
    const { result, calls } = runWithPnpm('scripts/preflight.mjs');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls.filter(({ args }) => args[1] === 'build').length, 1);
    const build = calls.findIndex(({ args }) => args[1] === 'build');
    const site = calls.findIndex(({ args }) => args[1] === 'build:storybook');
    assert(build < site);
    assert(calls[site].args.includes('--skip-build'));
    assert.equal(calls[site].exportMode, '1');
    for (const name of ['test:storybook:site', 'test:storybook:dev']) {
      assert(calls.findIndex(({ args }) => args[1] === name) > site);
    }
  }
);

test(
  'preflight stops immediately and preserves a failing command status',
  { skip: process.platform === 'win32' },
  () => {
    const { result, calls } = runWithPnpm('scripts/preflight.mjs', [], { COMMAND_TEST_FAIL: 'lint' });
    assert.equal(result.status, 7);
    assert.equal(calls.at(-1).args[1], 'lint');
    assert(!calls.some(({ args }) => args[1] === 'build'));
  }
);

test(
  'unit entry protects core sequence settings, forwards arguments and propagates failure',
  { skip: process.platform === 'win32' },
  () => {
    const { result, calls } = runWithPnpm('scripts/test-unit.mjs', ['--reporter=dot'], {
      CORE_SEQUENCE_SEED: '1',
      CORE_SEQUENCE_PATH: '0:0',
      CORE_SEQUENCE_RUNS: '1',
      COMMAND_TEST_FAIL: 'test',
    });
    assert.equal(result.status, 7);
    assert.deepEqual(calls[0].args, ['-r', 'test', '--reporter=dot']);
    assert.equal(calls[0].seed, undefined);
    assert.equal(calls[0].path, undefined);
    assert.equal(calls[0].runs, undefined);
  }
);
