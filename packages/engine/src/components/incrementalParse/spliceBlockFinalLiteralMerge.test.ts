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
 * them), so these three docs were HARVESTED from the mutant itself: a
 * 12-shard × 25k fuzz hunt against the flipped classifier, fast-check
 * shrunk (seeds 20270102 / 20270104 / 20270109). Verified both ways:
 * green on the shipped classifier, red on the flipped one.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const CASES: Array<{ name: string; doc: string; sizes: number[]; configIndex: number }> = [
  {
    name: 'quoted-line literal + trailing comment opener + open math (seed 20270102)',
    doc: '<details>\n<summary>t</summary>\nbody prose\n</details>\n> a quoted line\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n[a]: https://example.com/a\n\n<b>x</b> <!-- trailing opener\n\n$$\ne = mc^2\n\n',
    sizes: [4, 1, 4, 4, 4, 4, 4, 4],
    configIndex: 1550658154,
  },
  {
    name: 'footnote def glued under the block + scanned literal tail (seed 20270109)',
    doc: '<details>\n<summary>t</summary>\nbody prose\n</details>\n[^a]: body text\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n    <details>[a] scanned literal\n',
    sizes: [4, 4, 8, 6, 4, 4, 4, 1],
    configIndex: 1453142866,
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
      const stats = assertStreamEquivalence('block-final-merge', scheduleSnapshots(c.doc, sizes), config);
      expect(stats.frames).toBeGreaterThan(0);
    }
  });
});
