#!/usr/bin/env node
/* global console, process */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
const get = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) throw new Error(`missing --${name}`);
  return args[i + 1];
};
const json = (path, value) => {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

if (command === 'create') {
  const runDir = resolve(get('run-dir'));
  const commit = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain').length > 0;
  const seedBase = Number(get('seed'));
  const legs = get('legs').split(',');
  const runKind = get('run-kind');
  const stateDir = resolve(get('state-dir'));
  mkdirSync(stateDir, { recursive: true });
  const registry = resolve(stateDir, 'seed-registry.jsonl');
  if (runKind === 'fresh' && existsSync(registry)) {
    for (const line of readFileSync(registry, 'utf8').split('\n').filter(Boolean)) {
      const prior = JSON.parse(line);
      if (prior.seedBase === seedBase && prior.runKind === 'fresh' && prior.legs.some((leg) => legs.includes(leg))) {
        throw new Error(
          `fresh seed ${seedBase} already reserved for overlapping leg(s) by ${prior.runId}; use RUN_KIND=replay to reproduce`
        );
      }
    }
  }
  if (existsSync(runDir)) throw new Error(`run directory already exists: ${runDir}`);
  const reservationsRoot = resolve(stateDir, 'seed-reservations');
  const madeReservations = [];
  if (runKind === 'fresh') {
    mkdirSync(reservationsRoot, { recursive: true });
    try {
      for (const leg of legs) {
        const reservation = resolve(reservationsRoot, `${seedBase}-${leg}`);
        mkdirSync(reservation);
        madeReservations.push(reservation);
      }
    } catch (error) {
      for (const reservation of madeReservations) rmdirSync(reservation);
      throw new Error(`fresh seed ${seedBase} was concurrently reserved for an overlapping leg: ${error.message}`, {
        cause: error,
      });
    }
  }
  try {
    mkdirSync(runDir, { recursive: false });
  } catch (error) {
    for (const reservation of madeReservations) rmdirSync(reservation);
    throw error;
  }
  const manifest = {
    schemaVersion: 1,
    runId: get('run-id'),
    label: get('label'),
    mode: get('mode'),
    runKind,
    status: 'running',
    startedAt: new Date().toISOString(),
    repository: { commit, dirty },
    host: { hostname: hostname(), platform: process.platform, detectedCores: Number(get('cores')) },
    seedBase,
    legs,
    shards: Number(get('shards')),
    profile: get('profile'),
    parameters: JSON.parse(get('parameters')),
  };
  json(resolve(runDir, 'manifest.json'), manifest);
  appendFileSync(
    registry,
    `${JSON.stringify({
      runId: manifest.runId,
      seedBase: manifest.seedBase,
      legs: manifest.legs,
      runKind: manifest.runKind,
      commit,
      startedAt: manifest.startedAt,
    })}\n`
  );
  process.stdout.write(`${runDir}\n`);
} else if (command === 'finish') {
  const runDir = resolve(get('run-dir'));
  const startedAt = get('started-at');
  const manifest = JSON.parse(readFileSync(resolve(runDir, 'manifest.json'), 'utf8'));
  const repository = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
  const repositoryChanged =
    repository.commit !== manifest.repository.commit || repository.dirty !== manifest.repository.dirty;
  const result = {
    schemaVersion: 1,
    runId: get('run-id'),
    mode: get('mode'),
    runKind: get('run-kind'),
    status: repositoryChanged ? 'invalid' : get('status'),
    startedAt,
    finishedAt: new Date().toISOString(),
    repository,
    repositoryChanged,
    legs: JSON.parse(get('legs-json')),
  };
  result.durationSeconds = Math.max(0, Math.round((Date.parse(result.finishedAt) - Date.parse(startedAt)) / 1000));
  json(resolve(runDir, 'result.json'), result);
  if (repositoryChanged) {
    console.error('soak: repository changed while the run was active; result is invalid');
    process.exitCode = 1;
  }
} else {
  throw new Error('usage: soak-metadata.mjs create|finish ...');
}
