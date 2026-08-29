/**
 * EVIDENCE HARNESS — not a test. Run it from `scripts/soak/gate-evidence.sh`.
 *
 * It reproduces the measurement that justifies `formPointerMaybeSet`: the
 * guard is INERT today and load-bearing under one specific future change, so
 * neither half can be an assertion. "Inert" is measurable but proves nothing
 * on its own; "load-bearing under a change that has not happened" compares
 * the scanner against a version of itself that does not exist. Same rule as
 * the raw-mode exemption harness beside it:
 *
 *   Numbers that GATE go in assertions.
 *   Numbers that JUSTIFY a gate go in a committed script.
 *   Nothing that matters goes in a deleted scratch file or a `console.log`.
 *
 * THE CLAIM. parse5's `formElement` pointer is set by a `<form>` start tag
 * and cleared only by `</form>`; a form closed IMPLICITLY leaves it set, and
 * a later `<form>` is then ignored — so `<div><form></div>` ++
 * `<form>b</form>` diverges with every enumerated (P) condition clean. Until
 * 2026-08-29 nothing in the scanner modelled the pointer. What kept the
 * divergence latent was an unrelated modelling choice: the end-tag walk pops
 * only the MATCHED element, so the implicitly-closed `<form>` stayed on
 * `openStack` and `openTotal > 0` refused every candidate past it.
 *
 * That is the second-mechanism cover this ledger has recorded four times,
 * and it shipped with a note saying implied-end-tag modelling "must bring an
 * explicit formElement field with it" — a condition on a future change,
 * owned by nobody, checked by nothing.
 *
 * THE MEASUREMENT. Three arms over the pinned counterexample, the third
 * being the change the note was worried about. `implied` models implied end
 * tags properly: pop the matched element AND everything above it, decrementing
 * every popped name's count. Popping the stack without the counts is not the
 * same mutation and reports a false negative — it leaves `openTotal` at 1 and
 * the boundary at 0, which looks exactly like a guard doing its job.
 *
 * Expected, measured 2026-08-29:
 *
 *   guard on,  implied end tags off  ->   0   (today; the guard costs nothing)
 *   guard off, implied end tags off  ->   0   (the old cover, still holding)
 *   guard off, implied end tags on   ->  39   (the divergence becomes reachable)
 *   guard on,  implied end tags on   ->   0   (the guard alone holds it)
 *
 * The 39 is not a new number: it is what `formElementLatent.test.ts` recorded
 * from the same mutation on 2026-08-26, which is what makes this a
 * reproduction rather than a fresh claim.
 *
 * WHAT THIS FILE ACTUALLY RUNS, since the distinction matters more than the
 * convenience: arm 1 only. The other three need a source edit, and the two
 * ways to avoid that are both worse. Re-implementing the scanner's end-tag
 * walk here would make the harness compare a copy against itself, and the
 * copy would drift silently — the failure mode that put `runToRawLayer` in
 * `conformanceOracles.ts` as one exported definition. Wiring the arms as
 * runtime flags would put dead branches in a hot path of shipped code to
 * serve a harness. So the edits are PRINTED, precisely enough to apply, and
 * the operator applies them. A harness that says "I measured one of four and
 * here is how to get the other three" is worth more than one that appears to
 * measure four.
 */

import { describe, test } from 'vitest';

import { computeFreezeBoundary } from './computeFreezeBoundary';

const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

/** The counterexample, plus enough paragraphs to offer real candidates. */
const DOC = '<div><form></div>\n\npara one\n\npara two\n\npara three\n';

/**
 * The three arms, as a table of what each one asserts about the scanner.
 *
 * Only arm 1 can be run against shipped source; the other two need a source
 * edit, so they are described rather than executed and the operator applies
 * them. That is honest about what this harness does: it re-runs one number
 * and tells you exactly how to reproduce the other two, instead of silently
 * re-implementing the scanner and comparing it to itself.
 */
const ARMS: ReadonlyArray<readonly [string, string]> = [
  ['guard on, implied off', 'shipped source — no edit'],
  ['guard off, implied off', "replace `!cp.formPointerMaybeSet,` in the candidate's `htmlBalanced` with `true,`"],
  [
    'guard off, implied on',
    'the edit above, PLUS: replace the `cp.openStack.splice(idx, 1)` block with a loop that ' +
      'splices `idx .. length` and decrements `tagBalance`/`openTotal` for every popped name',
  ],
  ['guard on, implied on', 'the second edit only'],
];

describe('evidence: the formElement guard', () => {
  test('arm 1 — shipped source', () => {
    const b = computeFreezeBoundary(DOC, { defListEnabled: false }).boundary;
    emit(`\n[formElement] doc = ${JSON.stringify(DOC)}\n`);
    emit(`[formElement] arm 1 (shipped): boundary=${b} of ${DOC.length}  [expected 0]\n\n`);
    emit('[formElement] the other three arms need a source edit — apply and re-run:\n');
    for (const [name, how] of ARMS.slice(1)) emit(`[formElement]   ${name.padEnd(24)} ${how}\n`);
    emit('\n[formElement] expected: 0 / 0 / 39 / 0 (guard-on-implied-off, off-off, off-on, on-on)\n');
    emit('[formElement] a 39 in the LAST arm means the guard stopped holding.\n');
  });
});
