/**
 * The `formElement` latent divergence — accident turned into design.
 *
 * parse5's `Parser` carries a `formElement` pointer beside the open-element
 * stack. An open `<form>` sets it; only `</form>` clears it; a form closed
 * IMPLICITLY (its container's end tag pops it) leaves the pointer set, and a
 * later `<form>` start tag is then IGNORED while the pointer is non-null. So
 * for
 *
 *   <div><form></div>   ++   <form>b</form>
 *
 * the full parse drops the second form (pointer still set) while a split
 * parse of the tail opens it — the forward-independence identity fails even
 * though every enumerated (P) condition (tokenizer state, stack depth,
 * active formatting elements, foster parenting) is clean. This is the
 * measured proof that enumerating (P) conditions cannot be made complete
 * (two-model design §2.1), and `oracleConformance.test.ts` pins that the
 * identity oracles fire on it.
 *
 * The scanner does NOT model the pointer. It is safe today because of two
 * facts that used to be accidents and are DESIGNED GUARDS from this file on:
 *
 *  1. The end-tag walk in `computeFreezeBoundary` removes ONLY the matched
 *     element — implied end tags are deliberately not modelled — so the
 *     implicitly-closed `<form>` stays on `openStack`, `openTotal` stays
 *     positive, and every candidate past it is rejected. The pointer can
 *     only be non-null while the scanner is already refusing to freeze.
 *     If implied-end-tag modelling ever ships, the first test below goes
 *     red: that change must bring an explicit P-tree `formElement` field
 *     (or poison) with it.
 *
 *  2. `form` is not in the sanitize schema's `tagNames`, so even the
 *     divergent element difference is masked in the final hast (children
 *     lifted). Masking exemptions must name the schema entry they rely on
 *     (execution plan §P3a acceptance) — the second test is that pin. A
 *     CALLER-supplied schema that allows `form` re-opens the exposure;
 *     that sits outside the default contract (GRAMMAR-COVERAGE ground
 *     facts: a changed schema re-derives every "safe" column).
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { sanitizeSchema } from '../sanitizeSchema';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;

describe('formElement latent divergence — the designed guards', () => {
  test('an implicitly-closed <form> stays counted: no candidate is ever granted past it', () => {
    // Guard 1's tripwire. `</div>` removes only the div; the form stays on
    // `openStack`, so `openTotal > 0` rejects every later candidate. If a
    // future change models implied end tags (popping the form with its
    // container), this expectation fails — and that change MUST introduce
    // an explicit formElement guard before it can land, or the
    // oracleConformance formElement counterexample becomes reachable.
    const doc = '<div><form></div>\n\npara one\n\npara two\n\npara three\n';
    expect(boundary(doc)).toBe(0);
  });

  test('an explicitly closed <form> clears the pointer in both grammars: freezing resumes', () => {
    // `</form>` clears parse5's pointer AND pops the scanner's entry — the
    // guard blocks exactly the shapes where the pointer survives.
    const doc = '<div><form></form></div>\n\npara one\n\npara two\n\npara three\n';
    expect(boundary(doc)).toBeGreaterThan(0);
  });

  test('form is not in the sanitize allowlist (guard 2, the named schema entry)', () => {
    // Guard 2's tripwire. Sanitize lifting the element is what masks the
    // divergent ELEMENT difference in the final hast. Allowing `form` here
    // makes the formElement divergence visible to the contract — adding it
    // requires a real (P-tree) answer in the scanner first.
    expect(sanitizeSchema.tagNames).not.toContain('form');
  });

  test('the counterexample streams like a full parse end to end', () => {
    // The system-level statement the two guards buy: streamed at small
    // chunks, the exact design-§2.1 shape produces the full parse's hast at
    // every frame (guard 1 forces these frames onto the safe path).
    const doc = '<div><form></div>\n\n<form>b</form>\n\npara after\n';
    for (const sizes of [
      [4, 4, 4, 4, 4, 4, 4, 4],
      [1, 4, 4, 4, 4, 4, 4, 4],
    ]) {
      // Guard 1 is exactly "the scanner never grants a boundary here", so
      // zero engagement is the asserted outcome, not a vacuous pin.
      assertStreamEquivalence('formElement', scheduleSnapshots(doc, sizes), CATALOG[0], { minIncrementalFrames: 0 });
    }
  }, 30_000);
});
