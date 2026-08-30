# Browser benchmarks

What a user's browser actually does with this renderer: frame pacing while a
long answer streams in, how much of the main thread a code-dense answer
blocks, how big the DOM gets across a conversation, whether the page moves
under a scroll.

Every other performance number in this repo stops at the parse layer. Those
answer "how long did the engine take"; none of them answers "does a user's
scroll stutter". This directory is the second question, and it exists mostly
so that optimisations aimed at it (workers, viewport priority) have something
to be accepted against — without it, doing that work and claiming a win is
guesswork.

## Running

```bash
pnpm bench:web                     # every app x every scenario, 3 repeats
pnpm bench:web --app react-core    # one app
pnpm bench:web --scenario code-dense --repeats 5
pnpm bench:web --headed            # watch it
pnpm bench:web:selftest            # does the harness notice a slowdown?
```

Results land in `benchmarks/results/<timestamp>.json` (gitignored). Compare
two runs with `node benchmarks/runner/compare.mjs <before.json> <after.json>`.

**It gates nothing.** That is a decision, not an omission: a budget wired
into CI before anyone knows the noise band goes red on the third honest run
and is muted by the fifth. Collect baselines across several releases first,
then decide what a real regression looks like.

## Layout

| Path             | What lives there                                                   |
| ---------------- | ------------------------------------------------------------------ |
| `kit/`           | Scenarios and the measurement harness. Framework-agnostic.         |
| `react-core/`    | The `@ai-react-markdown/core` README integration, instrumented.    |
| `react-mantine/` | The `@ai-react-markdown/mantine` README integration, instrumented. |
| `runner/`        | Playwright driver, self-test, comparison.                          |

Three rules hold this apart, and each of them was a decision:

**Scenarios never import a renderer.** A scenario is content plus a delivery
schedule. That is what lets the same scenario run under every app and be
compared, and what will let a future framework adapter join without touching
`kit/scenarios.ts`. An app that knows a scenario by name has already broken
the split.

**Each framework is its own app, not a prop.** The mantine variant pulls in a
provider tree, a highlight.js adapter and three more stylesheets. Sharing one
app and branching inside it would put both dependency graphs into both
bundles, and each measurement would describe the other.

**The integration is the README's, verbatim.** The imports and the JSX in
each `main.tsx` are copied from the package README's quick start; the
instrumentation is placed around them, never between them and React. The
moment an app memoises the content or batches the updates, it stops
describing the library and starts describing our cleverness — and the
regression it then fails to catch is exactly the one a user hits.

The apps depend on `@ai-react-markdown/*` as `workspace:*`, which resolves
through each package's own `exports` to its built `dist` — the same entry
point npm hands a user. It is not a source-level import and must not become
one.

## Why not Storybook

The cheap route was to point Playwright at the existing `storybook-static`;
41 stories already build, and the plan originally said to do exactly that.
Rejected: Storybook ships its own runtime, router and preview iframe into the
page, and every number collected here — LCP, long tasks, DOM node counts, rAF
gaps — would count that runtime too. A baseline that includes a harness the
user never installs cannot answer "is our renderer fast", only "is our
renderer plus Storybook fast", and the two drift apart silently as Storybook
upgrades.

## The self-test is the load-bearing part

`pnpm bench:web:selftest` injects a known amount of main-thread work per chunk
and requires the metrics to respond where they can and stay flat where they
should. Run it before trusting any number out of `bench:web`, and after
touching the harness.

It has two arms because the metrics do not all answer at the same magnitude:

- **6 ms/chunk** is below the browser's 50 ms long-task threshold and inside a
  16 ms frame budget, so long tasks and frame pacing are _expected_ to stay
  flat. What must move is stream time. Asserting anything else here would fail
  an honest harness.
- **60 ms/chunk** puts every chunk over the threshold, and blocking time
  becomes arithmetic: `chunks x (handicap - 50)` is the definition of Total
  Blocking Time. Measured 2026-08-30: 4620 ms predicted, 4610 ms observed.

That 0.3% is why the tolerances are tight. The first version of the self-test
allowed blocking time to arrive at 40% of budget, and the loose floor was not
caution — it was not knowing the formula. It also failed on its first run, for
a real reason: it injected 6 ms and asserted that long tasks would appear.
They correctly did not.

## Cross-app numbers are not comparable, cross-time ones are

The two apps do not render the same DOM for the same scenario, by design.
Measured 2026-08-30 on `code-dense`: `react-core` produces 24 `<pre><code>`
blocks and zero spans, because core ships no highlighter; `react-mantine`
produces thousands of nodes because highlight.js emits a span per token. On
`mermaid-dense`, core leaves 40 code fences as text while mantine renders
diagrams into SVG.

So a node count of 74 against 4275 is not core "winning" — it is the two
packages doing different amounts of work, which is the whole reason both are
measured. Compare a cell against ITSELF over time. `compare.mjs` keys on
`app/scenario` and will never put two apps side by side; keep it that way.

## Scale — the axis on which a defect hides completely

`pnpm bench:web:scale` runs the `scale-*` cells and fits log(bytes) against
log(streamMs). The output is one number, the growth exponent: ~1.0 linear,
~1.5 superlinear, ~2.0 quadratic.

It deserves its own tool because every other cell in this suite is between
11 KB and 36 KB — one size wearing several names — and a renderer that is
quadratic in document length posts healthy numbers at that size. Scale is
the only axis where a defect hides entirely rather than partially.

Measured 2026-08-30, `react-core` unthrottled:

| cell           |    size |  stream |     ms/KB |
| -------------- | ------: | ------: | --------: |
| `scale-short`  |  2.1 KB |   52 ms |     25.06 |
| `scale-medium` | 18.4 KB |  355 ms | **19.24** |
| `scale-long`   |  148 KB | 9404 ms |     63.71 |
| `scale-xlong`  | 1.15 MB |       — |         — |

**Two findings, and the first needs no fit at all: at 1.15 MB the renderer
does not finish within three minutes.** The cell hits the harness cap and is
excluded from the exponent, which is the honest treatment — a timeout is a
deadline, not a duration.

Across the sizes that did finish the exponent is **1.22**, and cost per KB
rises 3.3x from the 18 KB optimum to 148 KB. That is corroborated
independently: sampling the DOM through a `throughput-math` run gave quarter
costs of 1245, 2935, 4825 and 6420 ms — same shape, different scenario,
different method.

Note where the existing scenarios sit: 11–36 KB, straddling the optimum. The
suite reported health for as long as it did partly because it only ever
measured the size this renderer is best at.

## How small a difference this can resolve

Measured 2026-08-30, twelve consecutive runs of each cell on an idle laptop:

| cell              | run-to-run spread | what it is                    |
| ----------------- | ----------------: | ----------------------------- |
| `burst-code`      |                0% | pinned to the display refresh |
| `throughput-long` |                4% | genuine noise                 |
| `throughput-code` |      8% → 5% warm | the shortest cell; warms up   |

So **a change under ~5% is not resolvable** on the fast cells and should not
be reported as one. `compare.mjs` enforces this per metric using each run's
own spread, and prints the sample size and the widest spread beside every
cell — if that number is larger than the delta you are chasing, raise
`--repeats` instead of believing the delta.

Three settings exist to keep that band tight, and each was measured rather
than copied from folklore:

- `--warmup 2` discards the first samples. Only the shortest cell warms up,
  and only for about two runs (341, 331 against a steady ~317).
  `throughput-long` gains nothing from discarding — its 4% is real noise —
  and the frame-paced cells do not vary at all. Discarding is not free, so
  the default is the smallest number the measurement supports.
- `--repeats 5`, because a 3-sample median over a 5% spread is itself
  unstable.
- `--settle-between 400` leaves quiet time between samples, so one run's
  teardown and GC do not land inside the next.

Measurement is strictly serial — one app, one scenario, one repeat at a time.
Running cells in parallel was tried and is worse in the way that matters:
three concurrent pages gave 357/358/358 against a serial median of 323. The
spread collapses to 0% because every page is equally starved, which looks
like precision and is a systematic 11% offset.

## Reading a result

`outcome` is the first column to look at. A row that is not `settled` never
went quiet, and its settle-derived numbers are lower bounds rather than
measurements.

`frames` is the second. A p95 over a handful of frames is not a p95, and only
the sample count says so.

Null is not zero anywhere in the output. A metric the browser never reported
comes back null on purpose — "this page had no layout shift" and "this engine
does not report layout shift" are different facts, and a zero blurs them.

## Visual verification uses a different browser than the numbers

The runner drives a clean Playwright Chromium: no profile, no extensions.
Looking at a scenario through a normal browser (or an agent driving your real
profile) does **not** show the same page.

Measured while building this: a translation extension injected 55 nodes into
the render container and rewrote text between two consecutive queries, taking
the element count from 271 to 166 while the document only grew. Any count
taken there is contaminated.

### Anchor drift — the complaint nothing else here can see

`anchor-*` scenarios scroll to a rendered element part-way through delivery,
then stop touching the scroll position and watch that element's viewport
offset for the rest of the stream. Every pixel it moves is content growing or
reflowing ABOVE it — "the page jumped while I was reading", which is the most
common complaint about streaming renderers and which no timing metric can
detect.

Two numbers: `anchorDriftPx` totals the movement, `anchorMaxJumpPx` is the
largest single-frame jump. They read differently on purpose — 40px spread
across a long stream is a slow creep, 40px in one frame is a jolt, and only
the second is what a reader notices.

This is NOT the same thing as `after: 'scroll'`. That arm runs once the
stream has drained, on a document that has stopped changing, so it reports
approximately zero by construction and always did. It is kept because "does a
settled document scroll smoothly" is a fair question, but it was never the
question its own docstring claimed.

The anchor is picked from what the renderer has already produced rather than
planted by the scenario. A planted marker is a node the renderer would have
to preserve, and the shapes that drift are precisely the ones where nodes get
replaced instead of appended — a marker would have papered over the case
worth catching. If the anchor is replaced mid-stream, tracking stops rather
than reporting a number that quietly means something else.

Two things make a zero here readable rather than ambiguous.

**The self-test forces it non-zero.** Arm 5 grows a DOM block above the
renderer's container and requires the drift to be large — measured 35,096px
against 0px on a normal run. Without that, `0px` is equally consistent with
"the renderer is well behaved" and "the tracker is broken", and it took seven
independent failures to learn that the second is the likelier reading. Each
of them produced exactly `drift=0px`: arming on frame count instead of
document height (so the anchor sat at the top with nothing above it), a
diagnostic script that reimplemented the arm logic instead of calling it, a
probe that served a stale build, an anchor placed inside the control's own
filler, a scroll-anchoring opt-out that covered one wrapper instead of the
subtree, the same opt-out applied after the browser had already pinned the
scroll position, and finally a control that prepended to the MARKDOWN — which
re-parses into a different tree, so React replaced the nodes and the anchor
detached on its first sample.

**`anchorDetached` is reported.** A detached anchor stops the measurement, so
its zero is the absence of a result rather than a result. The runner prints
`⚠detached` and `compare.mjs` refuses to compare such a row.

Scroll anchoring is the other half of why a zero is not trivial. Chrome moves
`scrollY` to absorb content inserted above the viewport, so what this metric
reports is what the READER SAW move, not what the layout moved — measured on
a minimal repro, inserting 20 paragraphs above an anchor moves it 0px while
`scrollY` jumps 927 → 1607, and 680px with `overflow-anchor: none`. A jump the
browser absorbs is a jump the user never had, which makes this the more useful
of the two questions; it also means the control has to switch the feature off
or it cannot demonstrate anything.

### commits vs chunks

Each row reports `commits=N/M`: how many times the container's DOM actually
changed against how many chunks were delivered. If N were meaningfully below
M, React would be coalescing deliveries, `streamMs` would be a per-_commit_
cost wearing a per-chunk label, and — because coalescing grows with slowness
— the suite would systematically under-report exactly the large regressions
it exists to catch.

Measured 2026-08-30, and **the answer depends on pacing**, which is why this
is a reported column rather than something checked once:

| cell                        | pacing      | commits/chunks | ratio |
| --------------------------- | ----------- | -------------- | ----: |
| `throughput-code`, all apps | `immediate` | 1250/1251      |  1.00 |
| `anchor-math`, core+mantine | `frame`     | 1417/1540      |  0.92 |

Under `immediate` there is no coalescing even on `react-mantine` at ~14 ms
per chunk — several times React's work slice — so per-chunk arithmetic on the
`throughput-*` cells is sound. Under `frame` pacing roughly 8% of deliveries
land in a frame that already has one pending and get folded in, so per-chunk
numbers on those cells are off by that much.

The first of those two measurements was briefly written up here as a settled
fact about the renderer. It was a fact about one pacing, and it survived
exactly one more scenario.

### The control row

`react-null` runs the same harness over the same scenarios into a `<pre>`.
Its row is the harness floor — string slicing, dispatch, one React commit,
the browser's rendering pipeline — and `throughput-*` is only readable
against it, since a share of those durations is overhead rather than
rendering. It is a control, not a target: optimising toward it would end its
usefulness.

It also closes the worst failure this suite can have. Every timing metric
rewards doing less work, so a renderer that silently rendered nothing would
post the best numbers in the table. The runner now refuses to record a run
with zero rendered nodes, and the self-test asserts the app is above the
control on both node count and time.

`foreignNodes` in each result row is the check — it counts nodes inside the
container carrying known extension markers. Non-zero means the row is dirty.
It should be zero in every runner-produced row; if it is not, something is
injecting into the supposedly clean browser and that is worth chasing before
reading anything else.

## Pacing decides what a scenario can even see

A `timer`-paced scenario delivers on a fixed `tickMs`. It models an arrival
rate — a server dripping tokens — and answers "can the renderer keep up".
On current hardware the answer is trivially yes, and the number it produces
is mostly the schedule restated: `code-dense` is 1251 chunks x 16 ms, so it
takes ~20 s no matter what the renderer does.

Measured 2026-08-30, and it is the sharpest result of building this: the same
scenario took **21.2 s unthrottled and 20.6 s under a 4x CPU throttle**. The
throttle was verified working in the same session (a pure busy-loop went
5 ms → 20 ms → 48 ms at 1x/4x/10x, exactly linear). The scenario simply could
not see it, because the renderer had a whole frame to do very little and
still fit after being slowed fourfold.

A `frame`-paced scenario hands the next chunk over on the next animation
frame. That was the obvious fix and it was not enough: measured on the same
scenario, **10.4 s at 1x and 10.4 s at 4x**. Frame pacing swaps one clock for
another — 1250 chunks at a 120 Hz refresh is 10.4 s whatever the renderer
does, because this renderer finishes a chunk in about a millisecond and still
fits in the 8.3 ms gap after being slowed four times.

An `immediate`-paced scenario waits for nothing: the next chunk is queued on
a MessageChannel port, which yields to the event loop without the 4 ms clamp
that `setTimeout(0)` picks up. `streamMs` is then the renderer's own cost and
nothing else. Same scenario, same machine:

| pacing                |     1x |     4x | ratio | bounded by     |
| --------------------- | -----: | -----: | ----: | -------------- |
| `timer` (16 ms/chunk) | 21.2 s | 20.6 s | 0.97x | its schedule   |
| `frame` (1 chunk/rAF) | 10.4 s | 10.4 s | 1.00x | 120 Hz refresh |
| `immediate` (unpaced) | 0.33 s | 1.46 s | 4.44x | the renderer   |

Read `throughput-*` as a **JS-headroom probe** and `burst-*` as the cell
closer to what a user feels. Neither alone is enough, and the earlier version
of this section overclaimed in a way this suite's own output refutes:
frame-paced `burst-code` separates core from mantine 10.4 s to 18.7 s,
cleanly, because mantine's per-chunk cost is above one refresh interval.

The precise statement is a **dead zone**, not blindness. A regression that
keeps per-chunk cost under one refresh interval — 8.3 ms here, 16.7 ms on a
60 Hz runner — is invisible to `timer` and `frame` pacing. `immediate` has no
dead zone, and pays for it: style, layout and paint run once per rendering
opportunity, so core's `throughput-code` performed 38 of them for 1251 chunks
while mantine's performed 1074. A regression that lives in LAYOUT is
compressed by up to 33x there, and the same content reads 1:52 under
`immediate` against 1:1.8 under `frame`.

The self-test asserts this directly (arm 3): if `immediate` pacing ever
regresses into waiting for something, the 4x ratio collapses toward 1.0 and
the run fails.

## Throttle, or measure your own laptop

`--throttle 4` applies a CPU multiplier through CDP before navigation, so the
app's startup is throttled too.

The default of 1 is honest and nearly useless for comparison. The first
baseline taken on this machine came back with zero long tasks and zero
blocking time in 12 of 14 cells, and every frame p95 within a millisecond of
the display's floor — a renderer could get several times slower and most of
the table would not move. That is a fact about the hardware, not about the
renderer.

Throttling does not simulate a particular device and must not be described as
if it did; what it does is push the work far enough above the frame budget
that the metrics have somewhere to move. The multiplier is recorded in every
row, and `compare.mjs` refuses to compare runs taken at different ones — a 4x
row beside a 1x row differs by the throttle long before it differs by
anything worth reading.

## What this suite structurally cannot see

Not a to-do list — a boundary. Each of these is something a user could
notice and this design, as built, cannot report. Written down because a
benchmark's silence is otherwise indistinguishable from good news.

- **Input during the stream.** Nothing types, clicks or selects text while
  content arrives. "My selection was blown away mid-answer" and "the copy
  button didn't respond" are common complaints about streaming renderers, and
  `longestEventMs` has no events to observe. The biggest hole.
- **Real scrolling during the stream.** The `anchor-*` scenarios cover
  content moving under a stationary reader, which was the larger half. What
  is still missing is wheel/touch scrolling _while_ content arrives —
  compositor-driven scroll, scroll anchoring, and the interaction between the
  two. `scriptedScroll` uses instant `window.scrollTo` in a rAF loop, so no
  compositor scroll happens anywhere in this suite.
- **Staleness.** Nothing measures chunk-arrival to pixels. A renderer that
  batches many chunks before painting and one that paints each chunk can post
  the same `streamMs` and feel completely different.
- **The library's own streaming features.** `smoothStream`,
  `AIMarkdownDocuments` / turn-taking and `streamingCursor` are all off in
  every app. The scenario named `turn-taking` is a single growing string and
  does not exercise the coordinator at all — the name is aspirational.
- **Viewport priority.** One viewport, no on-screen/off-screen split, no
  measurement of work spent on content nobody is looking at. An optimisation
  in that direction cannot be accepted or rejected against this suite as
  built, which is worth knowing since that was part of the motivation.
- **Worker offload.** Its benefit shows up in `longTasks` and
  `totalBlockingMs`, both ~0 in most cells at 1x — so it is only evaluable
  under throttle.
- **Paint and raster cost.** The page never scrolls during the stream and
  most of the document is below the fold.
- **Memory retention.** `heapBytes` is allocation churn (see its field doc),
  and there is no unmount/remount leak scenario.
- **Font loading.** KaTeX ships web fonts; FOUT and the shifts it causes are
  invisible because CLS is ~0 for below-fold growth.
- **Anything non-Chromium.** `performance.memory`, `longtask` and
  `layout-shift` are Chrome-only. On WebKit or Gecko the suite degrades to
  `streamMs` plus frame counts — and says so through nulls rather than
  zeroes, but it does degrade.

## Adding a scenario

Add a row to `SCENARIOS` in `kit/scenarios.ts`. Nothing else needs to change —
the apps expose the list, and the runner reads its work list from the app
rather than keeping a copy, so a new scenario is picked up on the next run.

Content is generated from a seed rather than pasted, so a scenario can be
scaled without hand-editing and two runs are byte-identical. Keep it big
enough to measure: `mermaid-dense` and `math-dense` were originally 1.2 s and
5.2 s of streaming, which is not long enough for steady-state cost to show
over startup noise.
