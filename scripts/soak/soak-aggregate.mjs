#!/usr/bin/env node
/* global Buffer, console, process, URL */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
let profileName = 'release';
if (argv[0] === '--profile') profileName = argv.splice(0, 2)[1];
if (argv.length === 0) {
  console.error('usage: soak-aggregate.mjs [--profile release|smoke] <run-dir>...');
  process.exit(2);
}
const root = new URL('.', import.meta.url);
const profile = JSON.parse(readFileSync(new URL(`profiles/${profileName}.json`, root), 'utf8'));
const errors = [];
const readTail = (file, bytes = 128 * 1024) => {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
};
const runs = argv
  .map((dir) => {
    const absolute = resolve(dir);
    for (const file of ['manifest.json', 'result.json']) {
      if (!existsSync(resolve(absolute, file))) errors.push(`${absolute}: missing ${file}`);
    }
    try {
      return {
        dir: absolute,
        manifest: JSON.parse(readFileSync(resolve(absolute, 'manifest.json'), 'utf8')),
        result: JSON.parse(readFileSync(resolve(absolute, 'result.json'), 'utf8')),
      };
    } catch (error) {
      errors.push(`${absolute}: ${error.message}`);
      return null;
    }
  })
  .filter(Boolean);

const first = runs[0]?.manifest;
const seen = new Map();
for (const run of runs) {
  const { manifest: m, result: r, dir } = run;
  if (m.schemaVersion !== 1 || r.schemaVersion !== 1) errors.push(`${dir}: unsupported schema version`);
  if (m.profile !== profile.name) errors.push(`${dir}: profile is ${m.profile}; expected ${profile.name}`);
  if (r.runId !== m.runId || r.mode !== m.mode || r.runKind !== m.runKind)
    errors.push(`${dir}: manifest/result identity differs`);
  if (r.repository?.commit !== m.repository.commit || r.repository?.dirty !== m.repository.dirty)
    errors.push(`${dir}: repository changed while the soak was running`);
  if (m.repository.commit !== first?.repository.commit) errors.push(`${dir}: commit differs`);
  if (m.seedBase !== first?.seedBase) errors.push(`${dir}: seed-base differs`);
  if (r.status !== 'passed') errors.push(`${dir}: run status is ${r.status}`);
  if (profile.requireFresh && m.runKind !== 'fresh') errors.push(`${dir}: release evidence must be fresh`);
  if (profile.requireCleanTree && m.repository.dirty) errors.push(`${dir}: release evidence has a dirty worktree`);
  for (const [name, rule] of Object.entries(profile.parameters)) {
    const value = m.parameters[name];
    if ('equals' in rule && value !== rule.equals) errors.push(`${dir}: ${name}=${value}; requires ${rule.equals}`);
    if ('minimum' in rule && !(value >= rule.minimum))
      errors.push(`${dir}: ${name}=${value}; requires >=${rule.minimum}`);
    if ('maximum' in rule && !(value <= rule.maximum))
      errors.push(`${dir}: ${name}=${value}; requires <=${rule.maximum}`);
  }
  for (const leg of m.legs) {
    if (seen.has(leg)) errors.push(`${leg}: duplicated by ${seen.get(leg)} and ${dir}`);
    seen.set(leg, dir);
    const lr = r.legs[leg];
    if (!lr) {
      errors.push(`${dir}: missing result for ${leg}`);
      continue;
    }
    if (lr.status !== 'passed') errors.push(`${dir}: ${leg} is ${lr.status}`);
    const logs = Array.from({ length: lr.expectedShards }, (_, i) => resolve(dir, `${leg}-${i}.log`));
    for (const log of logs) {
      if (!existsSync(log)) errors.push(`${dir}: missing ${log.split('/').pop()}`);
      else if (!/Tests\s+\d+ passed/.test(readTail(log))) errors.push(`${log}: missing passing Vitest verdict`);
    }
    const actualLogs = readdirSync(dir).filter((file) => file.startsWith(`${leg}-`) && file.endsWith('.log'));
    if (actualLogs.length !== lr.expectedShards)
      errors.push(`${dir}: ${leg} has ${actualLogs.length} logs; expected ${lr.expectedShards}`);
  }
}
for (const leg of profile.requiredLegs) if (!seen.has(leg)) errors.push(`missing required leg: ${leg}`);
for (const leg of seen.keys()) if (!profile.requiredLegs.includes(leg)) errors.push(`unknown leg: ${leg}`);

if (errors.length) {
  console.error('Release soak: INVALID');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
const shardCount = runs.reduce((n, r) => n + r.manifest.legs.length * r.manifest.shards, 0);
console.log('Release soak: PASS');
console.log(`Commit: ${first.repository.commit}`);
console.log(`Seed base: ${first.seedBase}`);
console.log(`Profile: ${profile.name}`);
console.log(`Runs: ${runs.length}`);
console.log(`Legs: ${seen.size}/${profile.requiredLegs.length}`);
console.log(`Shards: ${shardCount}/${shardCount} passed`);
