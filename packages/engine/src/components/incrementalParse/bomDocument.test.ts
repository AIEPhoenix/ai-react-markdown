/**
 * A document-leading U+FEFF (byte order mark) reaching the engine directly.
 *
 * micromark drops a leading BOM before tokenizing, so every node offset in
 * the parsed trees is the string index MINUS ONE, while the boundary
 * scanner, the prefix cut, the straddle check and the rebase delta all work
 * in raw string indices. Spliced under that mismatch, the character-granular
 * stream `\uFEFF# Title\n\nSome paragraph…` kept a phantom one-character
 * paragraph (`S`) in the frozen prefix from the first splice frame onward.
 *
 * Stage A strips the BOM before any consumer sees it (preprocessors/index.ts),
 * so production never reaches this path. The engine still refuses to splice
 * such a document: the scanner grants no boundary and the append gate treats
 * the frame as a non-append, so every frame is a full parse — deep-equal to
 * the oracle by construction. The fuzz corpus carries the shape too
 * (`fuzzGenerators.ts`, `leadingBom` coverage marker).
 */

import { describe, expect, test } from 'vitest';

import preprocessAIMDContent from '../../preprocessors';
import { advanceIncrementalParse, type IncrementalParseState } from './advanceIncrementalParse';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { buildAdvanceOptions, CATALOG } from './testPluginCatalog';

const BOM = '\uFEFF';
const DOC = `${BOM}# Title\n\nSome paragraph text here.\n\nAnother paragraph.\n`;

/** One snapshot per character — the granularity the report used. */
function charSnapshots(doc: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= doc.length; i++) out.push(doc.slice(0, i));
  return out;
}

const DEFAULTS_ALL_ON = CATALOG.find((c) => c.label === 'defaults-all-on')!;
const BASELINE = CATALOG.find((c) => c.label === 'baseline')!;

describe('leading BOM reaching advanceIncrementalParse directly', () => {
  test.each([DEFAULTS_ALL_ON, BASELINE])(
    'char-granular stream is deep-equal to a full parse at every frame [$label]',
    (config) => {
      // Zero engagement IS the asserted outcome: the engine must not splice
      // a document whose parser offsets disagree with its string indices.
      const stats = assertStreamEquivalence('bom-doc', charSnapshots(DOC), config, { minIncrementalFrames: 0 });
      expect(stats.frames).toBe(DOC.length);
    }
  );

  test('the phantom "S" paragraph does not appear after the first splice-eligible frame', () => {
    const options = buildAdvanceOptions(DEFAULTS_ALL_ON);
    let state: IncrementalParseState | null = null;
    for (const snapshot of charSnapshots(DOC)) {
      const result = advanceIncrementalParse(state, snapshot, options);
      state = result.nextState;
      const paragraphs = result.mdast.children.filter((c) => c.type === 'paragraph');
      // The stream never holds more than two paragraphs; a third would be
      // the stale one-character node the mismatched prefix cut retained.
      expect(paragraphs.length, JSON.stringify(snapshot)).toBeLessThanOrEqual(2);
    }
  });

  test('a BOM document is never an append (full path every frame) and the scanner grants no boundary', () => {
    const options = buildAdvanceOptions(DEFAULTS_ALL_ON);
    const first = advanceIncrementalParse(null, DOC.slice(0, 12), options);
    const second = advanceIncrementalParse(first.nextState, DOC, options);
    expect(second.usedIncremental).toBe(false);
    expect(second.boundary).toBe(0);
    expect(computeFreezeBoundary(DOC, { defListEnabled: true }).boundary).toBe(0);
    expect(computeFreezeBoundary(DOC, { defListEnabled: false }).boundary).toBe(0);
    // The same document without the BOM freezes normally — the poison is
    // the BOM, not the content.
    expect(computeFreezeBoundary(DOC.slice(1), { defListEnabled: true }).boundary).toBeGreaterThan(0);
    const bare = advanceIncrementalParse(null, DOC.slice(1, 12), options);
    expect(advanceIncrementalParse(bare.nextState, DOC.slice(1), options).usedIncremental).toBe(true);
  });

  test.each([1, 2, 3])(
    'after Stage A, a %i-BOM char-granular stream splices, matches a full parse and keeps offsets equal to string indices',
    (bomCount) => {
      // Production order: Stage A strips every leading BOM, then the engine
      // sees the frame. The stripped stream is append-only, so the engine
      // splices it like any other, and every node offset is a string index
      // into the frame the engine received.
      const raw = `${BOM.repeat(bomCount)}# Title\n\nSome paragraph text here.\n\n[x]: /url\n\nAnother [x] paragraph.\n`;
      const frames = charSnapshots(raw).map((frame) => preprocessAIMDContent(frame));
      for (const config of [DEFAULTS_ALL_ON, BASELINE]) {
        const stats = assertStreamEquivalence(`bom-${bomCount}-staged`, frames, config, { minIncrementalFrames: 1 });
        expect(stats.frames).toBe(frames.length);
      }
      const options = buildAdvanceOptions(DEFAULTS_ALL_ON);
      let state: IncrementalParseState | null = null;
      for (const frame of frames) {
        const result = advanceIncrementalParse(state, frame, options);
        state = result.nextState;
        // With no BOM left in the frame the first block starts at index 0 —
        // under the old one-BOM strip a second BOM shifted every offset by
        // one relative to the string the block planner slices.
        const first = result.mdast.children[0];
        if (first) expect(first.position!.start.offset, JSON.stringify(frame)).toBe(0);
        for (const node of result.mdast.children) {
          expect(frame.charCodeAt(node.position!.start.offset!), JSON.stringify(frame)).not.toBe(0xfeff);
        }
      }
      const finalFrame = frames[frames.length - 1];
      const last = advanceIncrementalParse(null, finalFrame, options).mdast;
      expect(last.children[0]!.type).toBe('heading');
      expect(finalFrame.slice(last.children[0]!.position!.start.offset, last.children[0]!.position!.end.offset)).toBe(
        '# Title'
      );
      const def = last.children.find((c) => c.type === 'definition')!;
      expect(finalFrame.slice(def.position!.start.offset, def.position!.end.offset)).toBe('[x]: /url');
    }
  );

  test('equal BOM content still short-circuits to the previous trees', () => {
    const options = buildAdvanceOptions(BASELINE);
    const first = advanceIncrementalParse(null, DOC, options);
    const again = advanceIncrementalParse(first.nextState, DOC, options);
    expect(again.mdast).toBe(first.mdast);
    expect(again.hast).toBe(first.hast);
  });
});
