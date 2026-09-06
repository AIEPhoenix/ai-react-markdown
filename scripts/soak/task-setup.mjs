/* global process */
import { writeFileSync } from 'node:fs';
import { afterAll } from 'vitest';

const task = JSON.parse(process.env.SOAK_TASK);
const expected = task.environment;
const environment = {};
for (const key of Object.keys(expected)) {
  environment[key] = process.env[key];
  if (environment[key] !== expected[key]) throw new Error(`soak effective environment mismatch: ${key}`);
}
for (const key of Object.keys(process.env)) {
  if (/^(EXHAUSTIVE_|FUZZ_|ORACLE_|FALLBACK_ORACLE_SAMPLE$)/.test(key) && !(key in expected))
    throw new Error(`undeclared soak environment: ${key}`);
}
const started = process.resourceUsage();
afterAll(() => {
  const usage = process.resourceUsage();
  writeFileSync(
    task.output,
    JSON.stringify({
      runId: task.runId,
      id: task.id,
      environment,
      userCpuMicros: usage.userCPUTime - started.userCPUTime,
      systemCpuMicros: usage.systemCPUTime - started.systemCPUTime,
      maxRssKiB: usage.maxRSS,
    }) + '\n'
  );
});
