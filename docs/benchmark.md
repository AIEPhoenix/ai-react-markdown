# Benchmark: block-memo × incremental parse

Measured results for the two streaming optimizations — **block-level
memoization** (`blockMemoEnabled`, default on) and **incremental
prefix-freeze parsing** (`incrementalParseEnabled`, experimental, default
off) — individually and combined, against the legacy full pipeline. Read
[Streaming & Performance](./streaming-and-performance.md) first for what
each mechanism does; this document is the numbers.

Everything here is reproducible from the Storybook comparison stories — the
methodology section tells you exactly which story and which toggles.

---

## Methodology

- **Harness**: the Storybook A/B stories under `Core/AIMarkdown` —
  [`BlockMemoCompare`], [`IncrementalParseCompare`], [`BoostCompare`] (plus
  `*Isolated` process-isolated variants, not used for this run — same-page
  is the fairest JS-layer A/B since both sides share one main thread and
  receive the same stream in the same commit).
- **Scenario**: `randomTokens` — 2–8-char chunks at randomized 15–60 ms
  intervals, seeded PRNG, the closest shape to real LLM token streams.
- **Payload**: the Storybook stress payload (headings, prose, code fences,
  `$$` math, tables, blockquotes, lists) at 4× (2,968 chars / 29 blocks)
  and 16× (11,872 chars) scales.
- **Config**: spies OFF (clean timing), registry OFF (standalone), defs OFF.
- **Runs**: Run ×3 at 4× (the noise-band machinery needs same-config runs);
  single runs at 16× (each run is ~90 s of wall-clock streaming).
- **Environment**: Apple M3 Pro · Chrome · Storybook dev server · React
  **dev build** — absolute milliseconds run large; only the relative gap
  between the two columns of a comparison is meaningful.
- **Date / version**: 2026-07-15, on the commit series introducing
  incremental parsing (post-v1.5.1, pre-1.6.0).

Each comparison also runs the built-in **per-frame DOM-equality verifier**
(clobber prefixes normalized): both sides' live `innerHTML` must be
byte-identical on every streamed frame.

---

## Results — 4× payload (2,968 chars, ~560 frames, Run ×3)

| Comparison                | Sides                                 | Headline metric                 | Result                                                                         |
| ------------------------- | ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `BlockMemoCompare`        | memo vs legacy                        | commit-total Δ                  | +50 / +199 / +151 ms (mean +133) — **within the ±203 ms noise band → tie**     |
| `IncrementalParseCompare` | incremental vs full parse (both memo) | pipeline (scan+parse+transform) | **353 ms vs 2,174 ms → 84% saved**                                             |
| `IncrementalParseCompare` | 〃                                    | commit Δ across runs            | +1,740 / +1,676 / +1,603 ms — stable, well beyond noise                        |
| `BoostCompare`            | memo+incremental vs legacy            | commit total                    | **2,956 ms vs 5,196 ms → 2,240 ms saved (43%)**; runs +2,196 / +2,255 / +2,240 |

Per-side stage breakdown (incremental axis, sums over ~560 frames):

| Stage     | incremental ON | incremental OFF |
| --------- | -------------- | --------------- |
| scan      | 9.2 ms         | —               |
| parse     | 202.5 ms       | 907.1 ms        |
| transform | 141.4 ms       | 1,266.4 ms      |

Note the **transform** (remark/rehype plugin chain) saving exceeds the
parse saving itself — the tail-only run skips the plugin chain over the
frozen prefix too, which the pre-implementation estimates did not count.

## Results — 16× payload (11,872 chars, ~2,220 frames, single runs)

| Comparison                | Headline metric | Result                                                                          |
| ------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `BlockMemoCompare`        | commit-total Δ  | **4,094 ms saved (7.0%)**, beyond the ±2,347 ms noise band; p95 commit −12.4 ms |
| `IncrementalParseCompare` | pipeline        | **1,780 ms vs 28,328 ms → 94% saved**; commit Δ +24,316 ms                      |
| `BoostCompare`            | commit total    | **25,148 ms vs 56,608 ms → 31,460 ms saved (56%)**                              |
| `BoostCompare`            | p50 commit      | **7.6 ms vs 33.1 ms (4.3×)** — typical frame back inside the 60 fps budget      |
| `BoostCompare`            | p95 commit      | 71 ms vs 105 ms                                                                 |

## Correctness (all runs)

Every run's DOM-equality verifier reported **0 mismatches** (4×: 597
frames; 16×: 2,372 frames). The boost axis crosses all three output
contracts at once: legacy ≡ block-memo ≡ spliced.

## Cross-check

At 16×: boost (31.5 s) ≈ block-memo alone (4.1 s) + incremental alone
(24.3 s) = 28.4 s — the axes close to within single-run noise (±2.3 s) plus
baseline-interaction effects (the incremental axis is measured on a
memo-enabled baseline).

---

## Interpretation

1. **Incremental parsing is the dominant win for long streaming documents,
   and it scales.** Pipeline savings grow from 84% (4×) to 94% (16×)
   because the full-parse cost is O(document) per frame while the
   incremental cost is O(tail). The measurement-study estimate (70–89%,
   parse-only) is exceeded in the real pipeline because the transform
   plugin chain is skipped over the frozen prefix too.
2. **Block-memo alone ties at small/medium payloads and wins clearly at
   large ones** (7% commit total, −12 ms p95 at 16×) — exactly the regime
   split its documentation describes. Its role is the render-layer
   guardrail and the host for incremental parsing.
3. **The user-perceivable number is boost p50: 33 ms → 7.6 ms per commit at
   16×** — from consistently blowing the frame budget to comfortably inside
   it.

## Footguns — reading these numbers

- **Dev-build milliseconds are inflated.** React dev mode adds bookkeeping
  everywhere. Never quote the absolute values; quote the relative gap, and
  re-measure any production claim in a production build.
- **Respect the noise band.** The stories widen/tighten it from
  same-config run history; a delta inside the band is a tie no matter how
  green it looks. This page once mis-read small-payload noise as a
  regression — twice (see `BlockMemoComparison.tsx` header).
- **Spies exaggerate.** The component-count spies cost time proportional
  to render count, dragging whichever side renders more. All numbers above
  are spy-OFF.
- **Same-page vs isolated.** Same-page shares one main thread — fps / long
  tasks are page-wide, only React JS work is per-side. The `*Isolated`
  stories trade stream-delivery symmetry for genuinely per-side
  browser-level signals. Disagreement between the two is itself signal.
- **Stage panels vs commit totals.** On the incremental axis the stage
  table is the attribution-clean signal and commit Δ is noisy garnish; on
  the boost axis the legacy side emits no stage timings at all, so the
  commit total IS the headline.
- **Footnote payloads disengage incremental parsing** (`[^` → full-parse
  fallback, by design). A benchmark payload with a defs tail measures the
  fallback, not the splice — that's what the `defs` toggle is for.

## Reproducing

```sh
pnpm storybook   # → http://localhost:6006
```

Open `Core/AIMarkdown` → `BlockMemoCompare` / `IncrementalParseCompare` /
`BoostCompare`; set payload scale, turn spies off, hit **Run ×3**; read the
verdict banner (block-memo axis) or the summary strip (incremental/boost
axes). For per-side browser-level metrics use the `*Isolated` variants from
a loopback hostname on the dev machine.
