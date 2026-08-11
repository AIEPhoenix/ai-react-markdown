/**
 * ARBITER SENSITIVITY — meta-tests that the verification suite itself
 * detects planted faults ("who watches the watchmen"). A green fuzz/soak
 * run only means something if the properties are ARMED: each test here
 * plants a fault of a historically-real class and asserts the property
 * FAILS. If one of these ever passes silently, the arbiter has gone blind
 * and every other green result is suspect.
 *
 * Fault classes:
 * 1. Detector under-block — replays the boundary the PRE-FIX detector
 *    produced for the masking-in-html-flow bug (fuzz-found, fixed): the
 *    splice then freezes an html-swallow region and the per-frame
 *    equivalence oracle must throw.
 * 2. Checkpoint corruption — a resumed scan whose defs map was tampered
 *    with must diverge from the fresh scan on a defs-bearing corpus (the
 *    P2 differential).
 * 3. Oracle acuity — a single-node mutation deep in the hast (one text
 *    value, or one dropped separator) must flip the deep-equal oracle.
 */

import { describe, expect, test, vi } from 'vitest';
import isEqual from 'lodash-es/isEqual';

import { DEFAULT_PAYLOAD } from '../../fixtures/scenarios';
import { advanceIncrementalParse, type IncrementalParseState } from './advanceIncrementalParse';
import { buildAdvanceOptions, CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence, runFull } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';
import { codePointSnapshots } from './codePointSnapshots';

/** The masking-in-html-flow fixture (spliceEquivalence FUZZ_CASES) and the
 *  boundary the pre-fix detector chose for it — past the blank line that
 *  follows the html-flow `` `<div>` `` swallow line. */
const MASKING_DOC =
  '[a]: https://example.com/a\n\n<details>\n<summary>t</summary>\nbody prose\n</details>\ninline `<div>` stays code\n\n> a quoted line\n\n<b>x</b> <!-- trailing opener\n\n$$\ne = mc^2\n\n';
const MASKING_SIZES = [4, 4, 4, 4, 1, 4, 4, 4];
const PRE_FIX_BOUNDARY = 108;

const faultState = { boundaryOverride: false };

vi.mock('./computeFreezeBoundary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./computeFreezeBoundary')>();
  return {
    ...actual,
    computeFreezeBoundary: (
      text: string,
      options: Parameters<typeof actual.computeFreezeBoundary>[1],
      resume?: Parameters<typeof actual.computeFreezeBoundary>[2]
    ) => {
      const result = actual.computeFreezeBoundary(text, options, resume);
      if (faultState.boundaryOverride && text.startsWith('[a]: https://example.com/a\n\n<details>')) {
        return { ...result, boundary: Math.min(PRE_FIX_BOUNDARY, Math.max(0, text.length - 1)) };
      }
      return result;
    },
  };
});

describe('arbiter sensitivity (planted faults MUST be detected)', () => {
  test('sanity: the corpus passes with no fault planted', () => {
    assertStreamEquivalence('sensitivity-sanity', scheduleSnapshots(MASKING_DOC, MASKING_SIZES), CATALOG[0]);
  });

  test('fault 1: pre-fix under-block boundary → P1 equivalence oracle throws', () => {
    faultState.boundaryOverride = true;
    try {
      expect(() =>
        assertStreamEquivalence('sensitivity-underblock', scheduleSnapshots(MASKING_DOC, MASKING_SIZES), CATALOG[0])
      ).toThrowError(/mismatch/);
    } finally {
      faultState.boundaryOverride = false;
    }
  });

  test('fault 2: tampered checkpoint → P2 resume/fresh differential diverges', async () => {
    const { computeFreezeBoundary } = await import('./computeFreezeBoundary');
    // Defs settle EARLY, refs arrive later: gutting the defs map mid-stream
    // leaves the resumed scan unable to resolve the later references (the
    // pre-checkpoint lines are never re-lexed — that is the point of the
    // checkpoint), so its boundary must fall behind the fresh scan's.
    const doc =
      '[a]: https://example.com/a\n\nfiller paragraph one.\n\nsee [a] referenced here.\n\nmore prose extends the doc.\n\nfinal paragraph closes it.\n';
    const snapshots = codePointSnapshots(doc, 10);
    let checkpoint: ReturnType<typeof computeFreezeBoundary>['checkpoint'] | null = null;
    let planted = false;
    let diverged = false;
    for (const snapshot of snapshots) {
      const fresh = computeFreezeBoundary(snapshot, { defListEnabled: false });
      const resumed = computeFreezeBoundary(snapshot, { defListEnabled: false }, checkpoint);
      if (resumed.boundary !== fresh.boundary) diverged = true;
      checkpoint = resumed.checkpoint;
      const defs = (checkpoint as unknown as { defs: Map<string, number> }).defs;
      if (!planted && defs.size > 0) {
        // Plant the fault the moment a definition settles. A blind
        // differential would shrug this off.
        defs.clear();
        planted = true;
      }
    }
    expect(planted, 'corpus never registered a definition — fault was a no-op').toBe(true);
    expect(diverged, 'P2 differential failed to notice a gutted checkpoint').toBe(true);
  });

  test('fault 3a: single text-node mutation → deep-equal oracle flips', () => {
    const options = buildAdvanceOptions(CATALOG[0]);
    const snapshots = codePointSnapshots(DEFAULT_PAYLOAD, 64);
    let state: IncrementalParseState | null = null;
    for (const snapshot of snapshots) {
      state = advanceIncrementalParse(state, snapshot, options).nextState;
    }
    const expected = runFull(DEFAULT_PAYLOAD, CATALOG[0]);
    expect(isEqual(state!.hast, expected.hast)).toBe(true);
    // Mutate ONE leaf text value (structuredClone: never touch live state).
    const corrupted = structuredClone(state!.hast) as { children: unknown[] };
    const firstText = JSON.stringify(corrupted.children[0]);
    corrupted.children[0] = JSON.parse(firstText.replace(/"value":"([^"])/, '"value":"~$1'));
    expect(isEqual(corrupted, expected.hast)).toBe(false);
  });

  test('fault 3b: dropped separator node → deep-equal oracle flips', () => {
    const expected = runFull(DEFAULT_PAYLOAD, CATALOG[0]) as { hast: { children: unknown[] } };
    const corrupted = structuredClone(expected.hast);
    const sepIdx = corrupted.children.findIndex(
      (c) =>
        (c as { type?: string; position?: unknown }).type === 'text' &&
        (c as { position?: unknown }).position === undefined
    );
    expect(sepIdx).toBeGreaterThanOrEqual(0);
    corrupted.children.splice(sepIdx, 1);
    expect(isEqual(corrupted, expected.hast)).toBe(false);
  });
});
