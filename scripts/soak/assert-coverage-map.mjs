#!/usr/bin/env node
/* global console, process, URL */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(new URL('../../', import.meta.url).pathname);
const map = JSON.parse(readFileSync(resolve(root, 'scripts/soak/coverage-map.json'), 'utf8'));
const valid = new Set(['fuzz', 'dir', 'scanner', 'census', 'oracle', 'latex']);
const covered = new Set();
const declared = new Set();
const errors = [];
const scanMarkers = (directory) => {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) scanMarkers(path);
    else if (/\.tsx?$/.test(item.name)) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/@soak-entry\s+([a-z0-9-]+)/g)) declared.add(match[1]);
    }
  }
};
scanMarkers(resolve(root, 'packages/engine/src'));
for (const entry of map.entries) {
  if (!entry.id || !entry.oracle || !entry.antiVacuity) errors.push(`${entry.id || '<unnamed>'}: incomplete metadata`);
  for (const file of [entry.source, ...entry.tests])
    if (!existsSync(resolve(root, file))) errors.push(`${entry.id}: missing ${file}`);
  for (const leg of entry.legs) {
    if (!valid.has(leg)) errors.push(`${entry.id}: unknown leg ${leg}`);
    covered.add(leg);
  }
}
const mapped = new Set(map.entries.map((entry) => entry.id));
for (const id of mapped) if (!declared.has(id)) errors.push(`${id}: source is missing its @soak-entry marker`);
for (const id of declared) if (!mapped.has(id)) errors.push(`${id}: @soak-entry is absent from coverage-map.json`);
for (const leg of valid) if (!covered.has(leg)) errors.push(`no coverage entry owns leg ${leg}`);
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`soak coverage map: ${map.entries.length} entries, ${covered.size} legs covered`);
