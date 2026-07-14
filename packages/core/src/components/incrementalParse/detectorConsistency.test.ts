/**
 * Drift pin between the SHIPPED freeze detector and the prefixFreeze
 * experiment's L4 tier (the ablation record the benchmark docs cite).
 *
 * The two implementations share their ancestry but evolve one-way: every
 * post-review blocker (A1-A6, defList, truncated tags, normalizeIdentifier)
 * lands in production only. That is fine — production may only get
 * STRICTER — so the enforceable invariant is directional:
 *
 *   production boundary ≤ experiment L4 boundary, for every prefix.
 *
 * A violation means production started allowing something the falsified
 * record never validated — exactly the drift this pin exists to catch.
 * (The reverse gap merely costs freeze coverage and is expected.)
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
