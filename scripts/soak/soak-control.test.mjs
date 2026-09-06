import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LEGS, seedOverlap, taskEnvironment } from './soak-contract.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const script = (name) => resolve(root, `scripts/soak/${name}.mjs`);
const temp = (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'aimd-soak-control-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const put = (path, data) => writeFileSync(path, JSON.stringify(data));
const parameters = {
  fuzz1: 12500,
  fuzz2: 30000,
  fuzz3: 8000,
  fuzz4: 40000,
  oracle: 4000,
  censusK: 4,
  censusStride: 1,
  censusNameK: 3,
  censusNameStride: 1,
  censusConfigMode: 'cross',
  fallbackOracleSample: 20,
};
function fixture(dir) {
  const m = {
    schemaVersion: 2,
    runId: 'fixture',
    mode: 'full',
    runKind: 'fresh',
    profile: 'release',
    failFast: true,
    repository: { commit: 'fixture', dirty: false },
    seedBase: 1000,
    legs: LEGS,
    shards: 14,
    workers: 2,
    parameters,
  };
  const r = {
    ...m,
    status: 'passed',
    repositoryChanged: false,
    legs: Object.fromEntries(LEGS.map((leg) => [leg, { status: 'passed', expectedShards: 14, completedShards: 14 }])),
  };
  put(`${dir}/manifest.json`, m);
  put(`${dir}/result.json`, r);
  for (const leg of LEGS)
    for (let shard = 0; shard < 14; shard++) {
      const id = `${leg}-${shard}`;
      writeFileSync(`${dir}/${id}.log`, 'Tests  1 passed (1)\n');
      put(`${dir}/${id}.task.json`, { id, runId: m.runId, exitCode: 0, signal: null, status: 'passed' });
      put(`${dir}/${id}.vitest.json`, {
        success: true,
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        testResults: [{ status: 'passed' }],
      });
      put(`${dir}/${id}.runtime.json`, { id, runId: m.runId, environment: taskEnvironment(m, leg, shard) });
    }
  return { m, r };
}
const aggregate = (dir) => spawnSync('node', [script('soak-aggregate'), dir], { encoding: 'utf8' });

test('accepts complete structured evidence', (t) => {
  const dir = temp(t);
  fixture(dir);
  assert.equal(aggregate(dir).status, 0);
});
for (const fault of ['zero', 'missing', 'failed', 'skipped', 'environment', 'exit', 'count', 'log']) {
  test(`rejects ${fault} evidence`, (t) => {
    const dir = temp(t);
    const { r } = fixture(dir);
    const edit = (suffix, change) => {
      const path = `${dir}/fuzz-0.${suffix}.json`;
      const data = JSON.parse(readFileSync(path));
      change(data);
      put(path, data);
    };
    if (fault === 'zero') {
      r.legs.fuzz.expectedShards = 0;
      put(`${dir}/result.json`, r);
    }
    if (fault === 'count') {
      r.legs.fuzz.expectedShards = 1;
      put(`${dir}/result.json`, r);
    }
    if (fault === 'missing') rmSync(`${dir}/fuzz-0.vitest.json`);
    if (fault === 'failed')
      edit('vitest', (d) => {
        d.numFailedTests = 1;
      });
    if (fault === 'skipped')
      edit('vitest', (d) => {
        d.numPendingTests = 1;
      });
    if (fault === 'environment')
      edit('runtime', (d) => {
        d.environment.FUZZ_RUNS = '1';
      });
    if (fault === 'exit')
      edit('task', (d) => {
        d.exitCode = 1;
      });
    if (fault === 'log') writeFileSync(`${dir}/fuzz-0.log`, 'Tests 1 failed | 1 passed\nTests 1 passed\n');
    assert.notEqual(aggregate(dir).status, 0);
  });
}

test('seed overlap respects logical streams and conservatively handles old ledgers', () => {
  const a = { seedBase: 800000, legs: ['fuzz'], shards: 14 };
  assert.equal(seedOverlap(a, { ...a, seedBase: 800001 }), true);
  assert.equal(seedOverlap(a, { ...a, seedBase: 800014 }), false);
  assert.equal(seedOverlap(a, { ...a, legs: ['oracle'] }), false);
  assert.equal(seedOverlap(a, { seedBase: 799910, legs: ['fuzz'] }), true);
});

function createArgs(dir, seed) {
  return [
    script('soak-metadata'),
    'create',
    '--run-dir',
    `${dir}/run-${seed}`,
    '--run-id',
    `run-${seed}`,
    '--label',
    'test',
    '--mode',
    'subset',
    '--run-kind',
    'fresh',
    '--seed',
    String(seed),
    '--legs',
    'fuzz',
    '--shards',
    '14',
    '--workers',
    '1',
    '--fail-fast',
    '1',
    '--cores',
    '2',
    '--profile',
    'smoke',
    '--parameters',
    JSON.stringify(parameters),
    '--state-dir',
    `${dir}/state`,
  ];
}
test('metadata rejects overlapping seeds and accepts disjoint ranges', (t) => {
  const dir = temp(t);
  assert.equal(spawnSync('node', createArgs(dir, 800000)).status, 0);
  assert.notEqual(spawnSync('node', createArgs(dir, 800001)).status, 0);
  assert.equal(spawnSync('node', createArgs(dir, 800014)).status, 0);
});
test('concurrent overlapping seed reservations cannot both succeed', async (t) => {
  const dir = temp(t);
  mkdirSync(`${dir}/state`);
  const outcomes = await Promise.allSettled(
    [800000, 800001].map((seed) => promisify(execFile)('node', createArgs(dir, seed)))
  );
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
});

// Exercise the actual Vitest subprocess and its setup/reporting boundary.
async function realRun(t, workers, interrupt = false, fault = false, failFast = true) {
  const { spawn } = await import('node:child_process');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = temp(t);
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
  const m = {
    schemaVersion: 2,
    runId: 'integration',
    label: 'integration',
    mode: 'subset',
    runKind: 'replay',
    profile: 'smoke',
    repository: { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain') },
    startedAt: new Date().toISOString(),
    seedBase: 700001,
    legs: ['dir'],
    shards: 2,
    workers,
    failFast,
    parameters: { ...parameters, fuzz2: interrupt ? 100000000 : 100 },
  };
  put(`${dir}/manifest.json`, m);
  if (fault) mkdirSync(`${dir}/dir-0.runtime.json`);
  const child = spawn('node', [script('soak-runner'), dir], { cwd: root, stdio: 'ignore' });
  const done = new Promise((resolveDone) => child.once('exit', (code) => resolveDone(code)));
  t.after(() => child.kill('SIGTERM'));
  if (interrupt) {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = readFileSync(`${dir}/dir-0.log`, 'utf8').includes('RUN');
      } catch {
        /* Not started yet. */
      }
      if (ready) break;
      await delay(50);
    }
    assert.equal(ready, true);
    child.kill('SIGTERM');
  }
  const code = await done;
  const result = JSON.parse(readFileSync(`${dir}/result.json`));
  if (interrupt) {
    assert.notEqual(code, 0);
    assert.equal(result.status, 'interrupted');
    assert.equal(result.legs.dir.status, 'failed');
  } else if (fault) {
    assert.notEqual(code, 0);
    assert.equal(result.status, 'failed');
    assert.equal(result.legs.dir.completedShards, failFast ? 1 : 2);
  } else {
    assert.equal(code, 0);
    assert.equal(result.status, 'passed');
    for (let i = 0; i < 2; i++) {
      const runtime = JSON.parse(readFileSync(`${dir}/dir-${i}.runtime.json`));
      assert.deepEqual(runtime.environment, taskEnvironment(m, 'dir', i));
      assert.ok(runtime.maxRssKiB > 0);
    }
  }
}
test('one worker executes every logical shard', { timeout: 20000 }, (t) => realRun(t, 1));
test('two workers preserve the same logical streams', { timeout: 20000 }, (t) => realRun(t, 2));
test('interruption terminates workers and persists a non-passing result', { timeout: 20000 }, (t) =>
  realRun(t, 2, true)
);

test('fail-fast leaves unstarted shards unclaimed', { timeout: 20000 }, (t) => realRun(t, 1, false, true));
test('collect mode runs remaining shards after failure', { timeout: 20000 }, (t) => realRun(t, 1, false, true, false));
