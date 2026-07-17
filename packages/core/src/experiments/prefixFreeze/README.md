# Experiment: prefix-freeze boundary detection for streaming parse

**Status: PRODUCTIONIZED** — the shipped implementation lives in
`src/components/incrementalParse/` (config flag `incrementalParseEnabled`);
this directory stays frozen as the ablation record and falsification
evidence behind it. The harness imports the production
`attributeHastChildren` and `pluginChain` builders so prefixes and plugin
order can never drift from production.

**Known divergence (intentional)**: the shipped detector evolved past the
L4 tier recorded here in BOTH directions. Stricter: post-review blockers
A1-A6, definition-list awareness, truncated tags, `normalizeIdentifier`.
Looser: inline code-span MASKING — this record counts `` `[x]` ``/`` `<div>` ``
inside code spans as taint/markup, production (correctly) masks them and
can freeze past inputs L4 pins at 0. The directional pin
`incrementalParse/detectorConsistency.test.ts` therefore holds
`production boundary <= experiment L4` only ON ITS CORPORA (which carry no
bracket/tag-bearing code spans), not universally — and the freeze-coverage
tables below are indicative for the shipped rule, not bounds. Safety
authority for the shipped detector is the production splice-equivalence
arbiter, not this record. Nothing here is imported by `src/index.tsx` or
shipped.

## Question

`@ant-design/x-markdown-mini` (2026-07 blog post) freezes a "stable prefix" at
the last blank-line boundary and re-lexes only the tail, cutting cumulative
streaming parse cost from O(N²) to O(N). Our block-memoization already avoids
re-RENDERING unchanged blocks, but `unified.parse` still runs over the full
document every frame (docs/streaming-and-performance.md, "Profiling").

Could a prefix-freeze rule be **safe** for our CommonMark/unified pipeline —
and how much parse work would it actually skip?

Their rule is safe only because of three properties we don't share:

1. marked is forgiving; micromark resolves reference-ness at parse time, so a
   late `[label]: url` definition retargets earlier literal text.
2. Footnotes are contractually excluded from their library (they test that the
   source contains no `footnote`); cross-segment semantics don't exist for them.
3. They have no `rehype-raw`: for us an unclosed `<details>` reparents every
   later top-level sibling into itself (the v1.5.1 swallow bug, commit a8e89ec).

## Method

- `detectFreezeBoundaries.ts` — a string-level detector computing five
  boundary rules per snapshot (an ablation ladder): **L0** single blank line
  outside fences (the blog post's claimed rule), **L1** double blank line (the
  rule x-markdown-mini actually ships), **L2** = L1 + unclosed-raw-HTML /
  HTML-comment / `$$`-flow-math blockers, **L3** = SINGLE blank + L2's
  blockers + a continuation-context blocker (CommonMark lists and footnote
  definitions are not terminated by blank lines), **L4** = L3 + a
  reference-taint blocker (every `[text][label]` / `[text]` / `[^fn]` in the
  prefix must resolve against a definition whose own block can no longer grow).
- `pipelineHarness.ts` — streams payloads chunk-by-chunk through the REAL
  default-on plugin stack (mirrored the same way `positionPropagation.test.ts`
  pins it) and **falsifies** boundary claims: the first `m` top-level hast
  children attributed to the frozen prefix must be deep-equal to the final
  frame's. Attribution is mdast-anchored because rehype-katex strips
  `position` from math output — a position-filtered check is blind to exactly
  the node that mutates while `$$` is unclosed.
- `prefixFreeze.test.ts` — adversarial fixtures (each tier's hazard class) +
  a realistic corpus (the Storybook benchmark payloads + CJK) with invariants:
  boundaries monotonic, **L4 never violates**.

Run with:

```sh
npx vitest --run --project unit --disable-console-intercept \
  packages/core/src/experiments/prefixFreeze/prefixFreeze.test.ts
```

## Findings (2026-07-14)

Falsification (violation = a frozen node changed in a later frame):

| hazard fixture               | L0           | L1           | L2           | L3           | L4  |
| ---------------------------- | ------------ | ------------ | ------------ | ------------ | --- |
| plain prose                  | ok           | ok           | ok           | ok           | ok  |
| loose list across blanks     | **violated** | **violated** | **violated** | ok           | ok  |
| unclosed `<details>` swallow | **violated** | **violated** | ok           | ok           | ok  |
| late `[label]:` definition   | **violated** | **violated** | **violated** | **violated** | ok  |
| late `[^fn]:` definition     | **violated** | **violated** | **violated** | **violated** | ok  |
| setext across blank line     | ok           | ok           | ok           | ok           | ok  |
| blank lines inside `$$` math | **violated** | **violated** | ok           | ok           | ok  |

Coverage on realistic streaming corpora (mean freeze % across frames):

| fixture               | L0          | L1 (x-mini's rule) | L3          | L4 (candidate rule) |
| --------------------- | ----------- | ------------------ | ----------- | ------------------- |
| llm-typical           | 76          | **0**              | 76          | 76                  |
| llm-typical-with-defs | 81 ⚠️unsafe | **0**              | 78 ⚠️unsafe | 73                  |
| llm-typical-3x        | 89          | **0**              | 87          | 87                  |
| double-blank-variant  | 77          | 77                 | 77          | 77                  |
| cjk-mixed             | 64          | **0**              | 64          | 64                  |

Estimated parse-cost saving (full pipeline vs L4-tail-only, per-frame sums):
70–89% depending on fixture. Timing is directional only — same-process warmup
noise applies; the freeze-% columns are the load-bearing numbers.

Takeaways:

1. **x-markdown-mini's shipped rule (L1, double blank) freezes 0% of typical
   LLM output** — models separate blocks with single blank lines. Its O(N)
   claim only materializes on content with double blank lines. Their blog
   post describes L0; their code ships L1.
2. **L0/L1 are unsafe under our pipeline** (lists, raw HTML, math, late
   defs) — every hazard predicted from first principles reproduced.
3. **L4 — single blank + HTML/math blockers + continuation blocker +
   reference-taint blocker — survived every falsification attempt while
   freezing ~73–87% of realistic content.** This is the candidate production
   rule for an incremental-parse design.
4. The reference-taint blocker costs real coverage on ref-heavy content
   (with-defs: 78→73 mean, 80→60 final) — that cost is exactly what the
   existing ctx-digest / cross-chunk machinery is for, and a production
   design should keep routing tainted blocks through it rather than trying
   to freeze them.
5. An EOF blank line must not count as a boundary until its newline arrives
   (unconfirmed lines break monotonicity); x-markdown-mini's scanner treats
   EOF as a line boundary and can commit prematurely.

## Verification stack upgrade (2026-07-17): fuzz + exhaustive + direction battery

The fixture arbiter (`incrementalParse/spliceEquivalence.test.ts`) was
generalized into a four-layer machine-driven verification stack, all built
on the shared oracle in `incrementalParse/spliceArbiterHarness.ts`:

| layer       | file                         | guarantee                                                                                                                                                                 |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| generative  | `spliceFuzz.test.ts`         | grammar-composed docs × append schedules × config rotation; splice ≡ full parse per frame + checkpoint-resume ≡ fresh scan; APPROX-biased generators with coverage meters |
| exhaustive  | `spliceExhaustive.test.ts`   | EVERY ≤K-token sequence over a 24-token markdown-hot alphabet × 2/3-cut schedules (census, not sampling, within the bound)                                                |
| directional | `boundaryDirection.test.ts`  | the "detector only over-blocks" claim as a tested property: frozen output stable under a 20-future hazard battery                                                         |
| sensitivity | `arbiterSensitivity.test.ts` | planted faults (historical under-block boundary, gutted checkpoint, single-node corruption) MUST fail — the suite that tests the suite                                    |

Soak / deep runs (all deterministic, seed-controlled):

```sh
FUZZ_RUNS=50000 FUZZ_SEED=<n> pnpm --filter @ai-react-markdown/core fuzz:splice
EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE=1 pnpm --filter @ai-react-markdown/core exec vitest --run src/components/incrementalParse/spliceExhaustive.test.ts
```

Counterexample workflow: fast-check shrinks every failure to a minimal
doc + schedule; freeze it verbatim (schedule included — failures are
frame-alignment-sensitive) into `spliceEquivalence.test.ts`'s
`FUZZ_CASES`, fix, and reverse-verify (checkout the pre-fix engine, the
new fixture must fail).

**Campaign findings — 18 engine bugs, all fixed + fixture-pinned** (the
fixture corpus embeds each one; see the FUZZ_CASES comments for
mechanisms): 4 detector UNDER-BLOCKS (code-span masking inside html-flow
continuation lines; stale blocker-3 verdict when a list interrupts a
paragraph / follows a closed fence-math line; a sticky flow flag
suppressing a real `$$` open after `-->` / after an ambiguous non-type-6
tag; math fences' LENGTH semantics — `$$$$` opens a 4-dollar fence that
swallows to a ≥4-dollar close, and meta may not contain `$`), 5
ghost-def registrations (html-flow continuation def lines; footnote defs
wrongly chaining; destination-less `[label]:`; non-title garbage after
the destination; and titles left OPEN at EOL, whose continuation line
can invalidate the whole def — multi-line titles now never register,
the documented A2 conservative edge), 1 under-taint (def-shaped
paragraph-continuation line skipping its live `[label]` ref), and 8
splice-layer divergences around hast-util-raw's less-traveled output
shapes (root-position anchoring, html-block trailing literals' position
lifecycle, seam merges around tokenizer-dropped raw constructs,
footer-only tails, and merged raw-remnant whitespace — the last two now
bail to a full parse rather than model the parse5 tokenizer). None were
reachable by the shipped default (`incrementalParseEnabled: false`);
all were real under the flag.

Soak record (2026-07-17..20): 8 seeds × 1.5-2.5k samples; 50k samples
(seed 20260750); 20k direction-battery prefixes (CLEAN — the over-block
claim held under bombardment); full K=3 census; K=4 stride-2 census,
finally landed CLEAN across all 12 shards after surfacing the last six
findings. Operations notes, learned the hard way: (1) run soaks under
`caffeinate` — a sleeping laptop inflates WALL-CLOCK past the vitest
per-test timeout, and a timed-out soak reports a failure with NO
counterexample; rerun awake before treating one as a finding. (2) the
census is ONE vitest test = one core; use `EXHAUSTIVE_SHARD=i/N` with N
parallel processes (12-way ≈ 8 min for K=4 on 16 cores vs 1-2 h and two
sleep-killed attempts single-core).

Mutation audit (`stryker.conf.json`, one-off 2026-07-17, not in CI):
killer suite = the fast arbiter set (`stryker.vitest.config.ts`). Score:
**64.55% total** (1061 killed, 19 timeout, 566 survived, 27 no-coverage,
0 errors; per file — advanceIncrementalParse 76.7%, computeFreezeBoundary
67.3%, spliceParse 60.6%; HTML report: `reports/mutation/`).

Reading the score honestly: an EQUIVALENCE arbiter cannot kill mutants
that only push the detector toward MORE conservatism — a mutant that
rejects extra candidates or extends a blocker changes freeze RATE, not
output, and surviving that way is the safe direction the whole design
leans on. A large share of the 566 survivors are expected to be of this
class (plus bail-path mutants whose only effect is a full-parse
fallback). Survivor-by-survivor disposition is follow-up material; the
sensitivity meta-suite (`arbiterSensitivity.test.ts`) already pins the
classes that MUST die (under-block boundary, checkpoint corruption,
output corruption).

## Footguns for a future production implementation

- Freezing must happen at the PARSE level to pay off; the frozen prefix's
  mdast/hast must be spliced with the tail's, which shifts no offsets
  (append-only) but does require re-basing the tail parse's positions.
- `rehype-raw` and `remark-math` make prefix TEXT stability ≠ prefix OUTPUT
  stability; the L2 blockers are load-bearing, not defensive.
- The synthetic footnote section is never freeze-eligible (production handles
  it via `FootnoteSectionEntry` / `aggregateFootnotesIfLast`, not the block
  cache).
- Detector approximations are conservative (inline code spans not masked;
  prose brackets count as reference taint). They cost coverage, not safety.
