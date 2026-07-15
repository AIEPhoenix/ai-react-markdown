/**
 * Drift pin between the SHIPPED freeze detector and the prefixFreeze
 * experiment's L4 tier (the ablation record the benchmark docs cite).
 *
 * The two implementations share their ancestry but evolve independently:
 * post-review blockers (A1-A6, defList, truncated tags,
 * normalizeIdentifier) land in production only (stricter), while inline
 * code-span MASKING makes production LOOSER than L4 on inputs whose code
 * spans carry brackets/tags (L4 counts them as taint; production masks
 * them — probe-verified divergence). The enforceable invariant is
 * therefore directional ON THESE CORPORA, which contain no such spans:
 *
 *   production boundary ≤ experiment L4 boundary, for every prefix
 *   of the corpora below.
 *
 * A violation still means production started allowing something the
 * falsified record never validated on realistic content — the drift this
 * pin exists to catch. Do NOT add bracket-bearing code spans to these
 * corpora; the masking divergence is expected and its safety is owned by
 * the splice-equivalence arbiter (which HAS such fixtures).
 */

import { describe, expect, test } from 'vitest';

import { DEFAULT_PAYLOAD, withDefs } from '../../../stories/streaming/scenarios';
import { detectFreezeBoundaries } from '../../experiments/prefixFreeze/detectFreezeBoundaries';
import { computeFreezeBoundary } from './computeFreezeBoundary';

const CORPORA: Array<[string, string]> = [
  ['llm-typical', DEFAULT_PAYLOAD],
  ['with-defs', withDefs(DEFAULT_PAYLOAD)],
  ['adversarial-mix', '- item\n\n    code\n\n> quote\n\n[a]: /x\n\nsee [a]\n\n```js\nx\n```\n\ntail.\n'],
];

describe('production detector vs experiment L4 (direction pin)', () => {
  for (const [name, payload] of CORPORA) {
    test(name, () => {
      for (let i = 8; i <= payload.length; i += 7) {
        const prefix = payload.slice(0, i);
        const production = computeFreezeBoundary(prefix, { defListEnabled: false }).boundary;
        const experimentL4 = detectFreezeBoundaries(prefix).L4;
        expect(production, `at length ${i}`).toBeLessThanOrEqual(experimentL4);
      }
    });
  }
});
