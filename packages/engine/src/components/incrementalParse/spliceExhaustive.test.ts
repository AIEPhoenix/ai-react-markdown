/**
 * BOUNDED-EXHAUSTIVE sweep — the census companion to the fuzz arbiter.
 *
 * Every sequence of ≤ K tokens from each of two alphabets is streamed
 * through EVERY 2-cut append schedule (plus a deterministic sample of
 * 3-cuts) under EVERY catalog config, and must satisfy:
 *   P1  per-frame splice ≡ fresh full parse (hast+mdast deep-equal);
 *   P2  checkpoint-resumed scan ≡ fresh scan (boundary values);
 *   P3  the frozen region at the raw() layer is invariant under append.
 * Within this bounded space the guarantee is EXHAUSTIVE, not
 * probabilistic — the small-scope hypothesis says line-lexer bugs
 * (off-by-one line state, blank-run accounting) overwhelmingly manifest on
 * tiny inputs.
 *
 * WHY IT CAUGHT NOTHING FOR SIX DEFECTS (F13, F16-F20). The 2026-08-27
 * architecture review found three independent causes, all addressed here:
 *
 *  - The properties were ENGAGEMENT-GATED. P1 and P2 only say something
 *    when the incremental path runs, and it runs on ~3% of census frames.
 *    P3 states the scanner's claim directly and needs no splice at all.
 *  - The CONFIG coverage was 2 of 6 catalog cells, one of them conditional
 *    on the document containing `': '`. F20 diverged on 3 of 6 cells.
 *  - The ALPHABET was hand-written. It is now derived on both axes — one
 *    token per scanner name-equivalence class (`NAME_CLASS_REPS`) and one
 *    per measured grammar-rule disagreement (`SHAPE_TOKENS`).
 *
 * TWO BANDS, and the split is structural rather than budgetary. The
 * FRAGMENT band is sub-line: `'<!--'`, `'>'`, `'-->'`, `'<?'` are pieces
 * that must COMPOSE within one line to build `<!-->`, `<!--->`, `<?>` —
 * the 2026-08 review found every P1 of its batch in that gap, so the band
 * needs DEPTH and lives or dies on K. The NAME band is line-shaped: one
 * scanner-taxonomy class per token, where the question is which names the
 * two grammars sort differently, not how bytes compose. It needs BREADTH,
 * and at line granularity three tokens already reach what the fragment
 * band needs five or six for. Merging them would multiply two alphabets
 * that want opposite knobs.
 *
 * Scale. CI runs the fragment band at K=3 and the name band at K=2. The
 * release gate lifts both, sharded — one process per shard, since a census
 * is a single vitest test and therefore a single core:
 *   for i in $(seq 0 11); do EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE=1 \
 *     EXHAUSTIVE_NAME_K=3 EXHAUSTIVE_SHARD=$i/12 \
 *     ../../node_modules/.bin/vitest --run src/components/incrementalParse/spliceExhaustive.test.ts & done
 * `EXHAUSTIVE_SHARD` scatters BOTH bands, so one set of shard processes
 * covers the whole leg. Knobs: `EXHAUSTIVE_CONFIGS` (label list) narrows
 * the catalog, `EXHAUSTIVE_RAW_FROZEN=0` turns P3 off,
 * `EXHAUSTIVE_NAME_K=0` skips the name band, `EXHAUSTIVE_NAME_STRIDE`
 * is its own cut stride.
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary, SCANNER_NAME_LISTS, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { CATALOG, buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';
import { assertStreamEquivalence, runFull, testEnv } from './spliceArbiterHarness';
import { engineProbe, probeTailsFor, snapshotRawDisagreement, type NodeLike } from './conformanceOracles';
import { CONSTRUCT_AXIS_CLAIMED_SHAPES } from './constructAxisAdapters';

/**
 * The FRAGMENT band: sub-line pieces that compose within a line.
 *
 * Hand-written, and staying that way — every entry is here because it
 * composes with another entry, which is a property of the pair rather than
 * of any list the scanner keeps. What was WRONG with hand-writing was
 * using it for the name axis too; that axis is derived below.
 */
const FRAGMENT_TOKENS = [
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
  '</br>',
  '/>',
  '<!--',
  // Bare closers/openers so the census can COMPOSE the overlapping and
  // divergent terminators (`<!-->`, `<!--->`, `<?>`, and a stray `-->`
  // after them) instead of only ever seeing complete or bare-open forms
  // (2026-08 project review: every P1 lived in this gap).
  '>',
  '-->',
  '<?',
  // Unicode whitespace line + a bracket left open across a line break: the
  // v2.4.1 review P1 pair (JS `trim()` vs micromark space; per-line ref scan).
  '\u3000\n',
  '[x\n',
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

/**
 * The NAME band's tag names, DERIVED from the scanner's own taxonomy at
 * test time — never transcribed.
 *
 * Two names are the same token iff they fall in the same cell of EVERY
 * list in `SCANNER_NAME_LISTS`. Nothing in the scanner can tell such a
 * pair apart, so sampling both buys nothing and costs a factor of the
 * alphabet size per K. Measured 2026-08-28: 91 names collapse to 16
 * classes, and the pairwise set-differences the review asked for fall out
 * as class boundaries rather than needing to be enumerated —
 * `TYPE1_NAMES \ RAW_TEXT_ELEMENTS` is the singleton class `{pre}`, which
 * is F13, and `RAW_TEXT_ELEMENTS \ TYPE1_NAMES` splits into `{noembed,
 * plaintext, xmp}`, `{iframe, noframes}` and `{title}` because the type-6
 * and scope-barrier lists cut across it.
 *
 * When an upstream `micromark-util-html-tag-name` bump moves a name, or
 * the scanner starts keying on a new list, the classes re-partition on the
 * next run and the corpus follows. That is the whole point of deriving it:
 * the previous alphabet named `<d>` and `</d>` — a made-up element in no
 * list at all — and could not have reached `pre` if it tried.
 *
 * SELF-CERTIFICATION, named rather than left implicit. A derived alphabet
 * inherits the blind spots of the list it derives from: a name that is
 * WRONG in `TYPE1_NAMES` is equally absent from the corpus meant to catch
 * it. That is F13 moved up one level, and it is worse than transcription
 * error in one specific way — it looks rigorous. So, as of 2026-08-28:
 *
 *   FALSIFIED against measured grammar behaviour by `constructAxisProbe`,
 *   over candidate pools WIDER than the lists themselves, so a missing
 *   name reds and not only an extra one — `type1`, `rawText`, `type6`,
 *   `void`. Deriving from these four is safe. `void` has three known
 *   omissions pinned by name (`basefont`, `bgsound`, `keygen` are void to
 *   parse5), all in the over-blocking direction; they sit in the type-6
 *   class here until the omission is closed, at which point the partition
 *   moves with it.
 *
 *   NOT FALSIFIED BY ANYTHING — `documentStructure`, `tablePart`,
 *   `scopeBarrier`, `foreignRoot`. The classes those four separate are
 *   self-certified: this corpus covers the distinctions the scanner
 *   BELIEVES it makes on them, and cannot cover a distinction it has
 *   wrongly failed to make. F19 lived on `scopeBarrier`. A green run over
 *   those cells is evidence about the splice, not about the list.
 *
 * LIMIT, stated because it bounds what a green run means: this equivalence
 * is the SCANNER's, not parse5's. `address` and `form` share a class here
 * and behave differently in parse5's tree construction — `form` is the
 * counterexample that refuted the (P) enumeration. Rule differences of
 * that kind are SHAPES, not names (`</script/>` differs from `</script>`
 * by a rule, not by a name); `SHAPE_TOKENS` below carries them, so the two
 * axes sit in one alphabet without either pretending to cover the other.
 */
const NAME_CLASS_REPS: readonly string[] = (() => {
  const universe = new Set<string>();
  for (const [, names] of SCANNER_NAME_LISTS) for (const name of names) universe.add(name);
  const byCell = new Map<string, string>();
  // Sorted so the representative is the lexicographically smallest member:
  // a stable choice that does not depend on Set iteration order, so the
  // corpus is reproducible across runs and across engines.
  for (const name of [...universe].sort()) {
    const cell = SCANNER_NAME_LISTS.map(([, names]) => (names.has(name) ? '1' : '0')).join('');
    if (!byCell.has(cell)) byCell.set(cell, name);
  }
  return [...byCell.values()].sort();
})();

/**
 * The construct-axis SHAPE tokens — the other half of the alphabet.
 *
 * A set difference over name lists yields NAMES. It cannot yield
 * `</script/>` versus `</script>`, which differ by a RULE: the stray slash
 * fails CommonMark's type-1 end condition while parse5 tokenizes the tag
 * anyway. That is the axis F16, F17 and F20 lived on, and no amount of
 * name derivation reaches it. `constructAxisAdapters.ts` MEASURES those
 * cells against both grammars and publishes the result.
 *
 * `CLAIMED`, not `DISAGREEING`, and the difference is the point.
 * `CONSTRUCT_AXIS_DISAGREEING_SHAPES` is 55 shapes, of which 40 are type-6
 * normality — micromark's html block ends at a blank line, parse5's
 * element ends at its own end tag, and the two disagreeing about that is
 * the design working. The 15 CLAIMED shapes are the ones a scanner member
 * asserts the grammars AGREE on when they do not, which is F20's family.
 * At 15 the alphabet grows 38 → 53 and the band costs ~1.9× at K=2; at 55
 * it would grow to 93 and cost ~14× at K=3, for tokens whose disagreement
 * is already understood. Weight, not volume.
 *
 * Every token in this band is a WHOLE NUMBER OF LINES, which is what makes
 * the newline-carrying shapes (`'</script\n>'`, from the `newline`
 * operator) safe to include rather than a trap: appending `'\n'` makes
 * that one two lines instead of one, and two lines is still a legal token
 * here. Splitting or dropping them would remove exactly the wrapped-tag
 * case the operator exists to produce.
 */
const SHAPE_TOKENS: readonly string[] = CONSTRUCT_AXIS_CLAIMED_SHAPES.map((shape) => `${shape}\n`);

/**
 * The NAME band's alphabet: LINE-shaped, one construct per token.
 *
 * Line granularity is where the reach comes from. The fragment band spends
 * tokens on the newlines between constructs — `'a'`, `'\n'`, `'\n\n'` — so
 * a three-line document costs five or six of its K. Here every token is a
 * whole line, so K=3 buys three lines — the 2026-08-27 review put F19's
 * shape at K=5-6 in fragment tokens and K=3 in line tokens.
 *
 * The markdown lines are not decoration: a scope barrier's second
 * consequence is that it discards the end tags MARKDOWN generates, so a
 * pure tag alphabet cannot reach it. `'> x\n'` and `'- x\n'` are the
 * generators; the blank line is what ends every block type but type 1.
 */
const NAME_CLASS_TOKENS: readonly string[] = [
  ...NAME_CLASS_REPS.flatMap((name) => [`<${name}>\n`, `</${name}>\n`]),
  ...SHAPE_TOKENS,
  '\n',
  'x\n',
  '- x\n',
  '> x\n',
  '[a]: /u\n',
  '```\n',
];

const MAX_K = Number(testEnv('EXHAUSTIVE_K') ?? 3);
/** Cut-schedule stride: CI samples every 3rd cut at K=3; deep runs set
 *  EXHAUSTIVE_STRIDE=1 for the full census. K≤2 is always full. The ≈40 s
 *  this comment used to quote predates six-config coverage and P3 — see
 *  the header for current costs. */
const CUT_STRIDE = Number(testEnv('EXHAUSTIVE_STRIDE') ?? (MAX_K >= 3 ? 3 : 1));
/**
 * Deep-run parallelism: a census is ONE vitest test — one worker, one
 * core. `EXHAUSTIVE_SHARD=i/N` makes this process drive a deterministic
 * 1/N hash-scatter of the documents, so N shard processes launched side
 * by side cover the space in ~1/N wall-clock:
 *   for i in $(seq 0 11); do EXHAUSTIVE_K=4 EXHAUSTIVE_SHARD=$i/12 … & done
 * The assignment hashes the doc counter instead of taking `docs % N`:
 * the counter is an odometer in base `tokens.length`, and whenever the
 * alphabet size shares a factor with N the high digits vanish from the
 * residue (30² ≡ 0 mod 12), leaving shard membership a function of the
 * LAST tokens only. Token identity drives per-doc cost (length² via the
 * cut count, ×2 configs on `: `), so that correlation produced a stable
 * ×1.5 wall-clock skew across census shards (measured 2026-08-24).
 * The doc/schedule counters still count the whole space walk, so the
 * sanity floors scale by TOTAL below.
 */
const [SHARD_INDEX, SHARD_TOTAL] = (() => {
  const raw = testEnv('EXHAUSTIVE_SHARD');
  if (!raw) return [0, 1];
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (!m) throw new Error(`EXHAUSTIVE_SHARD must be i/N, got ${JSON.stringify(raw)}`);
  const [i, n] = [Number(m[1]), Number(m[2])];
  if (n < 1 || i >= n) throw new Error(`EXHAUSTIVE_SHARD out of range: ${raw}`);
  return [i, n];
})();
/**
 * CONFIG COVERAGE — the whole catalog, not a curated pair.
 *
 * Until 2026-08-28 this leg drove `baseline` always and `def-list-only`
 * only when the document happened to contain `': '` — 2 of 6 catalog
 * cells, and one of those conditionally. F20 is what that hole costs: it
 * diverged on 100% of engaged frames on 3 of the 6 cells, and reading the
 * six-config aggregate instead of the per-cell rates made it look like
 * noise. A census that fixes the plugin selection is not a census of the
 * shipped configuration space.
 *
 * `EXHAUSTIVE_CONFIGS` narrows it back for cost experiments (a
 * comma-separated label list); the default is every cell.
 */
const CONFIGS = (() => {
  const raw = testEnv('EXHAUSTIVE_CONFIGS');
  if (!raw) return CATALOG;
  const wanted = raw.split(',').map((s) => s.trim());
  return wanted.map((label) => {
    const hit = CATALOG.find((c) => c.label === label);
    if (!hit) throw new Error(`EXHAUSTIVE_CONFIGS: no catalog config labelled ${JSON.stringify(label)}`);
    return hit;
  });
})();
/**
 * P3 costs ~13 raw-layer parse PAIRS per document that carries a boundary.
 * That is per DOCUMENT, not per schedule, so it is flat in the cut stride
 * while P1/P2 scale with it: measured at K=3 over six configs, P3 adds
 * 244 s to a 372 s sweep at stride 3 (66% overhead) but to a ~1100 s sweep
 * at stride 1 (22%). The gate runs at stride 1, so P3 rides along there
 * cheaply and this switch exists for cost experiments rather than for the
 * gate. `EXHAUSTIVE_RAW_FROZEN=0` turns it off.
 */
const RAW_FROZEN = (testEnv('EXHAUSTIVE_RAW_FROZEN') ?? '1') !== '0';
/** Scale the vitest timeout with K — K=4 is ~24× K=3. The floor carries a
 *  generous margin over the ~50 s local strided K=3 run: GitHub's shared
 *  runners are 2-3× slower (a 150 s run tripped a 120 s floor in CI while
 *  two earlier runs squeaked under — flaky by margin, not by content). */
const TIMEOUT_MS = Math.max(600_000, 90_000 * 24 ** Math.max(0, MAX_K - 3));

/**
 * The NAME band's own depth. It defaults to 2, not 3, and the reason is
 * the alphabet's size rather than timidity: the derived alphabet is ~38
 * tokens, so K=3 is 55k documents against the fragment band's 27k, but
 * each document is three LINES instead of a handful of characters, and the
 * cut count grows with length. Measured cost is in the commit message.
 * `EXHAUSTIVE_NAME_K=3` is the deep setting; `0` skips the band.
 */
const NAME_K = Number(testEnv('EXHAUSTIVE_NAME_K') ?? 2);
const NAME_STRIDE = Number(testEnv('EXHAUSTIVE_NAME_STRIDE') ?? (NAME_K >= 3 ? 3 : 1));
const NAME_TIMEOUT_MS = Math.max(600_000, 90_000 * 40 ** Math.max(0, NAME_K - 2));

/**
 * The census readout, on the real stream.
 *
 * `console.log` is DROPPED — verified 2026-08-28 by putting a bare
 * `console.log` in a passing test in this package and getting nothing on
 * either stream. This leg reported through `console.log`, so every
 * `[census]` line has been invisible since the vitest 4 upgrade, including
 * the engagement ratios the anti-vacuity floors are tuned against. The
 * cast is needed because the engine package takes no `@types/node` and its
 * `process` shim (`src/typings/shims.d.ts`) deliberately exposes only
 * `env`; widening that shim would hand production code a Node global the
 * package is built not to have.
 */
const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

/** Code-point-safe cut: never split a surrogate pair. */
const alignCut = (doc: string, at: number): number => {
  const code = doc.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at + 1 : at;
};

/**
 * P3 — RAW-LAYER FROZEN-REGION INVARIANCE, and the reason this leg is not
 * only about splices.
 *
 * P1 and P2 both require the incremental path to ENGAGE: P1 compares a
 * spliced frame against a full parse, P2 compares a resumed scan against a
 * fresh one. A document whose hosts never engage is swept, driven, and
 * proves nothing about the scanner's claim — the aggregate engagement
 * floor below measures ~3%, so ~97% of this census's documents were
 * carrying P1/P2 vacuously. F19's block hosts are exactly that shape
 * (inc=0 on every frame), so this leg would have missed F19 at any depth
 * with any alphabet. That is not an alphabet hole; it is a property hole.
 *
 * P3 closes it by asserting the scanner's claim DIRECTLY: bytes
 * `[0, boundary)` are settled, so every positioned node the raw layer puts
 * below the boundary must survive an arbitrary append unchanged. No splice
 * is involved, so engagement is irrelevant.
 *
 * Two deliberate choices:
 *  - The tails come from `probeTailsFor`, which appends prefix-COLLIDING
 *    material (an element name the prefix opened, a link/footnote label it
 *    used) on top of the static hazard battery. A static list cannot know
 *    what a given census document collides with.
 *  - The comparison is `snapshotRawDisagreement`, not the prefix-anchored
 *    `frozenRegion` shape in `boundaryDirection.test.ts`. That one pops
 *    trailing position-less children before comparing, justified in prose
 *    — structurally the F21 instrument defect, and sitting on the very
 *    seam class F15/F16/F17 lived in. The snapshot form needs no such
 *    carve-out: its one exemption (footnote-definition bytes) is computed
 *    from the INPUT document's own bytes and applied to BOTH sides. Its
 *    stated scope limit — position-less nodes are invisible to it — is
 *    inherited knowingly and pinned by the anti-vacuity readout below,
 *    which fails the sweep if P3 ever stops comparing nodes.
 *
 * WHAT IT REPORTS TODAY, so a non-empty `fired` count is not a surprise
 * to whoever reads the next run. At the CI point — fragment K=3, name K=2
 * — both bands are clean: `fired=0` on 285357 and 8151 probe positions
 * respectively. At `EXHAUSTIVE_NAME_K=3` the name band fires, and the
 * minimal shape is `"</address>\n</address>\n\n"`: the scanner freezes all
 * 23 bytes, and the raw text node at 10-11 grows from `"\n"` to `"\n\n"`
 * under any append. parse5 discards both stray end tags — nothing of that
 * name is open, so "any other end tag" walks the stack and drops it — and
 * the text on either side merges, BELOW the boundary. `</table>`,
 * `</script>`, `</b>` and `</d>` all do it; a single stray end tag does
 * not, and neither does the balanced `<address>…</address>` control. The
 * mechanism is the one `DOCUMENT_STRUCTURE_NAMES` poisons for, which is
 * keyed on four names while parse5 discards every unmatched end tag.
 * Shipped output does NOT diverge: 13 of 14 probe tails fire under
 * `baseline`, `display-only` and `no-orphan`, the engine diverges on 0 of
 * 14, and the splice refused all 14 (inc=false) — the stray-tag bail. The
 * other three configs grant boundary 0. Reported to the scanner's owner
 * rather than fixed here; a scanner change needs the five-leg gate.
 *
 * NOT done here, and why: `oracleCheckDoc` follows each document with a
 * ZERO-DISTANCE variant — the claimed prefix re-run as a document of its
 * own, so probes land directly on the boundary instead of behind the real
 * tail. It would double P3's cost, and a census gets most of it for free:
 * the corpus is every token sequence of length ≤ K, so a prefix that ends
 * at a token boundary IS already a shorter document in the same corpus,
 * probed at zero distance there. What that argument does NOT cover is a
 * boundary landing mid-token, which is where it stops being free.
 */
function driveRawFrozen(doc: string, config: CatalogConfig, stats: RawFrozenStats): void {
  const { defListEnabled } = buildAdvanceOptions(config);
  const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
  if (boundary <= 0) return;
  stats.boundaries += 1;
  const docMdast = runFull(doc, config).mdast as NodeLike;
  for (const probe of probeTailsFor(doc.slice(0, boundary))) {
    // An empty tail compares `raw(doc)` against itself: it cannot fire, and
    // counting it would pad the anti-vacuity readout with positions that
    // assert nothing.
    if (probe.tail === '') continue;
    const snap = snapshotRawDisagreement(doc, probe.tail, boundary, config, docMdast);
    stats.probes += 1;
    stats.nodesCompared += snap.nodesCompared;
    if (snap.nodesCompared > 0) stats.positions += 1;
    if (snap.detail === null) continue;
    stats.fired += 1;
    // The raw firing is the DETECTION. The VERDICT is what the engine
    // ships, measured independently for this exact position — and this is
    // not an exemption for the instrument, which drops nothing and gets no
    // allowlist. The system's safety contract is the scanner's boundary
    // AND the splice-side guards together (`headRoutedCaptureUnclosed`,
    // the stray-tag bail, seam synthesis), so a boundary the raw layer
    // refutes is a real scanner fault that a guard may already be
    // absorbing. Measured 2026-08-28 on `"</address>\n</address>\n\n"`:
    // the raw gate fires on 13 of 14 probe tails under `baseline`,
    // `display-only` and `no-orphan`, and the engine diverges on NONE of
    // them because the splice refused every one (inc=false on 14 of 14) —
    // the stray end tags in the frozen prefix trip the bail. Failing the
    // suite on that would be reporting a guard doing its job.
    //
    // So: engine divergence FAILS; a raw-only firing is counted and its
    // shape recorded, because a latent under-block masked by a guard is
    // exactly the thing that ships the day the guard is relaxed.
    const engine = engineProbe(doc, probe.tail, config);
    if (engine.usedIncremental) stats.firedEngaged += 1;
    // COLLECT, do not throw. A census is a 10-to-60-minute run; stopping at
    // the first firing spends all of it to learn one shape, and the triage
    // question is always "how many distinct shapes, and does the shipped
    // engine diverge on each" — an aggregate over one sample cannot answer
    // it. Deduped by probe and by the signature of the node that moved, so
    // one grammar fault reported by ten thousand documents shows up once.
    const line =
      `doc=${JSON.stringify(doc)} config=${config.label} probe=${probe.id} ` +
      `inc=${engine.usedIncremental} — ${snap.detail}` +
      (engine.disagreement === null ? '' : `\n    ENGINE: ${engine.disagreement}`);
    if (engine.disagreement !== null) {
      stats.defects += 1;
      if (stats.defectSamples.length < MAX_SAMPLES) stats.defectSamples.push(line);
      continue;
    }
    const key = `${config.label}|${probe.id}|${snap.detail.slice(0, 96)}`;
    if (stats.seen.has(key) || stats.samples.length >= MAX_SAMPLES) continue;
    stats.seen.add(key);
    stats.samples.push(line);
  }
}

interface RawFrozenStats {
  /** Documents whose scanner granted a non-zero boundary. */
  boundaries: number;
  /** Non-empty probe tails driven against those boundaries. */
  probes: number;
  /** Probe positions where at least one frozen node was compared. */
  positions: number;
  /** Frozen nodes compared, summed — a gate that compares nothing passes
   *  everything. */
  nodesCompared: number;
  /** Probe positions where a frozen node did not survive the append. */
  fired: number;
  /** Of `fired`, the ones where the splice actually engaged — the number
   *  that says how close the masked population is to shipping. */
  firedEngaged: number;
  /** Of `fired`, the ones where the SHIPPED engine also diverged. Any of
   *  these fails the census. */
  defects: number;
  defectSamples: string[];
  /** Deduped raw-only firings, capped at MAX_SAMPLES. */
  samples: string[];
  seen: Set<string>;
}

/** Enough distinct shapes to tell "one fault, many documents" from "a
 *  family"; small enough that a failure message stays readable. */
const MAX_SAMPLES = 20;

function drive(doc: string, cuts: number[], config: CatalogConfig): { frames: number; incrementalFrames: number } {
  const snapshots: string[] = [];
  for (const cut of cuts) {
    const end = Math.min(doc.length, alignCut(doc, cut));
    if (end > 0 && (snapshots.length === 0 || end > snapshots[snapshots.length - 1].length)) {
      snapshots.push(doc.slice(0, end));
    }
  }
  if (snapshots.length === 0 || snapshots[snapshots.length - 1] !== doc) snapshots.push(doc);

  // P1 — the arbiter throws with a labeled diff on any mismatch. The
  // engagement floor is an AGGREGATE over the whole census (asserted at the
  // end of the sweep): most short token sequences legitimately poison to
  // boundary 0, so a per-schedule floor would fight the alphabet.
  const stats = assertStreamEquivalence(
    `exhaustive doc=${JSON.stringify(doc)} cuts=${JSON.stringify(cuts)}`,
    snapshots,
    config,
    { minIncrementalFrames: 0 }
  );

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
  return stats;
}

interface SweepStats {
  docs: number;
  schedules: number;
  frames: number;
  incrementalFrames: number;
  rawFrozen: RawFrozenStats;
}

/** Walk every token sequence of length 1..maxK, driving P1/P2 over the cut
 *  schedules and P3 once per document, under every config. */
function sweep(tokens: readonly string[], maxK: number, stride: number): SweepStats {
  const out: SweepStats = {
    docs: 0,
    schedules: 0,
    frames: 0,
    incrementalFrames: 0,
    rawFrozen: {
      boundaries: 0,
      probes: 0,
      positions: 0,
      nodesCompared: 0,
      fired: 0,
      firedEngaged: 0,
      defects: 0,
      defectSamples: [],
      samples: [],
      seen: new Set(),
    },
  };
  // Iterative odometer over sequence lengths 1..maxK.
  for (let k = 1; k <= maxK; k++) {
    const idx = new Array<number>(k).fill(0);
    for (;;) {
      out.docs += 1;
      // Multiplicative hash, HIGH bits: low bits of `docs * odd` depend
      // only on low bits of `docs`, which would re-import the odometer
      // correlation the hash exists to break.
      if ((Math.imul(out.docs, 0x9e3779b1) >>> 16) % SHARD_TOTAL !== SHARD_INDEX) {
        // Not this shard's document — advance the odometer without even
        // building the string.
        let s = k - 1;
        while (s >= 0 && ++idx[s] === tokens.length) {
          idx[s] = 0;
          s -= 1;
        }
        if (s < 0) break;
        continue;
      }
      const doc = idx.map((i) => tokens[i]).join('');
      for (const config of CONFIGS) {
        // P3 first: it is per-document, not per-schedule, and it does not
        // care whether anything below engages.
        if (RAW_FROZEN) driveRawFrozen(doc, config, out.rawFrozen);
        // 2-cut schedules: every interior cut point (strided in CI; the
        // k-1 stride offsets rotate so every cut is hit across nearby
        // docs rather than the same residue class every time).
        for (let cut = 1 + ((out.docs + k) % stride); cut < doc.length; cut += stride) {
          const s = drive(doc, [cut], config);
          out.frames += s.frames;
          out.incrementalFrames += s.incrementalFrames;
          out.schedules += 1;
        }
        // Deterministic 3-cut sample: thirds (adds a mid-stream resume).
        if (doc.length >= 3) {
          const s = drive(doc, [Math.floor(doc.length / 3), Math.floor((2 * doc.length) / 3)], config);
          out.frames += s.frames;
          out.incrementalFrames += s.incrementalFrames;
          out.schedules += 1;
        }
      }
      // Odometer increment.
      let d = k - 1;
      while (d >= 0 && ++idx[d] === tokens.length) {
        idx[d] = 0;
        d -= 1;
      }
      if (d < 0) break;
    }
  }
  return out;
}

/**
 * Shared reporting and anti-vacuity floors.
 *
 * The engagement floor is PER BAND, and by two orders of magnitude, because
 * the corpora engage at different rates by construction: a floor sitting on
 * the mean of both would clear a total collapse in the weaker one. That is
 * the same mistake the six-config aggregate made about F20, at a different
 * scale.
 */
function reportAndAssert(band: string, tokens: readonly string[], maxK: number, stride: number, s: SweepStats): void {
  // The sweep must actually have swept (guards against a silent early-out
  // if the odometer or alphabet is refactored). `docs` counts the whole
  // walk; `schedules` counts only this shard's driven work.
  expect(s.docs).toBeGreaterThanOrEqual(tokens.length ** maxK);
  expect(s.schedules * SHARD_TOTAL).toBeGreaterThan(s.docs);
  emit(
    `\n[census:${band}] K=${maxK} stride=${stride} alphabet=${tokens.length} ` +
      `shard=${SHARD_INDEX}/${SHARD_TOTAL} configs=${CONFIGS.length} docs=${s.docs} ` +
      `schedules=${s.schedules} frames=${s.frames} incremental=${s.incrementalFrames} ` +
      `ratio=${(s.incrementalFrames / s.frames).toFixed(4)}\n` +
      `[census:${band}] P3 rawFrozen=${RAW_FROZEN ? 'on' : 'off'} boundaries=${s.rawFrozen.boundaries} ` +
      `probes=${s.rawFrozen.probes} positions=${s.rawFrozen.positions} ` +
      `nodesCompared=${s.rawFrozen.nodesCompared} ` +
      `blind=${s.rawFrozen.probes === 0 ? 'n/a' : (100 - (100 * s.rawFrozen.positions) / s.rawFrozen.probes).toFixed(1)}%\n` +
      `[census:${band}] P3 fired=${s.rawFrozen.fired} ofWhichEngaged=${s.rawFrozen.firedEngaged} ` +
      `engineDefects=${s.rawFrozen.defects} distinctRawShapes=${s.rawFrozen.samples.length}\n` +
      s.rawFrozen.samples.map((x) => `[census:${band}]   raw-only: ${x}\n`).join('')
  );
  if (s.rawFrozen.defects > 0) {
    expect.fail(
      `P3/${band} UNDER-BLOCK REACHED SHIPPED OUTPUT: ${s.rawFrozen.defects} of ${s.rawFrozen.fired} raw firings ` +
        `also diverged in the engine:\n` +
        s.rawFrozen.defectSamples.map((x) => `  ${x}`).join('\n')
    );
  }
  // Engagement floors, modelled on spliceFuzz's and measured 2026-08-28
  // over six configs. FRAGMENT: 48804/1693632 = 2.88% at K=3 stride 3, and
  // 933/91416 = 1.02% at K=2, where the documents are too short to carry a
  // candidate at all; 0.5% clears the smaller with 2× margin. NAME:
  // 396/301746 = 0.13% at K=2 — two orders of magnitude lower, because a
  // two-LINE document almost never leaves a confirmed blank line with
  // content after it, which is what a candidate needs. At that rate the
  // floor can only catch a TOTAL collapse, and saying so is better than
  // dressing 0.05% up as a coverage guarantee: the name band's real
  // anti-vacuity guard is P3's node density below, which does not care
  // whether anything spliced.
  expect(s.frames).toBeGreaterThan(0);
  expect(
    s.incrementalFrames / s.frames,
    `the ${band} census drove ${s.frames} frames and spliced ${s.incrementalFrames} — the path collapsed`
  ).toBeGreaterThan(band === 'fragment' ? 0.005 : 0.0005);
  // P3's own anti-vacuity floor. `probes` guards the outer loop (a refactor
  // that stops reaching `driveRawFrozen`, or an alphabet that stops
  // granting boundaries); the node DENSITY guards the instrument, which is
  // a SUBSET check and passes trivially wherever it compared nothing.
  //
  // Density, not the fraction of positions that compared something: most
  // probe positions here compare NO node — 83.4% of them in the fragment
  // band at K=3, 93.2% at K=2 — because a document a few tokens long
  // rarely has a positioned raw node lying wholly below its boundary. That
  // is a property of a small-scope corpus, not of a broken instrument, and
  // a positional floor tight enough to catch a blinded instrument would be
  // tripped by an alphabet change instead.
  //
  // Measured 2026-08-28: fragment band 91100/285357 = 0.319 nodes per
  // probe at K=3, and 1029/8088 = 0.127 at K=2. The floor has to clear the
  // SMALLEST configuration anyone runs, so it is set from K=2: 0.05 leaves
  // 2.5× margin there and 6.4× at K=3, and a total blinding (0/N, the
  // shape a root-children-only signature walk produced elsewhere in this
  // directory) is unmissable.
  if (RAW_FROZEN) {
    expect(s.rawFrozen.probes, `P3/${band} drove no probe tails — the raw-layer property never ran`).toBeGreaterThan(0);
    expect(
      s.rawFrozen.nodesCompared / s.rawFrozen.probes,
      `P3/${band} drove ${s.rawFrozen.probes} probes and compared ${s.rawFrozen.nodesCompared} frozen nodes — the instrument went blind`
    ).toBeGreaterThan(0.05);
  }
}

describe(`splice exhaustive sweep (fragment band K=${MAX_K}, alphabet=${FRAGMENT_TOKENS.length})`, () => {
  test('all sequences × all 2-cuts (+ sampled 3-cuts)', { timeout: TIMEOUT_MS }, () => {
    reportAndAssert('fragment', FRAGMENT_TOKENS, MAX_K, CUT_STRIDE, sweep(FRAGMENT_TOKENS, MAX_K, CUT_STRIDE));
  });
});

describe.skipIf(NAME_K === 0)(
  `name-class census (K=${NAME_K}, alphabet=${NAME_CLASS_TOKENS.length} from ${NAME_CLASS_REPS.length} classes)`,
  () => {
    test('every derived name-class line sequence', { timeout: NAME_TIMEOUT_MS }, () => {
      reportAndAssert('name', NAME_CLASS_TOKENS, NAME_K, NAME_STRIDE, sweep(NAME_CLASS_TOKENS, NAME_K, NAME_STRIDE));
    });
  }
);
