/**
 * Pinned counterexamples from the 2026-08-03 enlarged (200k-sample) sharded
 * soak — all three reachable in shipped v1.8.0 (three-version replay:
 * v1.8.0 and the pre-blocker-6 v2 commit fail identically). Two distinct
 * mechanisms; the guards holding them moved during the 2026-08-04 credit
 * refinement:
 *
 * - CLASS A (seeds 20260757/20260759): originally read as a splice-layer
 *   blind spot, actually a DETECTOR under-block — `<embed` glued lines set
 *   htmlFlowSinceBlank, the real `$$` open got suppressed, and the fence
 *   tracker's phase INVERTED (every later close read as an open), letting a
 *   boundary land inside open math; the tail re-parse then flipped the
 *   closing fence into an opener. Held first by the coarse cut-ends-
 *   position-less bail (2.0.1), now by detector blocker 7 (suppressed
 *   fence/math opens poison later candidates — computeFreezeBoundary.ts
 *   `phasePoisonedAt`); the coarse bail is removed.
 *
 * - CLASS B (seed 20260751, display-only config): an unclosed inline
 *   `<details>` open tag in a frozen paragraph. parse5's tree construction
 *   closes the `<p>` and hoists a details element to the root, where it
 *   swallows every later sibling — so an mdast-clean boundary is NOT
 *   hast-clean: the previous frame's details subtree contains tail bytes,
 *   which the tail re-parse then duplicates. Still held by the hast
 *   straddle bail in spliceTrees: a positioned cut child whose end offset
 *   exceeds the boundary → full parse.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

interface Sample {
  tag: string;
  doc: string;
  sizes: number[];
  configIndex: number;
}

const SAMPLES: Sample[] = [
  {
    tag: 'class-B: unclosed inline <details> hoists and swallows the tail (seed 20260751)',
    doc: '[a]: https://example.com/a\n\ninline `<div>` stays code, <b>x</b> <!-- trailing opener\n    <details>[a] scanned literal\n\n<!-- a closed comment -->\n\n> a quoted line\n\n<details>\ninner prose\n</details>\n\n[^a]: body text\n\n[^a]: body text\n',
    sizes: [4, 4, 1, 4, 1, 4, 4, 4],
    configIndex: 115001841,
  },
  {
    tag: 'class-A: multi-line self-closing raw + math, cut ends position-less (seed 20260757)',
    doc: '- tight one\n- tight two\n<embed\n  src="x"\n/>\n$$\ne = mc^2\n\n$$\n\n$$\ne = mc^2\n\n$$\n\ninline `<div>` stays code\n\n<details>\ninner prose\n</details>\n\n[^a]: body text\n\n<embed\n  src="x"\n/>\n',
    sizes: [4, 4, 6, 1, 14, 17, 9, 4],
    configIndex: 0,
  },
  {
    tag: 'class-A: leading raw self-close + math + reference mentions (seed 20260759)',
    doc: '<embed\n  src="x"\n/>\n$$\ne = mc^2\n\n$$\n\n[a]: https://example.com/a\n\n\n$$\ne = mc^2\n\n$$\n\nsee [a] maybe, or [a][a] even ![a]\n\nsee [a] maybe, or [a][a] even ![a]\nprose with [a] used\n\nprose with [a] used\n',
    sizes: [4, 4, 7, 4, 4, 17, 4, 12],
    configIndex: 0,
  },
];

describe('splice structural bails: 200k-soak counterexamples', () => {
  for (const s of SAMPLES) {
    test(s.tag, () => {
      const config = CATALOG[s.configIndex % CATALOG.length];
      for (const sizes of [s.sizes, [...s.sizes].reverse()]) {
        const stats = assertStreamEquivalence(s.tag, scheduleSnapshots(s.doc, sizes), config);
        expect(stats.frames).toBeGreaterThan(0);
      }
    });
  }
});
