#!/usr/bin/env node
/**
 * Compare two benchmark runs.
 *
 * Collecting baselines is only half of a benchmark; the other half is being
 * able to say whether two of them differ, and to say it in a way that does
 * not manufacture significance. This prints a per-cell delta and refuses to
 * call anything a regression that the runs themselves cannot separate.
 *
 * THE NOISE RULE. Each run records `settleSpreadMs` — the max-minus-min of
 * its own repeats. A delta smaller than the wider of the two spreads is
 * reported as `~` (indistinguishable), not as a small regression. This is the
 * one piece of judgement the tool applies, and it is applied conservatively
 * on purpose: a comparison that flags noise gets ignored within a week, and
 * then so does the one real signal it eventually produces.
 *
 * It still exits 0 on a regression. Nothing here gates yet — see the README.
 */
import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  process.stderr.write('usage: compare.mjs <before.json> <after.json>\n');
  process.exit(2);
}

const load = (p) => {
  const d = JSON.parse(readFileSync(p, 'utf8'));
  const byCell = new Map();
  for (const r of d.rows) byCell.set(`${r.app}/${r.scenario}`, r);
  return { stamp: d.stamp, throttle: d.throttle ?? 1, byCell };
};

const before = load(beforePath);
const after = load(afterPath);

// Different CPU multipliers produce numbers that look comparable and are not.
// Refusing is the only honest answer: a 4x row beside a 1x row differs by the
// throttle before it differs by anything about the renderer.
if (before.throttle !== after.throttle) {
  process.stderr.write(
    `refusing to compare: throttle ${before.throttle}x vs ${after.throttle}x. ` +
      "Re-run one of them at the other's multiplier.\n"
  );
  process.exit(2);
}

/** Metrics worth comparing, and which direction is worse. Node counts are
 *  included because a renderer that quietly doubles its DOM is a regression
 *  even when every timing holds. */
const METRICS = [
  ['streamMs', 'up'],
  ['settleMs', 'up'],
  ['rafP95Ms', 'up'],
  ['longTasks', 'up'],
  ['totalBlockingMs', 'up'],
  ['renderedNodes', 'up'],
  ['anchorDriftPx', 'up'],
  ['anchorMaxJumpPx', 'up'],
  ['scrollJankFrames', 'up'],
  ['scrollDriftPx', 'up'],
];

/** `heapBytes` is deliberately absent. It measures allocation churn rather
 *  than retention and is not comparable even between two runs of the same
 *  cell — measured 40/77/123 MB for three pacings converging on a
 *  byte-identical DOM. Comparing it would report a regression on nearly
 *  every run. See its field doc in `harness.ts`. */

const cells = [...new Set([...before.byCell.keys(), ...after.byCell.keys()])].sort();
process.stdout.write(`before: ${before.stamp}\nafter:  ${after.stamp}\nthrottle: ${before.throttle}x\n\n`);

let regressions = 0;
for (const cell of cells) {
  const b = before.byCell.get(cell);
  const a = after.byCell.get(cell);
  if (!b || !a) {
    process.stdout.write(`${cell}\n  only in ${b ? 'before' : 'after'} — not compared\n\n`);
    continue;
  }
  // A cell that did not settle is not a measurement to compare. Saying so
  // beats printing a delta between two lower bounds.
  if (b.outcome !== 'settled' || a.outcome !== 'settled') {
    process.stdout.write(`${cell}\n  outcome ${b.outcome} → ${a.outcome} — not compared\n\n`);
    continue;
  }
  if (b.anchorDetached === true || a.anchorDetached === true) {
    process.stdout.write(`${cell}\n  ⚠ anchor detached mid-stream in one of the runs — drift not compared\n\n`);
    continue;
  }
  if ((b.foreignNodes ?? 0) > 0 || (a.foreignNodes ?? 0) > 0) {
    process.stdout.write(`${cell}\n  ⚠ extension contamination in one of the runs — not compared\n\n`);
    continue;
  }

  // A cell whose own repeats disagree by more than the difference being
  // chased has not measured that difference. Printed per cell rather than
  // buried, because the reader's next move depends on it: raise `--repeats`
  // rather than believe the delta.
  const relNoise = (r, k) => {
    const sp = r.spreads?.[k];
    const v = r[k];
    return sp === undefined || sp === null || !v ? null : sp / Math.abs(v);
  };
  const worst = METRICS.map(([k]) => relNoise(b, k)).filter((x) => x !== null);
  const worstPct = worst.length > 0 ? Math.max(...worst) * 100 : null;

  const lines = [];
  for (const [k, worse] of METRICS) {
    const bv = b[k];
    const av = a[k];
    if (bv === null || av === null || bv === undefined || av === undefined) continue;
    const d = av - bv;
    if (d === 0) continue;
    const pct = bv === 0 ? null : (100 * d) / bv;
    // EACH metric is banded by ITS OWN repeat-to-repeat spread, taken from
    // whichever run varied more. Older files carry only `settleSpreadMs`;
    // for those, timing metrics fall back to it and the readout says so,
    // because banding a 15 s stream with a settle jitter is how a 0.03%
    // change gets called a regression.
    const ownSpread = Math.max(b.spreads?.[k] ?? 0, a.spreads?.[k] ?? 0);
    const legacy = b.spreads === undefined || a.spreads === undefined;
    const noise = legacy && k.endsWith('Ms') ? Math.max(b.settleSpreadMs ?? 0, a.settleSpreadMs ?? 0) : ownSpread;
    const indistinguishable = Math.abs(d) <= noise;
    const bad = (worse === 'up' && d > 0) || (worse === 'down' && d < 0);
    const mark = indistinguishable ? '~' : bad ? '▲' : '▼';
    if (bad && !indistinguishable) regressions += 1;
    lines.push(
      `  ${mark} ${k.padEnd(17)} ${String(Math.round(bv)).padStart(9)} → ${String(Math.round(av)).padStart(9)}` +
        `  ${d > 0 ? '+' : ''}${Math.round(d)}${pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`}` +
        `${indistinguishable ? `  within noise (±${Math.round(noise)})` : ''}`
    );
  }
  process.stdout.write(
    `${cell}` +
      `${b.repeats ? `   [n=${b.repeats}${b.warmup ? `+${b.warmup} warmup` : ''}` : '   ['}` +
      `${worstPct === null ? '' : `, widest spread ${worstPct.toFixed(0)}%`}]` +
      `${b.spreads === undefined || a.spreads === undefined ? '   [legacy file: bands fall back to settle spread]' : ''}\n`
  );
  process.stdout.write(lines.length > 0 ? `${lines.join('\n')}\n\n` : '  no change\n\n');
}

process.stdout.write(
  regressions === 0
    ? 'no metric moved the wrong way beyond the noise band\n'
    : `${regressions} metric(s) moved the wrong way beyond the noise band\n`
);
