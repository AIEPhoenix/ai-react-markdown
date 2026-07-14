/**
 * THE ARBITER — splice-equivalence falsification for incremental parsing.
 *
 * Contract under test: for every streaming frame, the `{mdast, hast}` that
 * `advanceIncrementalParse` returns (spliced or not) is DEEP-EQUAL —
 * positions included — to a fresh full-pipeline run over the same snapshot.
 * This is the property production wiring relies on; a failure here is a
 * shipping bug, not a flaky test. Phase 1 does not land unless this suite
 * is green (plan gate).
 *
 * Coverage axes:
 * - plugin permutations from testPluginCatalog (incl. defaults-all-on — the
 *   original experiment's evidence gap, H2);
 * - realistic corpora (the Storybook benchmark payloads) at two chunk sizes;
 * - adversarial fixtures targeting each design-review hole: H1 reach-back
 *   retarget, H3 definition-list claim, H4 unclosed-fence tail with prefix
 *   defs, H5 root seam, H8 case-fold labels + multi-line def titles, plus
 *   loose lists, comment spans, non-append rewrites, `[^` arriving
 *   mid-stream, and CRLF line endings.
 */

import { describe, expect, test } from 'vitest';
import isEqual from 'lodash-es/isEqual';

import { DEFAULT_PAYLOAD, withDefs } from '../../../stories/streaming/scenarios';
import { parseStage, transformStage } from '../markdown';
import { advanceIncrementalParse, type IncrementalParseState } from './advanceIncrementalParse';
import { buildAdvanceOptions, CATALOG, type CatalogConfig } from './testPluginCatalog';
import { codePointSnapshots as chunkSnapshots } from './codePointSnapshots';

function runFull(content: string, config: CatalogConfig): { mdast: unknown; hast: unknown } {
  const options = buildAdvanceOptions(config);
  const parsed = parseStage({
    children: content,
    remarkPlugins: options.remarkPlugins,
    rehypePlugins: options.rehypePlugins,
    remarkRehypeOptions: options.remarkRehypeOptions,
  });
  const hast = transformStage(parsed);
  return { mdast: parsed.mdast, hast };
}

/** Locate the first differing top-level child for a debuggable message. */
function diffLocation(actual: { children: unknown[] }, expected: { children: unknown[] }): string {
  const max = Math.max(actual.children.length, expected.children.length);
  for (let i = 0; i < max; i++) {
    if (!isEqual(actual.children[i], expected.children[i])) {
      return `first differing top-level child index=${i} actual=${JSON.stringify(actual.children[i])?.slice(0, 300)} expected=${JSON.stringify(expected.children[i])?.slice(0, 300)}`;
    }
  }
  return 'roots differ outside children (position/data)';
}

interface StreamStats {
  frames: number;
  incrementalFrames: number;
}

/**
 * Chain the state machine across snapshots, asserting per-frame equivalence
 * against a fresh full parse. Returns how often the incremental path ran so
 * fixtures can assert they exercised what they claim to exercise.
 */
function assertStreamEquivalence(name: string, snapshots: string[], config: CatalogConfig): StreamStats {
  const options = buildAdvanceOptions(config);
  let state: IncrementalParseState | null = null;
  let incrementalFrames = 0;

  snapshots.forEach((snapshot, frame) => {
    const result = advanceIncrementalParse(state, snapshot, options);
    state = result.nextState;
    if (result.usedIncremental) incrementalFrames += 1;

    const expected = runFull(snapshot, config);
    const label = `${name} [${config.label}] frame=${frame} len=${snapshot.length} boundary=${result.boundary} incremental=${result.usedIncremental}`;
    if (!isEqual(result.hast, expected.hast)) {
      expect.fail(`${label} — hast mismatch: ${diffLocation(result.hast, expected.hast as never)}`);
    }
    if (!isEqual(result.mdast, expected.mdast)) {
      expect.fail(`${label} — mdast mismatch: ${diffLocation(result.mdast, expected.mdast as never)}`);
    }
  });

  return { frames: snapshots.length, incrementalFrames };
}

// --- realistic corpora ------------------------------------------------------

describe('splice equivalence — corpora × plugin catalog', () => {
  for (const config of CATALOG) {
    test(`llm-typical [${config.label}]`, () => {
      const stats = assertStreamEquivalence('llm-typical', chunkSnapshots(DEFAULT_PAYLOAD, 17), config);
      // The corpus must actually exercise the splice, not just fall back.
      expect(stats.incrementalFrames).toBeGreaterThan(stats.frames / 2);
    });

    test(`llm-typical-with-defs [${config.label}]`, () => {
      // withDefs appends footnote refs/defs — v2 splices straight through
      // them (injection replay); the old `[^` bypass would cap this at the
      // pre-footnote frame count.
      const stats = assertStreamEquivalence('with-defs', chunkSnapshots(withDefs(DEFAULT_PAYLOAD), 64), config);
      expect(stats.incrementalFrames).toBeGreaterThan(stats.frames / 2);
    });
  }

  test('cjk-mixed [defaults-all-on]', () => {
    const payload = [
      '# 流式渲染语料',
      '这是一段中文散文,行内有 **加粗**、`代码`,以及一个[行内链接](https://example.com)。',
      '> 引用块:已完成的内容不应再承担任何额外开销。',
      '$$\ne^{i\\pi} + 1 = 0\n$$',
      '| 方案 | 复杂度 |\n| --- | --- |\n| 全量重解析 | O(N²) |\n| 前缀冻结 | O(N) |',
      '最后一段收尾。',
    ].join('\n\n');
    const stats = assertStreamEquivalence('cjk-mixed', chunkSnapshots(payload, 13), CATALOG[1]);
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });
});

// --- adversarial fixtures ----------------------------------------------------

describe('splice equivalence — adversarial fixtures', () => {
  const ALL_ON = CATALOG[1];
  const BASELINE = CATALOG[0];

  test('H1 reach-back: shortcut ref resolved by a late definition', () => {
    // The ref parses as literal text until the def arrives; the boundary
    // must not jump past prev's literal-rendered paragraph the moment the
    // def settles. min(fresh, prev.stableBoundary) is the fix under test.
    const payload =
      'See [spec] for the details.\n\nfiller one.\n\nfiller two.\n\n[spec]: https://spec.commonmark.org\n\ntrailing paragraph.\n';
    for (const config of [BASELINE, ALL_ON]) {
      assertStreamEquivalence('h1-reach-back', chunkSnapshots(payload, 9), config);
    }
  });

  test('H3 definition-list: `: desc` claims a term across one blank line', () => {
    const payload = 'Term\n\n:   the description body\n\ncolumn zero paragraph.\n\ntrailing.\n';
    assertStreamEquivalence('h3-deflist-claim', chunkSnapshots(payload, 7), ALL_ON);
  });

  test('H4 prefix defs + tail ending inside an unclosed fence', () => {
    // Injection must be PREPENDED: an appended def would be swallowed by the
    // open fence and change the tail's code node.
    const payload =
      '[a]: https://example.com/a\n\nSee [text][a] resolved early.\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\ndone.\n';
    for (const config of [BASELINE, ALL_ON]) {
      const stats = assertStreamEquivalence('h4-unclosed-fence-tail', chunkSnapshots(payload, 8), config);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
    }
  });

  test('H4 variant: unclosed $$ math at the tail', () => {
    const payload = '[a]: https://example.com\n\nuse [link][a] here.\n\n$$\na = 1\nb = 2\n$$\n\nafter.\n';
    assertStreamEquivalence('h4-unclosed-math-tail', chunkSnapshots(payload, 8), BASELINE);
  });

  test('H5 seam: comments removed near the boundary (remove-comments on)', () => {
    const payload = 'para one.\n\n<!-- a removed comment -->\n\npara two.\n\npara three.\n';
    assertStreamEquivalence('h5-seam-comment', chunkSnapshots(payload, 6), ALL_ON);
  });

  test('H8 case-fold labels: ref [ß] resolved by def [SS]', () => {
    const payload = 'weight [ß] here.\n\n[SS]: https://example.com\n\ntail paragraph.\n';
    assertStreamEquivalence('h8-case-fold', chunkSnapshots(payload, 6), BASELINE);
  });

  test('H8 multi-line definition title', () => {
    const payload =
      '[a]: https://example.com "a title\nspanning two lines"\n\nuse [text][a] later.\n\nmore prose here.\n\nend.\n';
    assertStreamEquivalence('h8-multiline-title', chunkSnapshots(payload, 7), BASELINE);
  });

  test('loose list extended across blank lines', () => {
    const payload = '- alpha\n\n  beta continues the item\n\n- gamma\n\ncol zero closes.\n\ntail.\n';
    assertStreamEquivalence('loose-list', chunkSnapshots(payload, 6), BASELINE);
  });

  test('review-confirmed detector corners A1-A6 (2026-07-15)', () => {
    // Each of these once produced real splice/full divergence (probe
    // MISMATCH) before its blocker landed; see the review record in the
    // engine memory. A6's `<?…?>` becomes a parse5 bogus comment that
    // sanitize strips — since the stripped-node alignment landed (v2 Phase
    // B) the engine SPLICES across it; the dedicated stripped-node suite
    // below asserts the splice actually engages.
    const corners: Array<[string, string, number]> = [
      ['A1-indented-code-merge', '    a\n\n    b\n\ncol zero\n\ntail.\n', 3],
      ['A2-def-on-continuation-line', '[a]\n\npara\n[a]: /x\n\nmore\n\n[a]: /y\n\nz [a]\n', 4],
      ['A3-blockquote-nested-def', '> [a]: /url\n\ntext\n\n[a]\n\nafter.\n', 4],
      ['A4-midline-math-close', '$$\na $$\nb\n$$\n\nafter math.\n', 3],
      ['A5-fence-info-backtick', '```a``` b\n<div>\nc\n</div>\n\nafter.\n', 4],
      ['A6-html-type3-pi', '<?data\n\nmore\n?>\n\nafter.\n', 3],
    ];
    for (const [name, payload, chunk] of corners) {
      for (const config of [BASELINE, ALL_ON]) {
        assertStreamEquivalence(name, chunkSnapshots(payload, chunk), config);
      }
    }
  });

  test('code-span masking corners: intra-line spans splice, cross-line spans over-block', () => {
    // Intra-line `<div>`/`[x]` inside spans must not disengage splicing —
    // and cross-line spans (unpaired run carrying into the next line) must
    // fall back to raw scanning without ever unmasking real markup.
    const payloads = [
      'use `<div>` and `[x]` inline\n\npara two.\n\ntail.\n',
      'a `x\n<div> y` b\n\nfiller one.\n\ntail.\n',
      'mixed `code` and <em>real</em> tags\n\nafter.\n\nend.\n',
    ];
    for (const payload of payloads) {
      for (const config of [BASELINE, ALL_ON]) {
        assertStreamEquivalence('code-span-mask', chunkSnapshots(payload, 5), config);
      }
    }
  });

  test('multi-line open tag (line-truncated `<div`) swallow class', () => {
    // `<div` + EOL opens an html block whose tag completes on the NEXT line;
    // the single-line tag scan used to miss it (6 mismatching frames before
    // the TRUNCATED_TAG_RE blocker).
    const payload = 'intro paragraph.\n\n<div\n  class="x">\n\nswallowed one.\n\nswallowed two.\n\ntail.\n';
    for (const config of [BASELINE, ALL_ON]) {
      assertStreamEquivalence('multiline-open-tag', chunkSnapshots(payload, 6), config);
    }
    // Variant: attributes continue past the first line.
    const attrs = 'intro.\n\n<div class="a"\n  data-x="y">\n\ninside.\n\nafter.\n';
    assertStreamEquivalence('multiline-attrs-tag', chunkSnapshots(attrs, 6), BASELINE);
  });

  test('unclosed <details> then closed (rehype-raw swallow class)', () => {
    const payload = '<details>\n<summary>t</summary>\n\ninside paragraph\n\n</details>\n\nafter paragraph.\n\ntail.\n';
    for (const config of [BASELINE, ALL_ON]) {
      assertStreamEquivalence('details-swallow', chunkSnapshots(payload, 7), config);
    }
  });

  test('non-append rewrite mid-stream falls back and stays equivalent', () => {
    const grown = chunkSnapshots('alpha paragraph.\n\nbeta paragraph.\n\ngamma paragraph.\n', 9);
    // Splice in a rewritten snapshot (simulates a Stage-A preprocessor
    // rewriting earlier content), then continue appending to the rewrite.
    const rewritten = grown[grown.length - 1].replace('alpha', 'ALPHA');
    const snapshots = [...grown, rewritten, `${rewritten}\nappended tail.\n`];
    assertStreamEquivalence('non-append', snapshots, BASELINE);
  });

  test('[^ arriving mid-stream keeps splicing (v2 replay)', () => {
    const payload = 'plain paragraph one.\n\nplain paragraph two.\n\na claim[^n] appears.\n\n[^n]: footnote body\n';
    for (const config of [BASELINE, ALL_ON]) {
      const stats = assertStreamEquivalence('footnote-mid-stream', chunkSnapshots(payload, 8), config);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
    }
  });

  test('CRLF line endings', () => {
    const payload =
      'para one.\r\n\r\npara two with **bold**.\r\n\r\n- item\r\n- item two\r\n\r\ncol zero.\r\n\r\ntail.\r\n';
    assertStreamEquivalence('crlf', chunkSnapshots(payload, 9), BASELINE);
  });

  test('duplicate label: prefix def wins over a later tail def (first-def-wins)', () => {
    const payload =
      '[a]: https://first.example\n\nuse [text][a] here.\n\nfiller paragraph.\n\n[a]: https://second.example\n\ntail.\n';
    assertStreamEquivalence('dup-label', chunkSnapshots(payload, 8), BASELINE);
  });
});

// --- stripped-node prefixes (v2 Phase B) -------------------------------------
//
// Sanitize-stripped nodes (HTML comments, `<?…?>` bogus comments, <script>)
// leave orphan wrap separators in the hast. The alignment cursor in
// spliceParse must keep splicing across them — before Phase B every one of
// these payloads silently degraded to per-frame full parses. BASELINE is the
// config under test (no remove-comments: the comments reach sanitize as hast
// nodes); the assertions demand the splice ENGAGED, not just equivalence.

describe('splice equivalence — stripped-node prefixes', () => {
  const BASELINE = CATALOG[0];
  const ALL_ON = CATALOG[1];

  const spliceFixtures: Array<[string, string, number]> = [
    ['comment-mid-prefix', 'para one.\n\n<!-- gone -->\n\npara two.\n\npara three.\n\ntail paragraph.\n', 7],
    ['comment-at-seam', 'para one.\n\npara two.\n\n<!-- seam adjacent -->\n\ntail paragraph follows here.\n', 7],
    ['consecutive-comments', 'para one.\n\n<!-- x -->\n\n<!-- y -->\n\npara two.\n\nmore prose to stream after.\n', 7],
    ['comment-first-child', '<!-- lead -->\n\npara one.\n\npara two.\n\ntail paragraph to stream.\n', 6],
    ['comment-last-child', 'para one.\n\npara two.\n\nlong tail paragraph here.\n\n<!-- trailing -->', 7],
    ['pi-mid-prefix', 'para one.\n\n<?php echo 1; ?>\n\npara two.\n\ntail paragraph to stream.\n', 7],
    ['script-stripped', 'para one.\n\n<script>x()</script>\n\npara two.\n\ntail paragraph to stream.\n', 7],
    [
      'comment-before-table',
      'para one.\n\n<!-- x -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntail paragraph to stream.\n',
      9,
    ],
    [
      'multi-element-html-block',
      'para one.\n\n<div>a</div><div>b</div>\n\npara two.\n\ntail paragraph to stream.\n',
      8,
    ],
    ['defs-only-tail-after-comment', 'para one.\n\n<!-- x -->\n\npara two.\n\n[a]: https://example.com\n', 7],
  ];

  for (const [name, payload, chunk] of spliceFixtures) {
    test(name, () => {
      const stats = assertStreamEquivalence(name, chunkSnapshots(payload, chunk), BASELINE);
      expect(stats.incrementalFrames, `${name} must actually splice, not fall back`).toBeGreaterThan(0);
    });
  }

  test('comment leading the tail must NOT merge into the seam separator', () => {
    // Full parse keeps seam '\n' and the comment's gap slot as SEPARATE text
    // nodes (the comment sat between them at reparse time); hoist text from
    // a table merges. Both shapes in one payload.
    const payload = 'para one.\n\npara two.\n\n<!-- tail leads -->\n\n| a |\n| - |\n| 1 |\n\nclosing paragraph.\n';
    for (const config of [BASELINE, ALL_ON]) {
      const stats = assertStreamEquivalence('comment-leading-tail', chunkSnapshots(payload, 6), config);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
    }
  });

  test('A6 PI corner now splices (was: stripped-node fallback)', () => {
    const stats = assertStreamEquivalence(
      'a6-pi-splices',
      chunkSnapshots('<?data\n\nmore\n?>\n\nafter.\n', 3),
      BASELINE
    );
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });

  test('splices on a frame whose FROZEN PREFIX contains the stripped node', () => {
    // `incrementalFrames > 0` alone could be satisfied by frames before the
    // comment enters the prefix — this pins the alignment cursor itself:
    // stream far enough that the boundary passes the comment, then assert
    // the last append frame both spliced AND crossed it.
    const payload =
      'para one.\n\n<!-- gone -->\n\npara two.\n\npara three.\n\npara four extends the document.\n\nfinal tail paragraph.\n';
    const options = buildAdvanceOptions(BASELINE);
    const snapshots = chunkSnapshots(payload, 9);
    let state: IncrementalParseState | null = null;
    let last: ReturnType<typeof advanceIncrementalParse> | null = null;
    for (const snapshot of snapshots) {
      last = advanceIncrementalParse(state, snapshot, options);
      state = last.nextState;
    }
    expect(last!.usedIncremental).toBe(true);
    expect(last!.boundary).toBeGreaterThan(payload.indexOf('-->') + 3);
  });
});

// --- footnotes via injection replay (v2 Phase C) ------------------------------
//
// mdast-util-to-hast footnote state (footnoteOrder / footnoteCounts /
// footnoteById) is whole-document and encounter-ordered; the engine replays
// the prefix's event sequence at the tail head so the tail run regenerates
// the complete footer and the tail's inline refs continue the numbering.
// Every fixture runs the full catalog cross-product it names and asserts the
// splice ENGAGED — before Phase C every `[^` payload silently degraded to
// per-frame full parses. `settle` gives each payload a confirmed non-
// continuation block after the defs so the boundary can pass them.

describe('splice equivalence — footnote injection replay', () => {
  const BASELINE = CATALOG[0];
  const ALL_ON = CATALOG[1];
  const NO_ORPHAN = CATALOG.find((c) => c.label === 'no-orphan')!;

  const fixtures: Array<[string, string, number, CatalogConfig[]]> = [
    [
      'reuse-and-backrefs',
      'Alpha[^a] beta[^a].\n\nGamma[^b].\n\n[^a]: A body\n\n[^b]: B body\n\nplain settles.\n\ntail re-ref [^a] and new [^c].\n\n[^c]: C body\n\nclosing paragraph here.\n',
      11,
      [BASELINE, ALL_ON, NO_ORPHAN],
    ],
    [
      'orphan-def-ordering',
      'Intro[^a].\n\n[^orph]: orphan body\n\n[^a]: A body\n\nMid[^b].\n\n[^b]: B body\n\nplain settles.\n\ntail new [^c].\n\n[^c]: C body\n',
      9,
      [BASELINE, NO_ORPHAN],
    ],
    [
      'def-before-ref',
      '[^a]: defined first\n\nThen referenced[^a] later.\n\nfiller paragraph.\n\ntail paragraph extends.\n',
      8,
      [BASELINE, ALL_ON],
    ],
    [
      'ref-def-ref-interleave',
      'One[^x].\n\n[^x]: x body\n\nTwo[^y] then[^x].\n\n[^y]: y body\n\nplain settles here.\n\ntail closes[^y] again.\n',
      9,
      [BASELINE],
    ],
    [
      'duplicate-def-first-wins',
      'Ref[^d] here.\n\n[^d]: first body\n\nfiller paragraph.\n\nplain settles.\n\n[^d]: second body ignored\n\ntail paragraph.\n',
      8,
      [BASELINE],
    ],
    [
      'case-fold-labels',
      'Weight[^SS] here.\n\n[^ß]: sharp body\n\nfiller paragraph settles.\n\ntail re-ref [^ss] again.\n',
      7,
      [BASELINE],
    ],
    [
      // Taint holds the boundary at 0 while [^late] is unresolved; once the
      // def settles (blank line after) the boundary may pass the ref and the
      // closing frames splice. Without the settling paragraph this payload
      // would (correctly) never splice at all.
      'def-in-tail-ref-in-prefix',
      'Early claim[^late] made.\n\nfiller one paragraph.\n\nfiller two paragraph.\n\n[^late]: arrives late\n\nsettled paragraph.\n\nclosing tail paragraph.\n',
      9,
      [BASELINE, ALL_ON],
    ],
    [
      'multi-paragraph-def-body',
      'Claim[^m] here.\n\n[^m]: first body paragraph\n\n    second indented paragraph\n\nplain col-zero settles.\n\ntail paragraph extends.\n',
      9,
      [BASELINE, ALL_ON],
    ],
    [
      'indented-def-column-invariance',
      'Claim[^i] here.\n\n  [^i]: two-space-indented def\n\nplain settles.\n\ntail paragraph extends further.\n',
      8,
      [BASELINE],
    ],
    [
      'nested-ref-in-def-body',
      'Outer[^o] claim.\n\n[^o]: body references [^inner] here\n\n[^inner]: inner body\n\nplain settles.\n\ntail paragraph extends.\n',
      9,
      [BASELINE, ALL_ON],
    ],
    [
      'math-in-def-body',
      'Claim[^k] here.\n\n[^k]: body with $$e^{i\\pi}$$ math\n\nplain settles.\n\ntail paragraph extends here.\n',
      9,
      [BASELINE],
    ],
    [
      'ref-inside-blockquote',
      '> quoted claim[^q] here.\n\n[^q]: q body\n\nplain settles.\n\ntail paragraph extends.\n',
      8,
      [BASELINE],
    ],
    [
      'crlf-footnotes',
      'Claim[^c] here.\r\n\r\n[^c]: c body\r\n\r\nplain settles.\r\n\r\ntail paragraph extends.\r\n',
      9,
      [BASELINE],
    ],
  ];

  for (const [name, payload, chunk, configs] of fixtures) {
    test(name, () => {
      for (const config of configs) {
        const stats = assertStreamEquivalence(name, chunkSnapshots(payload, chunk), config);
        expect(stats.incrementalFrames, `${name} [${config.label}] must actually splice`).toBeGreaterThan(0);
      }
    });
  }

  test('blockquote-nested footnote def → uninjectable fallback (equivalence holds)', () => {
    // Column fidelity cannot survive slicing a `> [^x]: …` def out of its
    // container, so frames whose prefix holds one degrade to full parses.
    const payload = '> [^bq]: quoted def\n\nRef[^bq] later.\n\nplain settles.\n\ntail paragraph extends.\n';
    assertStreamEquivalence('bq-nested-footnote-def', chunkSnapshots(payload, 7), BASELINE);
  });

  test('splices on a frame whose FROZEN PREFIX contains the footnote region', () => {
    // Pins that the replay path itself engaged: the final frame's boundary
    // must sit PAST the defs (events replayed) while still splicing.
    const payload =
      'Alpha[^a] beta[^a].\n\n[^a]: A body\n\nplain settles the region.\n\nmore prose extends.\n\ntail re-ref [^a] closes.\n\nfinal paragraph of the document.\n';
    const options = buildAdvanceOptions(BASELINE);
    const snapshots = chunkSnapshots(payload, 10);
    let state: IncrementalParseState | null = null;
    let last: ReturnType<typeof advanceIncrementalParse> | null = null;
    for (const snapshot of snapshots) {
      last = advanceIncrementalParse(state, snapshot, options);
      state = last.nextState;
    }
    expect(last!.usedIncremental).toBe(true);
    expect(last!.boundary).toBeGreaterThan(payload.indexOf('[^a]: A body') + 12);
  });
});
