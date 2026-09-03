/**
 * Classifies a legacy-vs-default output difference of `processSlice` into
 * one of the owner-approved change classes (plan §3.4), or `unclassified`.
 * Shared by the differential gate (`latexSoftAtoms.differential.test.ts`,
 * asserts) and the evidence harness (`latexSoftAtoms.evidence.ts`, reports)
 * so the two cannot disagree about what counts as approved.
 *
 * Every class is keyed on the INPUT's shape, not on the outputs' text, so a
 * regression that happened to produce approved-looking bytes for an input
 * without the class's shape is still caught.
 */
import { splitByProtectedRegions, processSlice, selectMask } from './latex';

export type ChangeClass =
  | 'unchanged'
  | 'pair-across-tag'
  | 'truncation-covers-atoms'
  | 'mid-line-dd-after-atom'
  | 'hard-boundary-line-origin'
  | 'parity-across-tag'
  | 'bracket-across-tag'
  | 'mhchem-split'
  | 'unclosed-tail-across-tag'
  | 'unclassified';

export const CHANGE_CLASSES: readonly ChangeClass[] = [
  'unchanged',
  'pair-across-tag',
  'truncation-covers-atoms',
  'mid-line-dd-after-atom',
  'hard-boundary-line-origin',
  'parity-across-tag',
  'bracket-across-tag',
  'mhchem-split',
  'unclosed-tail-across-tag',
  'unclassified',
];

/** A `$…$` pair or a `$$…$$` pair with a single-line tag between the
 *  delimiters — the shape the fix exists for. */
const INLINE_PAIR_ACROSS_TAG = /\$[^$\n\r]*<\/?[A-Za-z][^>\n\r]*>[^$\n\r]*\$/;
const DISPLAY_PAIR_ACROSS_TAG = /\$\$[\s\S]*?<\/?[A-Za-z][^>\n\r]*>[\s\S]*?\$\$/;
/** A `$$` right after a tag on the same line (spaces allowed). */
const DD_AFTER_TAG = /<\/?[A-Za-z][^>\n\r]*> *\$\$/;
/** A currency-looking `$` followed later on the line by a tag and a `$`. */
const CURRENCY_ACROSS_TAG = /\$\d[^\n\r$]*<\/?[A-Za-z][^>\n\r]*>[^\n\r$]*\$/;

export interface Classification {
  input: string;
  legacy: string;
  soft: string;
  cls: ChangeClass;
  /** Whether the input has neither a soft tag nor a hard boundary — the
   *  narrowed invariance class, in which nothing may change. */
  narrowed: boolean;
}

export function classify(input: string): Classification {
  const legacy = processSlice(input, { legacy: true, probe: false }).out;
  const mask = selectMask(input);
  const soft = mask === null ? legacy : processSlice(input, { probe: false, mask }).out;
  const kinds = new Set(splitByProtectedRegions(input).map((s) => s.kind));
  const hasTag = kinds.has('tag');
  const hasHard = kinds.has('code') || kinds.has('literal') || kinds.has('multilineTag');
  const narrowed = !hasTag && !hasHard;
  if (legacy === soft) return { input, legacy, soft, cls: 'unchanged', narrowed };

  let cls: ChangeClass = 'unclassified';
  if (!hasTag) {
    // No soft atom in play: the only approved no-tag change is the run
    // line origin after a hard boundary (a mid-line `$$` after code).
    if (hasHard && /`[^`]*`[ \t]*\$\$|<\/(?:code|pre|kbd|samp|math|svg)>[ \t]*\$\$/i.test(input)) {
      cls = 'hard-boundary-line-origin';
    }
  } else if (/\\(?:ce|pu)\{/.test(input)) {
    cls = 'mhchem-split';
  } else if (/\\\[[\s\S]*<\/?[A-Za-z][^>]*>[\s\S]*\\\]|\\\([^\n]*<\/?[A-Za-z][^>]*>[^\n]*\\\)/.test(input)) {
    cls = 'bracket-across-tag';
  } else if (CURRENCY_ACROSS_TAG.test(input) && legacy.includes('\\$') !== soft.includes('\\$')) {
    cls = 'parity-across-tag';
  } else if (DD_AFTER_TAG.test(input) && soft.length > legacy.length) {
    cls = 'mid-line-dd-after-atom';
  } else if (soft.length < legacy.length && countTags(soft) < countTags(legacy)) {
    // Truncation now removes the atoms in the unclosed block's tail.
    cls = 'truncation-covers-atoms';
  } else if (INLINE_PAIR_ACROSS_TAG.test(input) || DISPLAY_PAIR_ACROSS_TAG.test(input)) {
    cls = 'pair-across-tag';
  } else if (unclosedBeforeTag(input)) {
    // The analysed text no longer ends at a tag, so an unclosed `$` / `$$`
    // BEFORE the tag now governs what follows it (pipes in the unclosed
    // tail are escaped; a later converted `$x$` pair toggles the `$$`
    // count), where the legacy arm analysed the text after the tag afresh.
    cls = 'unclosed-tail-across-tag';
  }
  return { input, legacy, soft, cls, narrowed };
}

/** Does some text segment that is immediately followed by a soft tag leave
 *  a `$` or a `$$` unclosed (odd count of bare singles, or of doubles)? */
function unclosedBeforeTag(input: string): boolean {
  const segments = splitByProtectedRegions(input);
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i].kind !== 'text' || segments[i + 1].kind !== 'tag') continue;
    const t = segments[i].text;
    let singles = 0;
    let doubles = 0;
    for (let j = 0; j < t.length; j++) {
      if (t[j] !== '$' || (j > 0 && t[j - 1] === '\\')) continue;
      if (t[j + 1] === '$') {
        doubles += 1;
        j += 1;
      } else {
        singles += 1;
      }
    }
    if (singles % 2 === 1 || doubles % 2 === 1) return true;
  }
  return false;
}

function countTags(text: string): number {
  return (text.match(/<\/?[A-Za-z]/g) ?? []).length;
}

export interface Tally {
  total: number;
  changed: number;
  byClass: Record<ChangeClass, number>;
  unclassified: Classification[];
  narrowedChanges: Classification[];
}

export function tally(inputs: Iterable<string>): Tally {
  const byClass = Object.fromEntries(CHANGE_CLASSES.map((c) => [c, 0])) as Record<ChangeClass, number>;
  const t: Tally = { total: 0, changed: 0, byClass, unclassified: [], narrowedChanges: [] };
  for (const input of inputs) {
    const c = classify(input);
    t.total += 1;
    t.byClass[c.cls] += 1;
    if (c.cls !== 'unchanged') {
      t.changed += 1;
      if (c.cls === 'unclassified') t.unclassified.push(c);
      if (c.narrowed) t.narrowedChanges.push(c);
    }
  }
  return t;
}

/** `f(f(x)) !== f(x)` rate for one arm over `inputs`. Not a contract —
 *  nothing re-processes output — recorded because the model raises it. */
export function nonIdempotenceRate(inputs: readonly string[], arm: 'legacy' | 'soft'): number {
  if (inputs.length === 0) return 0;
  let n = 0;
  const f = (x: string): string => {
    if (arm === 'legacy') return processSlice(x, { legacy: true, probe: false }).out;
    const mask = selectMask(x);
    return mask === null
      ? processSlice(x, { legacy: true, probe: false }).out
      : processSlice(x, { probe: false, mask }).out;
  };
  for (const x of inputs) {
    const once = f(x);
    if (f(once) !== once) n += 1;
  }
  return n / inputs.length;
}
