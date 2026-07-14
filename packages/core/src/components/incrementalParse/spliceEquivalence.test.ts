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

function chunkSnapshots(payload: string, chunkSize: number): string[] {
  const codePoints = Array.from(payload);
  const snapshots: string[] = [];
  for (let i = chunkSize; i < codePoints.length; i += chunkSize) {
    snapshots.push(codePoints.slice(0, i).join(''));
  }
  snapshots.push(payload);
  return snapshots;
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
      // withDefs appends footnote refs/defs → `[^` bypass kicks in once they
      // arrive; earlier frames still splice.
      const stats = assertStreamEquivalence('with-defs', chunkSnapshots(withDefs(DEFAULT_PAYLOAD), 64), config);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
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

  test('[^ arriving mid-stream forces full path from that frame on', () => {
    const payload = 'plain paragraph one.\n\nplain paragraph two.\n\na claim[^n] appears.\n\n[^n]: footnote body\n';
    for (const config of [BASELINE, ALL_ON]) {
      assertStreamEquivalence('footnote-mid-stream', chunkSnapshots(payload, 8), config);
    }
  });

  test('CRLF line endings', () => {
    const payload = 'para one.\r\n\r\npara two with **bold**.\r\n\r\n- item\r\n- item two\r\n\r\ncol zero.\r\n\r\ntail.\r\n';
    assertStreamEquivalence('crlf', chunkSnapshots(payload, 9), BASELINE);
  });

  test('duplicate label: prefix def wins over a later tail def (first-def-wins)', () => {
    const payload =
      '[a]: https://first.example\n\nuse [text][a] here.\n\nfiller paragraph.\n\n[a]: https://second.example\n\ntail.\n';
    assertStreamEquivalence('dup-label', chunkSnapshots(payload, 8), BASELINE);
  });
});
