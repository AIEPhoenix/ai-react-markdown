#!/usr/bin/env node
/**
 * Does this benchmark notice a slowdown?
 *
 * Nothing else here is worth running until that question has an answer. A
 * performance harness that reports numbers but cannot be shown to move when
 * the page gets slower is not a weak measurement — it is a measurement-shaped
 * object, and its green readings are worse than no readings because they will
 * be cited.
 *
 * The method: run one scenario with a known amount of synthetic main-thread
 * work injected per chunk (`?handicap=`), and require each metric to respond
 * WHERE IT CAN. Two arms, because the metrics do not all answer at the same
 * magnitude and pretending they do is how a self-test ends up either
 * toothless or wrong:
 *
 *  - **SMALL arm (6 ms/chunk).** Below the browser's 50 ms long-task
 *    threshold and inside a 16 ms frame budget, so long tasks, blocking time
 *    and frame pacing are all EXPECTED to stay flat — asserting they move
 *    would fail an honest harness. What must move is `streamMs`, and by
 *    roughly the injected budget. This arm proves the handicap runs at all;
 *    without it a broken `?handicap=` would make the large arm's failure
 *    unreadable.
 *  - **LARGE arm (60 ms/chunk).** Above the threshold, so every task becomes
 *    a long task. Blocking time is then predictable to arithmetic:
 *    `chunks x (handicap - 50)`, which is the definition of Total Blocking
 *    Time, not an estimate. Measured 2026-08-30: 462 chunks x 10 ms = 4620 ms
 *    predicted, 4610 ms observed — within 0.3%.
 *
 * That last number is why the tolerances here are tight. An earlier version
 * of this file allowed blocking time to come in at 40% of budget, and the
 * loose floor was not caution — it was not knowing the formula. A self-test
 * whose tolerance hides its author's uncertainty passes for the wrong reason.
 *
 * `renderedNodes` is the control in both arms: the handicap adds time, not
 * content. If node counts move, the two runs rendered different documents and
 * nothing else compared here means anything.
 *
 * Exits non-zero on failure. Deliberately not wired to a gate yet: this
 * asserts the instrument, and the instrument has to earn confidence before
 * anything it produces is allowed to gate.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const APP = { name: 'react-core', dir: 'benchmarks/react-core', port: 4317 };
/**
 * A TIMER-paced scenario on purpose, and the choice is load-bearing.
 *
 * Under timer pacing the injected handicap is added work against a fixed
 * arrival rate, so the relationship between "work injected" and "blocking
 * time observed" is arithmetic and can be asserted exactly. Under frame
 * pacing the handicap would slow delivery as well as rendering, and the two
 * effects are not separable — the assertions below would have to loosen into
 * "it got slower somehow", which is the kind of test that passes for the
 * wrong reason.
 *
 * The frame-paced scenarios are what release comparisons should use; this is
 * what proves the instrument reading them works.
 */
const SCENARIO = 'turn-taking';
const SMALL_MS = 6;
const LARGE_MS = 60;
/** The browser's own long-task threshold. Blocking time counts only the part
 *  of a task ABOVE this, which is what makes the large arm predictable. */
const LONG_TASK_MS = 50;
const REPEATS = 3;
/** An `immediate`-paced scenario, which is the only kind whose duration is
 *  the renderer's own cost. See arm 3. */
const THROUGHPUT_SCENARIO = 'throughput-code';

const sh = (cmd, args) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} → ${c}`))));
  });

const median = (xs) => {
  const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (s.length === 0) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function serve() {
  const p = spawn('pnpm', ['--filter', `./${APP.dir}`, 'run', 'preview'], { cwd: ROOT, stdio: 'ignore' });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) {
      p.kill();
      throw new Error('preview server never came up');
    }
    try {
      if ((await fetch(`http://localhost:${APP.port}/`)).ok) return p;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function measure(browser, handicap) {
  const samples = [];
  for (let i = 0; i < REPEATS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${APP.port}/?scenario=${SCENARIO}&handicap=${handicap}`, { waitUntil: 'load' });
    samples.push(
      await page.evaluate(async () => {
        const deadline = Date.now() + 240_000;
        while (!window.__bench && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
        if (!window.__bench) throw new Error('harness never installed');
        return await window.__bench.result();
      })
    );
    await ctx.close();
  }
  const pick = (k) => median(samples.map((s) => s[k]));
  return {
    streamMs: pick('streamMs'),
    longTasks: pick('longTasks'),
    totalBlockingMs: pick('totalBlockingMs'),
    rafP95Ms: pick('rafP95Ms'),
    renderedNodes: pick('renderedNodes'),
    outcome: samples[0].outcome,
  };
}

/** One run of `scenario` at a given CPU multiplier. Separate from `measure`
 *  because that one is fixed to the handicap scenario and to no throttle. */
async function measureThrottled(browser, scenario, rate) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (rate > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
  await page.goto(`http://localhost:${APP.port}/?scenario=${scenario}`, { waitUntil: 'load' });
  const m = await page.evaluate(async () => {
    const deadline = Date.now() + 240_000;
    while (!window.__bench && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    if (!window.__bench) throw new Error('harness never installed');
    return await window.__bench.result();
  });
  await ctx.close();
  return m;
}

async function chunkCountOf(browser, scenario) {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${APP.port}/?scenario=${scenario}`, { waitUntil: 'load' });
  const n = await page.evaluate(() => window.__benchChunks ?? null);
  await page.close();
  return n;
}

const fmt = (v) => (v === null || v === undefined ? '    n/a' : String(Math.round(v)).padStart(7));

async function main() {
  await sh('pnpm', ['--filter', `./${APP.dir}`, 'run', 'build']);
  const server = await serve();
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    const chunks = await chunkCountOf(browser, SCENARIO);
    if (chunks === null) throw new Error('app did not expose __benchChunks');

    const base = await measure(browser, 0);
    const small = await measure(browser, SMALL_MS);
    const large = await measure(browser, LARGE_MS);

    process.stdout.write(
      `\n[selftest] scenario=${SCENARIO}  chunks=${chunks}  repeats=${REPEATS}\n` +
        `[selftest] ${'metric'.padEnd(16)}${'base'.padStart(9)}${`+${SMALL_MS}ms`.padStart(9)}${`+${LARGE_MS}ms`.padStart(9)}\n`
    );
    for (const k of ['streamMs', 'longTasks', 'totalBlockingMs', 'rafP95Ms', 'renderedNodes']) {
      process.stdout.write(`[selftest]   ${k.padEnd(16)}${fmt(base[k])}${fmt(small[k])}${fmt(large[k])}\n`);
    }

    // --- SMALL arm: the handicap runs, and the clock sees it ---
    const smallBudget = chunks * SMALL_MS;
    const smallObserved = small.streamMs - base.streamMs;
    process.stdout.write(
      `[selftest] small arm: injected ${smallBudget}ms, stream grew ${Math.round(smallObserved)}ms ` +
        `(${((100 * smallObserved) / smallBudget).toFixed(0)}%)\n`
    );
    if (smallObserved < smallBudget * 0.7) {
      failures.push(
        `stream time grew only ${Math.round(smallObserved)}ms against ${smallBudget}ms injected — ` +
          'the handicap is not reaching the page, so the large arm below proves nothing either'
      );
    }
    if (small.longTasks > base.longTasks + 2) {
      failures.push(
        `a ${SMALL_MS}ms handicap produced long tasks (${base.longTasks} → ${small.longTasks}) — ` +
          `work under the ${LONG_TASK_MS}ms threshold must not be counted as blocking`
      );
    }

    // --- LARGE arm: blocking work is seen, and to arithmetic ---
    const tbtBudget = chunks * (LARGE_MS - LONG_TASK_MS);
    const tbtObserved = (large.totalBlockingMs ?? 0) - (base.totalBlockingMs ?? 0);
    const ratio = tbtObserved / tbtBudget;
    process.stdout.write(
      `[selftest] large arm: predicted TBT ${tbtBudget}ms (= ${chunks} x (${LARGE_MS} - ${LONG_TASK_MS})), ` +
        `observed ${Math.round(tbtObserved)}ms (${(100 * ratio).toFixed(1)}%)\n`
    );
    if (ratio < 0.85 || ratio > 1.15) {
      failures.push(
        `blocking time came in at ${(100 * ratio).toFixed(0)}% of the arithmetic prediction ` +
          `(${Math.round(tbtObserved)}ms vs ${tbtBudget}ms) — the long-task observer is mis-scoped`
      );
    }
    if (large.longTasks < chunks * 0.8) {
      failures.push(
        `only ${large.longTasks} long tasks for ${chunks} handicapped chunks — ` +
          'most of the injected work was not observed at all'
      );
    }
    if (base.rafP95Ms !== null && large.rafP95Ms !== null && large.rafP95Ms <= base.rafP95Ms * 1.5) {
      failures.push(
        `frame p95 barely moved (${base.rafP95Ms.toFixed(1)}ms → ${large.rafP95Ms.toFixed(1)}ms) under a ` +
          `${LARGE_MS}ms/chunk handicap — frame sampling is in the wrong window`
      );
    }

    // --- ARM 3: the throughput scenario is actually CPU-bound ---
    //
    // This is the assertion that keeps the suite honest about what it can
    // see. Two of the three pacings turned out to be bounded by a clock
    // rather than by the renderer — timer pacing by its own schedule, frame
    // pacing by the display's refresh rate — and neither could see a
    // verified fourfold CPU slowdown. If `immediate` pacing ever regresses
    // into waiting for something, every throughput number silently becomes a
    // restatement of that something, and nothing else here would notice.
    //
    // Measured 2026-08-30 on `throughput-code`: 328 ms at 1x, 1457 ms at 4x
    // — a ratio of 4.44. The band below is wide because the ratio includes
    // fixed costs the throttle does not scale (page setup, the final paint),
    // but a pacing bound would collapse it to ~1.0, which no honest band
    // contains.
    const cpuBound = await measureThrottled(browser, THROUGHPUT_SCENARIO, 4);
    const cpuFree = await measureThrottled(browser, THROUGHPUT_SCENARIO, 1);
    const ratio4x = cpuBound.streamMs / cpuFree.streamMs;
    process.stdout.write(
      `[selftest] throughput arm: ${THROUGHPUT_SCENARIO} ${Math.round(cpuFree.streamMs)}ms at 1x, ` +
        `${Math.round(cpuBound.streamMs)}ms at 4x — ratio ${ratio4x.toFixed(2)}\n`
    );
    if (ratio4x < 2.5) {
      failures.push(
        `${THROUGHPUT_SCENARIO} only slowed ${ratio4x.toFixed(2)}x under a 4x CPU throttle — ` +
          'it is bounded by a clock rather than by the renderer, so its numbers measure pacing, not throughput'
      );
    }

    // --- control, both arms ---
    for (const [name, arm] of [
      ['small', small],
      ['large', large],
    ]) {
      if (arm.renderedNodes !== base.renderedNodes) {
        failures.push(
          `${name} arm rendered a different document (${base.renderedNodes} → ${arm.renderedNodes} nodes) — ` +
            'the handicap is supposed to add time, not content, so nothing compared above holds'
        );
      }
    }
    for (const [name, arm] of [
      ['base', base],
      ['small', small],
      ['large', large],
    ]) {
      if (arm.outcome !== 'settled') failures.push(`${name} arm ended as ${arm.outcome} rather than settling`);
    }
  } finally {
    await browser.close();
    server.kill();
  }

  if (failures.length > 0) {
    process.stderr.write('\n[selftest] FAILED\n');
    for (const f of failures) process.stderr.write(`[selftest]   - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write('\n[selftest] PASS — every metric responds where it can, and stays flat where it should\n');
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e}\n`);
  process.exit(1);
});
