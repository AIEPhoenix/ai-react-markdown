/**
 * EXPERIMENT — falsification + measurement suite for the prefix-freeze
 * boundary detector. See detectFreezeBoundaries.ts for tier definitions.
 *
 * Two suites:
 *
 * 1. "falsification" — adversarial payloads where specific tiers are
 *    EXPECTED to fail the stability check. A tier "violating" here is the
 *    experiment working: it demonstrates empirically which imported rules
 *    (L0/L1 from x-markdown-mini) are unsafe under our CommonMark/unified
 *    pipeline, and that each added blocker (L2/L3/L4) closes its intended
 *    hazard class. The headline invariant is that L4 NEVER violates.
 *
 * 2. "measurement" — realistic streaming corpora (the Storybook benchmark
 *    payloads + a CJK fixture) reporting freeze coverage per tier and the
 *    full-vs-tail pipeline cost, printed as tables. Assertions here are
 *    invariants only (monotonicity, tier ordering, L4 safety) — the numbers
 *    themselves are informational.
 */

import { describe, expect, test } from 'vitest';

import { DEFAULT_PAYLOAD, withDefs } from '../../../stories/streaming/scenarios';
import { FREEZE_TIERS, type FreezeTier } from './detectFreezeBoundaries';
import { simulateStream, type SimulationReport } from './pipelineHarness';

/** Tiers expected to record at least one stability violation vs. tiers expected clean. */
function expectOutcomes(sim: SimulationReport, expected: { violated: FreezeTier[]; clean: FreezeTier[] }): void {
  const observed = Object.fromEntries(
    FREEZE_TIERS.map((tier) => [tier, sim.tiers[tier].violationFrames > 0 ? 'violated' : 'clean'])
  );
  const wanted = Object.fromEntries([
    ...expected.violated.map((tier) => [tier, 'violated']),
    ...expected.clean.map((tier) => [tier, 'clean']),
  ]);
  expect(observed, `fixture=${sim.name}`).toEqual(wanted);
}

function expectInvariants(sim: SimulationReport): void {
  for (const tier of FREEZE_TIERS) {
    expect(sim.tiers[tier].monotonic, `${sim.name}: ${tier} boundary must be monotonic`).toBe(true);
    expect(sim.tiers[tier].meanFreezeRatio).toBeGreaterThanOrEqual(0);
    expect(sim.tiers[tier].meanFreezeRatio).toBeLessThanOrEqual(1);
  }
  // Stricter predicates over the same candidate set can only move backward.
  expect(sim.tiers.L2.finalBoundary).toBeLessThanOrEqual(sim.tiers.L1.finalBoundary);
  expect(sim.tiers.L1.finalBoundary).toBeLessThanOrEqual(sim.tiers.L0.finalBoundary);
  expect(sim.tiers.L4.finalBoundary).toBeLessThanOrEqual(sim.tiers.L3.finalBoundary);
  // The candidate production rule must never freeze unstable output.
  expect(sim.tiers.L4.violationFrames, `${sim.name}: L4 must be violation-free`).toBe(0);
}

// --- adversarial payloads -------------------------------------------------
// Blocks joined with '\n\n\n' (= two blank lines) so the double-blank tiers
// (L1/L2) produce candidates at all; typical single-blank LLM output would
// leave them with boundary 0 and prove nothing.

const PROSE = [
  '# Heading one',
  'A paragraph of plain prose that keeps going for a while.',
  'Another paragraph with **bold** and _emphasis_ inline.',
  '> A blockquote line, safely terminated by the blank below.',
  '```ts\nconst x = 1;\nconst y = 2;\n```',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  'Closing paragraph of plain prose.',
].join('\n\n\n');

/** CommonMark lists are not terminated by blank lines — later indented lines
 *  extend the SAME list node across any blank run. */
const LOOSE_LIST = [
  '- alpha item',
  '  beta paragraph continuing the SAME item across two blank lines',
  '- gamma, a NEW item joining the same list node',
  'A column-zero paragraph that finally terminates the list.',
  'Trailing paragraph so candidates exist after termination.',
].join('\n\n\n');

/** The v1.5.1 hazard class (commit a8e89ec): an unclosed raw-HTML container
 *  makes rehype-raw reparent every later top-level sibling into it. */
const DETAILS_SWALLOW = [
  '<details>',
  '<summary>swallow test</summary>',
  'paragraph one that gets swallowed into the container',
  'paragraph two, also swallowed',
  'paragraph three, still swallowed',
].join('\n\n\n');

/** micromark resolves reference-ness at parse time: the definition arriving
 *  at the end retargets the paragraph rendered literal in earlier frames. */
const LATE_REF_DEF = [
  'See [the spec][spec] for all of the details.',
  'Filler paragraph one.',
  'Filler paragraph two.',
  'Filler paragraph three.',
  '[spec]: https://spec.commonmark.org',
].join('\n\n\n');

const LATE_FOOTNOTE_DEF = [
  'An early claim[^n] whose marker only materializes at the end.',
  'Filler paragraph one.',
  'Filler paragraph two.',
  '[^n]: the footnote definition body',
].join('\n\n\n');

/** Setext underlines cannot cross a blank line — this is why blank-line
 *  boundaries are immune to heading retro-promotion in the first place. */
const SETEXT_ACROSS_BLANK = 'A would-be setext title\n\n===\n\nA following paragraph.\n';

/** `$$` flow math swallows blank lines until its closing delimiter; the
 *  math-blind tiers (L0/L1) treat those blanks as freeze candidates. */
const MATH_SWALLOW = 'Intro paragraph.\n\n\n$$\na = 1\n\n\nb = 2\n$$\n\n\nAfter the math block.\n';

describe('prefix-freeze falsification', () => {
  test('plain prose: every tier is stable', () => {
    const sim = simulateStream('prose', PROSE, 16);
    expectInvariants(sim);
    expectOutcomes(sim, { violated: [], clean: ['L0', 'L1', 'L2', 'L3', 'L4'] });
  });

  test('loose list: blank-line rules freeze a still-growing list node', () => {
    const sim = simulateStream('loose-list', LOOSE_LIST, 12);
    expectInvariants(sim);
    expectOutcomes(sim, { violated: ['L0', 'L1', 'L2'], clean: ['L3', 'L4'] });
  });

  test('unclosed <details>: rehype-raw swallow defeats text-level stability', () => {
    const sim = simulateStream('details-swallow', DETAILS_SWALLOW, 12);
    expectInvariants(sim);
    expectOutcomes(sim, { violated: ['L0', 'L1'], clean: ['L2', 'L3', 'L4'] });
  });

  test('late reference definition retargets an earlier paragraph', () => {
    const sim = simulateStream('late-ref-def', LATE_REF_DEF, 12);
    expectInvariants(sim);
    expectOutcomes(sim, { violated: ['L0', 'L1', 'L2', 'L3'], clean: ['L4'] });
  });

  test('late footnote definition materializes an earlier marker', () => {
    const sim = simulateStream('late-footnote-def', LATE_FOOTNOTE_DEF, 12);
    expectInvariants(sim);
    expectOutcomes(sim, { violated: ['L0', 'L1', 'L2', 'L3'], clean: ['L4'] });
  });

  test('setext underline cannot cross a blank line (documented immunity)', () => {
    const sim = simulateStream('setext-across-blank', SETEXT_ACROSS_BLANK, 6);
    expectInvariants(sim);
    expectOutcomes(sim, { violated: [], clean: ['L0', 'L1', 'L2', 'L3', 'L4'] });
  });

  test('unclosed $$ math swallows blank lines past math-blind boundaries', () => {
    const sim = simulateStream('math-swallow', MATH_SWALLOW, 8);
    expectInvariants(sim);
    expectOutcomes(sim, { violated: ['L0', 'L1'], clean: ['L2', 'L3', 'L4'] });
  });
});

// --- measurement corpus ---------------------------------------------------

const CJK_MIXED = [
  '# 流式渲染实验语料',
  '这是一段中文散文,用来验证 CJK 内容下的冻结覆盖率。行内有 **加粗**、`代码` 与 _强调_,以及一个[行内链接](https://example.com)。',
  '> 引用块:已完成的内容不应再承担任何额外开销。',
  '$$\ne^{i\\pi} + 1 = 0\n$$',
  '接下来是一个表格:\n\n| 方案 | 复杂度 |\n| --- | --- |\n| 全量重解析 | O(N²) |\n| 前缀冻结 | O(N) |',
  '最后一段中文散文收尾,确保文档以普通段落结束。',
].join('\n\n');

describe('prefix-freeze measurement', () => {
  const CORPUS: Array<[name: string, payload: string, chunkSize: number]> = [
    ['llm-typical', DEFAULT_PAYLOAD, 32],
    ['llm-typical-with-defs', withDefs(DEFAULT_PAYLOAD), 32],
    ['llm-typical-3x', DEFAULT_PAYLOAD.repeat(3), 64],
    ['double-blank-variant', DEFAULT_PAYLOAD.replaceAll('\n\n', '\n\n\n'), 32],
    ['cjk-mixed', CJK_MIXED, 24],
  ];

  test('corpus report: coverage per tier + full-vs-tail pipeline cost', () => {
    const coverageRows: Array<Record<string, string | number>> = [];
    const costRows: Array<Record<string, string | number>> = [];

    for (const [name, payload, chunkSize] of CORPUS) {
      const sim = simulateStream(name, payload, chunkSize);
      expectInvariants(sim);

      for (const tier of FREEZE_TIERS) {
        const report = sim.tiers[tier];
        coverageRows.push({
          fixture: name,
          tier,
          'final freeze %': Math.round((report.finalBoundary / sim.finalLength) * 100),
          'mean freeze %': Math.round(report.meanFreezeRatio * 100),
          'violation frames': report.violationFrames,
        });
      }
      costRows.push({
        fixture: name,
        frames: sim.frames,
        chars: sim.finalLength,
        'full pipeline ms': Math.round(sim.fullPipelineMs),
        'L4 tail-only ms': Math.round(sim.l4TailPipelineMs),
        'saving %': Math.round((1 - sim.l4TailPipelineMs / sim.fullPipelineMs) * 100),
      });
    }

     
    console.table(coverageRows);
     
    console.table(costRows);
  }, 120_000);
});
