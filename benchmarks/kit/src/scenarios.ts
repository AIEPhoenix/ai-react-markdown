/**
 * Benchmark scenarios — FRAMEWORK-AGNOSTIC by construction.
 *
 * A scenario is content plus a delivery schedule and nothing else: no React,
 * no component, no import from any renderer. That is what lets the same
 * scenario run under `react-core` and `react-mantine` and be compared, and
 * what will let a future framework adapter join without touching this file.
 *
 * WHY NOT STORYBOOK. The obvious cheap route is to point Playwright at the
 * existing `storybook-static` — 41 stories already build. It was rejected
 * deliberately: Storybook ships its own runtime, router and preview iframe
 * into the page, and every number we would collect (LCP, long tasks, DOM
 * node counts, rAF gaps) counts that runtime too. A benchmark whose baseline
 * includes a harness the user never installs cannot answer "is our renderer
 * fast", only "is our renderer plus Storybook fast", and the two drift apart
 * silently as Storybook upgrades.
 *
 * The apps in this directory are instead the README integration verbatim,
 * with instrumentation added ON TOP rather than around. What we measure is
 * therefore what a user's own bundle does.
 *
 * SCENARIO DESIGN RULES, so later additions stay comparable:
 *  - Content is GENERATED from a seed, never a pasted blob, so a scenario's
 *    size can be scaled without hand-editing and two runs are identical.
 *  - The schedule is expressed in CHARACTERS PER TICK, not in wall-clock
 *    positions, because the thing under test is how the renderer copes with
 *    arrival rate — tying it to real timestamps would measure the harness.
 *  - Every scenario must be reachable by URL (`?scenario=<id>`), because the
 *    runner navigates rather than driving through an API: a fresh document
 *    per scenario is the only way LCP and first-paint numbers mean anything.
 */

export type AfterStream = 'none' | 'scroll';

/**
 * How chunks are paced.
 *
 * `timer` delivers on a fixed `tickMs`, which models an arrival rate: a
 * server dripping tokens. It answers "can the renderer keep up with this
 * rate", and on modern hardware the answer is trivially yes — measured
 * 2026-08-30, `code-dense` at 16 ms/chunk took 21.2 s unthrottled and 20.6 s
 * under a verified 4x CPU throttle, because 1251 x 16 ms IS the schedule and
 * the render work fits in the gap either way. A timer-paced scenario cannot
 * see a renderer get slower until it gets 16 ms/chunk slower.
 *
 * `frame` delivers one chunk per animation frame, so the renderer sets its
 * own pace: slower rendering means fewer frames means a longer stream, and
 * `streamMs` becomes a direct measure of throughput rather than a restatement
 * of the schedule. This is the pacing to use when comparing releases.
 *
 * All three are kept because they answer different questions, and a suite
 * with only the timed ones would look thorough while being unable to detect
 * the regressions it exists for.
 *
 * `immediate` does not wait for anything: the next chunk is queued on a
 * MessageChannel port, which yields to the event loop without the 4 ms clamp
 * `setTimeout(0)` picks up and without waiting for a frame. `streamMs` then
 * measures the renderer's own processing time and nothing else.
 *
 * That third mode exists because the first two both turned out to be bounded
 * by something other than the renderer. Measured 2026-08-30 on `code-dense`,
 * unthrottled vs a verified-working 4x CPU throttle:
 *
 *   timer pacing (16 ms/chunk):  21.2 s → 20.6 s   (bounded by the schedule)
 *   frame pacing (1 chunk/rAF):  10.4 s → 10.4 s   (bounded by 120 Hz refresh)
 *
 * Neither could see a fourfold CPU slowdown, because this renderer finishes a
 * chunk in about a millisecond and still fits in the gap after being slowed
 * four times. That is a good result about the renderer and a bad one about
 * the instrument: a suite whose every scenario is bounded by a clock cannot
 * detect the renderer getting slower until it gets 8 ms/chunk slower.
 */
export type Pacing = 'timer' | 'frame' | 'immediate';

export interface Scenario {
  id: string;
  title: string;
  /** What this scenario is supposed to expose. Printed in the readout. */
  probes: string;
  /** The complete document the stream converges to. */
  content: string;
  /** Characters appended per tick. One entry per tick. */
  chunks: number[];
  /** Delay between ticks, ms. Ignored when `pacing` is `frame`. */
  tickMs: number;
  pacing: Pacing;
  /** Scripted interaction once the stream has drained. */
  after: AfterStream;
}

/** Deterministic PRNG — scenarios must be byte-identical between runs, and
 *  `Math.random()` would make every baseline incomparable to the last. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const WORDS =
  'stream render markdown parser boundary incremental splice frozen prefix tail token grammar node element attribute document viewport layout paint'.split(
    ' '
  );

function prose(rand: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    const w = WORDS[Math.floor(rand() * WORDS.length)];
    out.push(i % 17 === 16 ? `${w}.` : w);
  }
  return `${out.join(' ')}\n`;
}

/** Even chunking, expressed in characters. The tail chunk absorbs the
 *  remainder so the schedule always sums to the content length — a schedule
 *  that under-delivers would leave the renderer mid-stream and every
 *  post-stream metric would silently describe a different state. */
function evenChunks(total: number, size: number): number[] {
  const n = Math.max(1, Math.ceil(total / size));
  const out = new Array<number>(n).fill(size);
  out[n - 1] = total - size * (n - 1);
  return out;
}

function longProse(): string {
  const rand = rng(1);
  let doc = '# Streaming a long answer\n\n';
  for (let i = 0; i < 40; i++) {
    doc += `## Section ${i + 1}\n\n${prose(rand, 90)}\n`;
    if (i % 4 === 3) doc += `> ${prose(rand, 24)}\n`;
    if (i % 5 === 4) doc += `- ${prose(rand, 8)}- ${prose(rand, 8)}- ${prose(rand, 8)}\n`;
  }
  return doc;
}

function codeDense(): string {
  const rand = rng(2);
  let doc = '# Code-dense answer\n\n';
  for (let i = 0; i < 24; i++) {
    doc += `${prose(rand, 30)}\n\`\`\`ts\n`;
    for (let l = 0; l < 18; l++) {
      doc += `export const f${i}_${l} = (x: number): number => x * ${l} + ${i};\n`;
    }
    doc += '```\n\n';
  }
  return doc;
}

function mermaidDense(): string {
  let doc = '# Diagram-dense answer\n\n';
  for (let i = 0; i < 40; i++) {
    doc += `Diagram ${i + 1}.\n\n\`\`\`mermaid\nflowchart TD\n`;
    for (let n = 0; n < 10; n++) doc += `  A${i}_${n}[Step ${n} of diagram ${i}] --> A${i}_${n + 1}[Step ${n + 1}]\n`;
    doc += '```\n\n';
  }
  return doc;
}

function mathDense(): string {
  const rand = rng(3);
  let doc = '# Math-dense answer\n\n';
  for (let i = 0; i < 90; i++) {
    doc += `${prose(rand, 46)}\n$$\n\\sum_{k=0}^{${i}} \\frac{x^k}{k!} = e^x + O(x^{${i + 1}})\n$$\n\n`;
  }
  return doc;
}

function turnTaking(): string {
  const rand = rng(4);
  let doc = '';
  for (let i = 0; i < 30; i++) {
    doc += `### Turn ${i + 1}\n\n${prose(rand, 45)}\n`;
    if (i % 3 === 2) doc += `\`\`\`js\nconst turn${i} = ${i};\n\`\`\`\n\n`;
  }
  return doc;
}

const LONG = longProse();
const CODE = codeDense();
const MERMAID = mermaidDense();
const MATH = mathDense();
const TURNS = turnTaking();

/**
 * The scenario set. Add rows here, not in the apps — an app that knows a
 * scenario by name has already broken the framework/scenario split this
 * directory exists to keep.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'stream-long',
    title: 'Long answer, token-sized chunks',
    probes: 'steady-state streaming cost; whether per-chunk work grows with document length',
    content: LONG,
    chunks: evenChunks(LONG.length, 24),
    tickMs: 16,
    pacing: 'timer',
    after: 'none',
  },
  {
    id: 'stream-long-scroll',
    title: 'Long answer, then scripted scroll',
    probes: 'scroll smoothness and position drift on a document the renderer just built',
    content: LONG,
    chunks: evenChunks(LONG.length, 24),
    tickMs: 16,
    pacing: 'timer',
    after: 'scroll',
  },
  {
    id: 'code-dense',
    title: 'Code-block dense answer',
    probes: 'synchronous highlighting on the main thread; long tasks per fence',
    content: CODE,
    chunks: evenChunks(CODE.length, 24),
    tickMs: 16,
    pacing: 'timer',
    after: 'none',
  },
  {
    id: 'mermaid-dense',
    title: 'Diagram-dense answer',
    probes: 'diagram rendering cost and layout thrash while streaming',
    content: MERMAID,
    chunks: evenChunks(MERMAID.length, 24),
    tickMs: 16,
    pacing: 'timer',
    after: 'none',
  },
  {
    id: 'math-dense',
    title: 'Math-dense answer',
    probes: 'KaTeX cost per block and re-render churn on an open display block',
    content: MATH,
    chunks: evenChunks(MATH.length, 24),
    tickMs: 16,
    pacing: 'timer',
    after: 'none',
  },
  {
    id: 'turn-taking',
    title: 'Many short turns',
    probes: 'DOM growth across a long conversation; cost of a settled prefix',
    content: TURNS,
    chunks: evenChunks(TURNS.length, 24),
    tickMs: 16,
    pacing: 'timer',
    after: 'none',
  },
  // Frame-paced counterparts. Same content, renderer-paced delivery, so
  // `streamMs` measures throughput instead of restating the tick schedule.
  {
    id: 'burst-long',
    title: 'Long answer, renderer-paced',
    probes: 'streaming throughput — how fast the renderer can actually absorb tokens',
    content: LONG,
    chunks: evenChunks(LONG.length, 24),
    tickMs: 0,
    pacing: 'frame',
    after: 'none',
  },
  {
    id: 'burst-code',
    title: 'Code-dense answer, renderer-paced',
    probes: 'highlighting throughput; the cost a highlighter adds per frame',
    content: CODE,
    chunks: evenChunks(CODE.length, 24),
    tickMs: 0,
    pacing: 'frame',
    after: 'none',
  },
  {
    id: 'burst-math',
    title: 'Math-dense answer, renderer-paced',
    probes: 'KaTeX throughput and re-render churn without a timer to hide behind',
    content: MATH,
    chunks: evenChunks(MATH.length, 24),
    tickMs: 0,
    pacing: 'frame',
    after: 'none',
  },
  // Throughput scenarios: delivery waits for nothing, so `streamMs` is the
  // renderer's own cost. These are the cells a release comparison should
  // read first — the timed ones above cannot see a slowdown smaller than
  // their own pacing gap.
  {
    id: 'throughput-long',
    title: 'Long answer, unpaced',
    probes: 'raw incremental-parse + render cost per token, with no clock to hide behind',
    content: LONG,
    chunks: evenChunks(LONG.length, 24),
    tickMs: 0,
    pacing: 'immediate',
    after: 'none',
  },
  {
    id: 'throughput-code',
    title: 'Code-dense answer, unpaced',
    probes: 'what a highlighter actually costs per chunk',
    content: CODE,
    chunks: evenChunks(CODE.length, 24),
    tickMs: 0,
    pacing: 'immediate',
    after: 'none',
  },
  {
    id: 'throughput-math',
    title: 'Math-dense answer, unpaced',
    probes: 'KaTeX cost per block, unmasked by pacing',
    content: MATH,
    chunks: evenChunks(MATH.length, 24),
    tickMs: 0,
    pacing: 'immediate',
    after: 'none',
  },
  {
    id: 'restore-large',
    title: 'Large document delivered whole',
    probes: 'cold restore — the non-streaming path a page reload takes',
    content: LONG,
    chunks: [LONG.length],
    tickMs: 0,
    pacing: 'timer',
    after: 'none',
  },
];

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);
