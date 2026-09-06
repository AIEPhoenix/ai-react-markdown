/** Focused work/call-count evidence; not the benchmark runner or an E2E speed claim.
 * Run after pnpm build. The timing schedule is explicit, not wall-clock streaming. */
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { createRegistry } from '../../packages/engine/dist/index.js';

const require = createRequire(new URL('../../packages/mantine/package.json', import.meta.url));
const hljs = require('highlight.js');
const source = 'const result = items.map((item) => ({ ...item, score: item.value * 2 }));\n'.repeat(1000);
for (const stride of [1, 10]) {
  hljs.highlight(source, { language: 'javascript' });
  const times = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    const start = performance.now();
    for (let frame = stride; frame <= 100; frame += stride) {
      hljs.highlight(source.slice(0, Math.floor((source.length * frame) / 100)), { language: 'javascript' });
    }
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  process.stdout.write(
    `${JSON.stringify({ chars: source.length, inputFrames: 100, highlightCalls: 100 / stride, medianMs: times[2], times })}\n`
  );
}
const registry = createRegistry();
const chunk = registry.allocateSymbol('changed');
await Promise.resolve();
let globalCalls = 0,
  labelCalls = 0;
for (let i = 0; i < 1000; i++) {
  registry.subscribe(() => {
    registry.resolveLinkDef(`unchanged-${i}`);
    globalCalls++;
  });
  registry.subscribeLabel('link', `unchanged-${i}`, () => {
    registry.resolveLinkDef(`unchanged-${i}`);
    labelCalls++;
  });
}
registry.contributeLabels(chunk, new Set(), new Set(['UNRELATED']));
await Promise.resolve();
process.stdout.write(
  `${JSON.stringify({ subscribersPerMode: 1000, unrelatedUpdate: true, globalCalls, labelCalls })}\n`
);
