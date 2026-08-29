/**
 * Deterministic pins for the block-final half of the interior/block-final
 * literal classifier (post-2.3.0 hardening, final-review MAJOR): a
 * BLOCK-FINAL literal — raw text swallowed by an html flow block whose
 * source ends AT the owner's end — must keep taking the merge path (value
 * merged with the seam/footer separator, position dropped), exactly as the
 * full parse resolves it.
 *
 * Provenance: the 2.3.0 review's mutation pass showed this half had NO
 * fast-battery guard — flipping the classifier to `litEnd <= litOwnerEnd`
 * (the first-fix regression, which failed every 300k soak batch while 412
 * local tests stayed green) survived every pinned test. Hand-built docs
 * cannot reach the path (blocker 6's seam-pending rejection intercepts
 * them), so these docs were HARVESTED from the mutant itself: a fuzz hunt
 * against the flipped classifier, fast-check shrunk. Verified both ways:
 * green on the shipped classifier, red on the flipped one.
 *
 * TWO HARVESTS. The original 12-shard × 25k hunt (seeds 20270102 / 20270104
 * / 20270109) reached the path through the F16 corridor — a footnote-def
 * cross-blank continuation wrongly RELEASING the blocker-6 seal — which the
 * release-gate fix closed, dropping two of the three docs to boundary 0
 * (their engagement floor is now 0: the refusal is deliberate, and the
 * equivalence they still pin is the fix's bail direction) — and the
 * mutation check showed the surviving doc no longer kills the mutant
 * either. The classifier guard was re-harvested 2026-08-27 with the SAME
 * method against the FIXED scanner: 8 shards × 25k (seeds 20293100-107),
 * one find (seed 20293107, shrunk 38×) — the mutant-killing doc below
 * reaches the merge path through a corridor that survives F16/F17
 * (`<script>` type-1 block, no footnote-def continuation involved).
 * Re-verified both ways: green on shipped, red on flipped (the literal
 * ` ?> after the pi` keeps its position and loses the merged `\n`).
 *
 * THIRD CORRIDOR, and the last one: the derived seal release (design rev3)
 * closed the hole the 2026-08-27 harvest had used. Its corridor was the
 * enumeration releasing a whole-line `<script>…</script>` — an html-flow
 * line — which is the same claim F23 recorded as a defect, on the same
 * literal (` ?> after the pi`, position kept where the full parse merges a
 * `\n`). So the doc that killed the mutant was reaching the merge path
 * THROUGH the defect the seal fix removes; with the fix its boundary is 0
 * and its floor joins the other two at zero.
 *
 * The pattern is not bad luck, and it is why no fourth harvest was run
 * after the third: a block-final literal AT a first freeze is a root-level
 * trailing text node the next append can extend — blocker 6's hazard,
 * stated exactly. A sound seal therefore refuses every first freeze this
 * branch could classify, so the branch is reachable only through a
 * blocker-6 hole, and each hole closed has cost this guard its witness
 * (F16, then this one). Re-harvest attempted anyway against the fixed
 * scanner, same method, 3 shards × 2000 samples × 2 schedules (seeds
 * 20296001-003): the flipped classifier SURVIVED all three. Recorded, not
 * papered over: the `litEnd === litOwnerEnd` classification now has no
 * deterministic killer, and what still guards the branch is the
 * POSITION-LESS path (later frames, where the merge already happened),
 * which the four docs below do exercise. Do not read their green as
 * coverage of the equal case.
 *
 * This is NOT a TODO for a fourth harvest. Harvesting is the wrong
 * instrument now, and a run that came back with a doc would mean the seal
 * had a hole again, not that the guard was healthy. Restoring real coverage
 * of the equal case needs a different one — reaching the classifier
 * directly rather than through a scanner boundary, so that what it asserts
 * does not depend on blocker 6 being wrong.
 *
 * DONE 2026-08-29, in the second describe below. The `< → <=` mutant that
 * survived all three harvests is killed by it, verified both ways.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';
import { alignPrefixCut } from './spliceParse';
import type { Content as MdastContent } from 'mdast';
import type { RootContent as HastContent } from 'hast';

/** Only the two offsets the classifier reads; line/column are unused. */
const pos = (start: number, end: number) => ({
  start: { line: 1, column: 1, offset: start },
  end: { line: 1, column: 1, offset: end },
});

const CASES: Array<{ name: string; doc: string; sizes: number[]; configIndex: number; floor?: number }> = [
  {
    name: 'quoted-line literal + trailing comment opener + open math (seed 20270102 — F16 corridor, now refused)',
    doc: '<details>\n<summary>t</summary>\nbody prose\n</details>\n> a quoted line\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n[a]: https://example.com/a\n\n<b>x</b> <!-- trailing opener\n\n$$\ne = mc^2\n\n',
    sizes: [4, 1, 4, 4, 4, 4, 4, 4],
    configIndex: 1550658154,
    floor: 0,
  },
  {
    name: 'footnote def glued under the block + scanned literal tail (seed 20270109 — F16 corridor, now refused)',
    doc: '<details>\n<summary>t</summary>\nbody prose\n</details>\n[^a]: body text\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n    <details>[a] scanned literal\n',
    sizes: [4, 4, 8, 6, 4, 4, 4, 1],
    configIndex: 1453142866,
    floor: 0,
  },
  {
    name: 'PI literal + script comment block + scanned literal + truncated def (seed 20293107 — F23/enumeration corridor, now refused)',
    doc: '<?instr <b> ?> after the pi\n\n<script><!--x--></script>\n\n\n    <details>[a] scanned literal\n\n<!-- a closed comment -->\n\n[a]: /u(x\n',
    sizes: [4, 4, 1, 4, 4, 1, 4, 4],
    configIndex: 336555039,
    floor: 0,
  },
  {
    name: 'ref-dense literal + wrapped def title + PI + multi-line embed (seed 20270104)',
    doc: '$$\ne = mc^2\n\n$$\n\n<details>\ninner prose\n</details>\nsee [a] maybe, or [a][a] even ![a]\n\n[a]: https://example.com/a "title\nwraps"\n\n[a]: https://example.com/a\n\n<?instr <b> ?> after the pi\n\n[a]: https://example.com/a\n\n<embed\n  src="x"\n/>\n',
    sizes: [7, 6, 1, 4, 1, 11, 1, 4],
    configIndex: 0,
  },
];

describe('splice seam: block-final literal keeps the merge path', () => {
  test.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const config = CATALOG[c.configIndex % CATALOG.length];
    for (const sizes of [c.sizes, [...c.sizes].reverse()]) {
      const stats = assertStreamEquivalence('block-final-merge', scheduleSnapshots(c.doc, sizes), config, {
        minIncrementalFrames: c.floor ?? 1,
      });
      expect(stats.frames).toBeGreaterThan(0);
    }
  });
});

/**
 * THE EQUAL CASE, guarded at the classifier instead of through a document.
 *
 * `alignPrefixCut` splits a trailing positioned literal three ways on its
 * end offset against its owner html node's end:
 *
 *   litEnd  >  litOwnerEnd  → bail (unreachable by the model, made safe)
 *   litEnd  <  litOwnerEnd  → INTERIOR: a sanitize-stripped sibling followed
 *                             it at reparse time, so the full parse keeps it
 *                             verbatim → plain-slot rebuild
 *   litEnd === litOwnerEnd  → BLOCK-FINAL, the merge path, together with the
 *                             position-less literals
 *
 * The suite above reaches this branch only through a first freeze, and the
 * header records why it no longer can: a sound seal refuses every first
 * freeze that could carry a positioned block-final literal, so each seal fix
 * has taken a witness with it and the equal case has none left.
 *
 * WHAT THIS TEST CLAIMS, stated because the distinction is the whole reason
 * it exists: the classifier's CONTRACT — that the boundary between
 * block-final and interior sits at `<`, not at `<=`. Flip the comparison and
 * the equal row moves to `interiorFinalLiteral: true` and this reds.
 *
 * WHAT IT DOES NOT CLAIM: that the equal state is reachable. It is not,
 * today, and that is a fact about blocker 6 rather than about this branch.
 * A test that tried to claim both is what the four documents above used to
 * be, and their green now depends on the position-less path alone — do not
 * read them as coverage of the equal case.
 *
 * The inputs are built rather than parsed, which is the point: parsing one
 * would put a scanner boundary back in the loop and re-inherit the
 * dependence this test exists to remove. They are the smallest shapes that
 * reach the classifier — one visible html owner, one trailing literal — and
 * only the four fields it reads are set.
 */
describe('splice seam: the block-final/interior classifier itself', () => {
  const owner = (end: number): MdastContent =>
    ({ type: 'html', value: '<details>x</details>', position: pos(0, end) }) as unknown as MdastContent;
  const literal = (end: number | undefined): HastContent =>
    ({
      type: 'text',
      value: 'x literal',
      ...(end === undefined ? {} : { position: pos(9, end) }),
    }) as unknown as HastContent;

  const classify = (ownerEnd: number, litEnd: number | undefined) =>
    alignPrefixCut([owner(ownerEnd)], [literal(litEnd)], false);

  test('a literal ending WHERE its owner ends is block-final, not interior', () => {
    const r = classify(20, 20);
    expect(r, 'the equal case must not bail').not.toBeNull();
    expect(r?.interiorFinalLiteral, 'litEnd === litOwnerEnd is the MERGE path').toBe(false);
  });

  test('a literal ending BEFORE its owner is interior', () => {
    // The control that makes the assertion above a boundary rather than a
    // constant: one byte moves the verdict.
    const r = classify(20, 19);
    expect(r).not.toBeNull();
    expect(r?.interiorFinalLiteral).toBe(true);
  });

  test('a literal ending PAST its owner bails', () => {
    expect(classify(20, 21)).toBeNull();
  });

  // The position-less literal — the sibling case, and the one the four
  // documents above DO still cover — is deliberately not built here. As a
  // cut region's first node it is not a legal shape: attribution only ever
  // hands one over when it directly follows a positioned element (see
  // `isTrailingLiteralText` at the cut), and `alignPrefixCut` bails on the
  // synthetic one-node version for that reason. Building a two-node shape
  // to reach it would be inventing a layout to satisfy a test, which is the
  // opposite of what this file is for.
});
