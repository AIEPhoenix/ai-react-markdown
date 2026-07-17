/**
 * BOUNDED-EXHAUSTIVE sweep — the census companion to the fuzz arbiter.
 *
 * Every sequence of ≤ MAX_K tokens from a markdown-hot alphabet is streamed
 * through EVERY 2-cut append schedule (plus a deterministic sample of
 * 3-cuts) and must satisfy the same properties as spliceFuzz:
 *   P1  per-frame splice ≡ fresh full parse (hast+mdast deep-equal);
 *   P2  checkpoint-resumed scan ≡ fresh scan (boundary values).
 * Within this bounded space the guarantee is EXHAUSTIVE, not
 * probabilistic — the small-scope hypothesis says line-lexer bugs
 * (off-by-one line state, blank-run accounting) overwhelmingly manifest on
 * tiny inputs.
 *
 * The alphabet is chosen to compose the detector's documented APPROX
 * approximations and the accepted under-count edge: raw-HTML open/close/
 * truncated/self-closing fragments, unterminated comment opener, CDATA/PI,
 * defs with (multi-line) titles, footnote refs/defs, list/quote/def-list
 * markers, fences, math, setext/thematic `---`, CR line ending, and
 * indented code.
 *
 * Scale: CI runs MAX_K=3 with a rotating cut stride of 3 (deterministic,
 * ~40 s). Deep runs lift both knobs —
 *   EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE=1 pnpm --filter @ai-react-markdown/core exec vitest --run src/components/incrementalParse/spliceExhaustive.test.ts
 * Sequences containing the def-list token additionally run under the
 * def-list config (the token is inert otherwise).
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';
import { assertStreamEquivalence, testEnv } from './spliceArbiterHarness';

const TOKENS = [
  'a',
  '\n',
  '\n\n',
  '\r\n',
  '[x]',
  '[x]: /u',
  '[x]: /u "t\nt2"',
  '`',
  '`<d>`',
  '<d>',
  '</d>',
  '<d',
  '/>',
  '<!--',
  '<![CDATA[<d>]]>',
  '<?p <b> ?>',
  '$$',
  '- ',
  ': ',
  '[^n]',
  '[^n]: y',
  '    ',
  '> ',
  '---',
] as const;

const MAX_K = Number(testEnv('EXHAUSTIVE_K') ?? 3);
/** Cut-schedule stride: CI samples every 3rd cut at K=3 (≈40 s); deep runs
 *  set EXHAUSTIVE_STRIDE=1 for the full census. K≤2 is always full. */
const CUT_STRIDE = Number(testEnv('EXHAUSTIVE_STRIDE') ?? (MAX_K >= 3 ? 3 : 1));
const BASELINE = CATALOG[0];
const DEF_LIST = CATALOG.find((c) => c.label === 'def-list-only')!;
/** Scale the vitest timeout with K — K=4 is ~24× K=3. */
const TIMEOUT_MS = Math.max(120_000, 90_000 * 24 ** Math.max(0, MAX_K - 3));

/** Code-point-safe cut: never split a surrogate pair. */
const alignCut = (doc: string, at: number): number => {
  const code = doc.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at + 1 : at;
};

function drive(doc: string, cuts: number[], config: typeof BASELINE): void {
  const snapshots: string[] = [];
  for (const cut of cuts) {
    const end = Math.min(doc.length, alignCut(doc, cut));
    if (end > 0 && (snapshots.length === 0 || end > snapshots[snapshots.length - 1].length)) {
      snapshots.push(doc.slice(0, end));
    }
  }
  if (snapshots.length === 0 || snapshots[snapshots.length - 1] !== doc) snapshots.push(doc);

  // P1 — the arbiter throws with a labeled diff on any mismatch.
  assertStreamEquivalence(`exhaustive doc=${JSON.stringify(doc)} cuts=${JSON.stringify(cuts)}`, snapshots, config);

  // P2 — resumed scan ≡ fresh scan, own lineage.
  const { defListEnabled } = buildAdvanceOptions(config);
  let checkpoint: FreezeScanCheckpoint | null = null;
  for (const snapshot of snapshots) {
    const fresh = computeFreezeBoundary(snapshot, { defListEnabled });
    const resumed = computeFreezeBoundary(snapshot, { defListEnabled }, checkpoint);
    if (resumed.boundary !== fresh.boundary) {
      expect.fail(
        `resume/fresh divergence doc=${JSON.stringify(doc)} len=${snapshot.length}: resumed=${resumed.boundary} fresh=${fresh.boundary}`
      );
    }
    checkpoint = resumed.checkpoint;
  }
}

describe(`splice exhaustive sweep (K=${MAX_K}, alphabet=${TOKENS.length})`, () => {
  test('all sequences × all 2-cuts (+ sampled 3-cuts)', { timeout: TIMEOUT_MS }, () => {
    let docs = 0;
    let schedules = 0;
    // Iterative odometer over sequence lengths 1..MAX_K.
    for (let k = 1; k <= MAX_K; k++) {
      const idx = new Array<number>(k).fill(0);
      for (;;) {
        const doc = idx.map((i) => TOKENS[i]).join('');
        docs += 1;
        const configs = doc.includes(': ') ? [BASELINE, DEF_LIST] : [BASELINE];
        for (const config of configs) {
          // 2-cut schedules: every interior cut point (strided in CI; the
          // k-1 stride offsets rotate so every cut is hit across nearby
          // docs rather than the same residue class every time).
          for (let cut = 1 + ((docs + k) % CUT_STRIDE); cut < doc.length; cut += CUT_STRIDE) {
            drive(doc, [cut], config);
            schedules += 1;
          }
          // Deterministic 3-cut sample: thirds (adds a mid-stream resume).
          if (doc.length >= 3) {
            drive(doc, [Math.floor(doc.length / 3), Math.floor((2 * doc.length) / 3)], config);
            schedules += 1;
          }
        }
        // Odometer increment.
        let d = k - 1;
        while (d >= 0 && ++idx[d] === TOKENS.length) {
          idx[d] = 0;
          d -= 1;
        }
        if (d < 0) break;
      }
    }
    // The sweep must actually have swept (guards against a silent early-out
    // if the odometer or alphabet is refactored).
    expect(docs).toBeGreaterThanOrEqual(TOKENS.length ** MAX_K);
    expect(schedules).toBeGreaterThan(docs);
  });
});
