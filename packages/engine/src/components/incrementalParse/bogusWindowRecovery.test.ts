/**
 * P3b batch 3 — the PI/CDATA first-`>` windows, exact instead of poisoned,
 * and the p5 BOGUS overlay honestly paired with md types 3/4/5.
 *
 * parse5 reads `<?`, `<![CDATA[` and `<!X` all as bogus comments to the
 * FIRST `>` (rev2 #4, measured); micromark's blocks run to `?>` / `]]>` /
 * `>`. Type 4 shares its end with the bogus comment — no window. Types
 * 3/5 open a window from parse5's `>` to micromark's terminator: markup
 * bytes there poison (P5_MARKUP_RE, the batch-2 rule); a markup-free
 * window is parse5 TEXT that converges at the terminator, its remnant
 * owned by the blocker-6 seam. An md 2-5 block still open at a BLANK
 * carries its aligned bogus state across (one block, one bogus comment —
 * the unpaired-bogus poison fires only without the md construct).
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (doc: string) => computeFreezeBoundary(doc, { defListEnabled: false }).boundary;
/** CDATA shapes carry `[`…`]` pairs in their own delimiters, which the
 *  (deliberately conservative) ref extraction reads as an unresolved
 *  reference — pre-existing taint behaviour, orthogonal to the window
 *  logic under test, so the CDATA pins run taint-off (the scanner/phantom
 *  production profiles). */
const boundaryNoTaint = (doc: string) =>
  computeFreezeBoundary(doc, { defListEnabled: false, referenceTaint: false }).boundary;

/** The soak-20282500 counterexample: `</t>` opens a type-7 run with NO
 *  blank in sight, so the whole document below is that run's content to
 *  micromark. Shared by the direct boundary pin and the stream battery. */
const MEMBER_STEAL_DOC =
  '</t>\ntext after a stray end tag\r\n<![CDATA[\n<details>\n]]> trailing prose\n$$\ne = mc^2\n\n$$\n\n> a quoted line\n';

describe('PI/CDATA first-`>` window recovery (P3b batch 3)', () => {
  test('markup-free windows converge at the terminator and freezing resumes', () => {
    const inline = 'x\n\n<?x >?>\n\ny\n\nzzz\n';
    expect(boundary(inline)).toBe(inline.indexOf('zzz'));
    expect(boundary('<?a > plain ?>\n\ntail one\n\ntail two\n\nend\n')).toBeGreaterThan(0);
    expect(boundaryNoTaint('<![CDATA[a> data ]]>\n\ntail one\n\nend\n')).toBeGreaterThan(0);
    // window spanning lines, still markup-free
    expect(boundary('<?a >\nplain window line\n?>\n\ntail\n\nend\n')).toBeGreaterThan(0);
  });

  test('markup in the window still poisons (flip pins)', () => {
    expect(boundary('<?x >\n<details>\n?>\n\nx\n\ny\n')).toBe(0);
    expect(boundary('<?x ><i>b</i>?>\n\ntail\n\nend\n')).toBe(0);
    expect(boundary('<![CDATA[x>\n<details>\n]]>\n\nx\n\ny\n')).toBe(0);
    expect(boundaryNoTaint('<![CDATA[x> <em>e</em> ]]>\n\ntail\n\nend\n')).toBe(0);
  });

  test('an aligned bogus state survives the blank with its md block', () => {
    // `<?a\n\n?>` is ONE type-3 block to micromark and ONE bogus comment
    // to parse5 — the blank must not fire the unpaired-bogus poison.
    const doc = '<?a\n\ncontent\n\n?> done\n\ntail one\n\ntail two\n\nend\n';
    expect(boundary(doc)).toBeGreaterThan(0);
  });

  test('a 2-5 opener inside a 6/7 run does not steal the member — DIRECT boundary pin', () => {
    // The pin that MOVES when 96901ff is reverted. The stream harness above
    // drives the ENGINE profile, where this document poisons to 0 either
    // way — so it never saw the fix (2026-08-26 review: the whole schedule
    // set ran at incrementalFrames=0). The steal is only visible on the
    // SCANNER/PHANTOM profile, which no stream test drives: with the three
    // `mdBlock.kind === 'none'` guards removed the CDATA opener overwrites
    // the type-7 run's member, closes it at `]]>`, and the boundary climbs
    // to 89 — freezing past a `$$` the engine reads as a real math open.
    expect(computeFreezeBoundary(MEMBER_STEAL_DOC, { defListEnabled: false, referenceTaint: false }).boundary).toBe(0);
  });

  test('a 2-5 opener inside a 6/7 run does not steal the member (soak 20282500)', () => {
    // `</t>` opens a type-7 run with NO blank in sight — the whole
    // document below is that run's content to micromark. The CDATA
    // opener used to overwrite the member and close it at `]]>`, so the
    // `$$` after was mistaken for a real math open and the phantom
    // closer broke output-neutrality (fuzz shard 0 of the release gate;
    // masked by the run flag until its deletion). The member now keeps
    // the run; only the p5 bogus overlay opens inside it.
    const doc = MEMBER_STEAL_DOC;
    for (const sizes of [
      [4, 4, 15, 4, 17, 4, 1, 4],
      [4, 4, 4, 4, 4, 4, 4, 4],
      [1, 4, 4, 4],
    ]) {
      // boundary 0 under every profile — zero engagement is the asserted
      // outcome, and the direct boundary pin above is what a revert moves.
      assertStreamEquivalence('member-steal', scheduleSnapshots(doc, sizes), CATALOG[0], { minIncrementalFrames: 0 });
    }
  }, 120_000);

  test('every window shape streams like a full parse', () => {
    const SHAPES = [
      'x\n\n<?x >?>\n\ny\n\nzzz\n',
      '<?a > plain ?>\n\ntail one\n\ntail two\n\nend\n',
      '<![CDATA[a> data ]]>\n\ntail one\n\nend\n',
      '<?a >\nplain window line\n?>\n\ntail\n\nend\n',
      '<?x >\n<details>\n?>\n\nx\n\ny\n',
      '<![CDATA[x>\n<details>\n]]>\n\nx\n\ny\n',
      '<?a\n\ncontent\n\n?> done\n\ntail\n\nend\n',
      '<![CDATA[\n\nd]]> after\n\ntail\n\nend\n',
      '<?a > w\n?> <div>x</div>\n\ntail\n\nend\n',
    ];
    let incremental = 0;
    for (const doc of SHAPES) {
      for (const sizes of [
        [4, 4, 4, 4, 4, 4, 4, 4],
        [1, 4, 4, 4, 4, 4, 4, 4],
        [64, 8, 8, 8],
      ]) {
        incremental += assertStreamEquivalence(
          JSON.stringify(doc.slice(0, 18)),
          scheduleSnapshots(doc, sizes),
          CATALOG[0],
          { minIncrementalFrames: 0 }
        ).incrementalFrames;
      }
    }
    // The markup-bearing windows poison to zero by design; the markup-free
    // ones must recover and splice (measured 3 frames across the family).
    expect(incremental).toBeGreaterThan(0);
  }, 240_000);
});
