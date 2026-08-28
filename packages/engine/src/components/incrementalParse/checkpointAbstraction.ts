/**
 * TEST-ONLY abstraction of the freeze scanner's resume state, and the
 * DECLARED domain of that abstraction.
 *
 * It exists for the state-directed search in `spliceExhaustive.test.ts`.
 * Surface enumeration is bounded by token granularity rather than by K —
 * F20's witness is eight line-tokens and 30^8 ≈ 6.6e11 is unreachable at
 * any fundable depth with any alphabet — so the search grows prefixes and
 * keeps a few representatives per NOVEL abstract state instead. Cost then
 * scales with reachable abstract states rather than exponentially with
 * depth.
 *
 * WHY THE DOMAIN LIVES HERE, in a separate file from the search. The whole
 * value of a coverage report is that it names states the corpus never
 * reached, and a search that decides for itself what it should have
 * covered reports 100% by construction. So `SIGNATURE_DOMAIN` is written
 * down independently — from the scanner's TYPE declarations, not from any
 * run — and the search is only allowed to fill it in. The search can
 * FALSIFY this file (observing a value not declared here fails the test)
 * but it can never widen it, which is the direction that matters.
 *
 * The licence for treating the checkpoint as sufficient scan state is
 * already pinned elsewhere: the census's P2 asserts, for every snapshot of
 * every document it sweeps, that a scan resumed from a checkpoint produces
 * the same boundary as a fresh scan. Without that this abstraction would
 * be a guess about what the scanner remembers.
 *
 * WHAT THIS IS NOT: soundness-preserving. Two prefixes with equal abstract
 * signatures can have different hast, so a property can hold on one and
 * fail on the other, and keeping only M representatives per signature can
 * therefore discard a witness. This is a DIRECTED SEARCH — it finds things
 * or it does not — never a proof that a state is safe.
 */

import type { FreezeScanCheckpointInternal } from './computeFreezeBoundary';

/** Bucket an unbounded count the way the review specified: 0, 1, 2, 3+. */
const depthBucket = (n: number): string => (n >= 3 ? '3+' : String(n));

/**
 * The abstraction, field by field. Each entry is one dimension of the
 * signature; `values` is its DECLARED domain, taken from the scanner's own
 * type declarations rather than from observation.
 *
 * Adding a field here widens the search's notion of novelty and therefore
 * the state space it explores; adding a VALUE that cannot occur shows up
 * as a permanently unreached cell, which is why the report cannot tell an
 * alphabet gap from an impossible state on its own. That limit is stated
 * in the report rather than papered over.
 */
export interface SignatureField {
  name: string;
  values: readonly string[];
  of: (cp: FreezeScanCheckpointInternal) => string;
}

/** `MdBlock`'s discriminated union, flattened — `html` carries its type,
 *  and type 1 additionally carries whether the element is raw text to
 *  parse5, which is the distinction F13 and F20 both turn on. */
const mdBlockOf = (cp: FreezeScanCheckpointInternal): string => {
  const b = cp.mdBlock as { kind: string; type?: number; raw?: boolean };
  if (b.kind !== 'html') return b.kind;
  if (b.type === 1) return b.raw === true ? 'html1raw' : 'html1data';
  return `html${b.type}`;
};

/** `P5Tok`'s union plus the flags that change what the tokenizer does
 *  next: whether a raw-text region was opened inline (mid-line), and the
 *  script escape ladder. */
const p5TokOf = (cp: FreezeScanCheckpointInternal): string => {
  const t = cp.p5Tok as { kind: string; openedInline?: boolean; escaped?: boolean; double?: boolean };
  if (t.kind === 'rawText') return t.openedInline === true ? 'rawText:inline' : 'rawText:block';
  if (t.kind === 'script') return `script:${t.escaped === true ? 'e' : '-'}${t.double === true ? 'd' : '-'}`;
  return t.kind;
};

export const SIGNATURE_DOMAIN: readonly SignatureField[] = [
  {
    name: 'mdBlock',
    values: ['none', 'fence', 'math', 'html1raw', 'html1data', 'html2', 'html3', 'html4', 'html5', 'html6', 'html7'],
    of: mdBlockOf,
  },
  {
    name: 'p5Tok',
    values: ['data', 'comment', 'bogus', 'rawText:inline', 'rawText:block', 'script:--', 'script:e-', 'script:ed'],
    of: p5TokOf,
  },
  { name: 'openStack', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.openStack.length) },
  { name: 'tagBalance', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.tagBalance.size) },
  { name: 'openTotal', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.openTotal) },
  { name: 'blankRun', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.blankRun) },
  { name: 'candidates', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.candidates.length) },
  { name: 'defs', values: ['empty', 'some'], of: (cp) => (cp.defs.size === 0 ? 'empty' : 'some') },
  { name: 'footnoteDefs', values: ['empty', 'some'], of: (cp) => (cp.footnoteDefs.size === 0 ? 'empty' : 'some') },
  { name: 'unresolvedRefs', values: ['empty', 'some'], of: (cp) => (cp.unresolvedRefs.length === 0 ? 'empty' : 'some') },
  { name: 'hazardVerdict', values: ['0', '1'], of: (cp) => (cp.hazardVerdict ? '1' : '0') },
  { name: 'prevLineBlank', values: ['0', '1'], of: (cp) => (cp.prevLineBlank ? '1' : '0') },
  { name: 'prevLineWasText', values: ['0', '1'], of: (cp) => (cp.prevLineWasText ? '1' : '0') },
  { name: 'prevLineWasValidDef', values: ['0', '1'], of: (cp) => (cp.prevLineWasValidDef ? '1' : '0') },
  { name: 'prevLineOpenContent', values: ['0', '1'], of: (cp) => (cp.prevLineOpenContent ? '1' : '0') },
  { name: 'tableMaybeOpen', values: ['0', '1'], of: (cp) => (cp.tableMaybeOpen ? '1' : '0') },
  { name: 'containerMaybeOpen', values: ['0', '1'], of: (cp) => (cp.containerMaybeOpen ? '1' : '0') },
  { name: 'paragraphUnpaired', values: ['0', '1'], of: (cp) => (cp.paragraphHasUnpairedRun ? '1' : '0') },
  { name: 'openBracket', values: ['0', '1'], of: (cp) => (cp.openBracket === null ? '0' : '1') },
  { name: 'p5SealPending', values: ['0', '1'], of: (cp) => (cp.p5SealPending ? '1' : '0') },
  { name: 'defBlockMaybeOpen', values: ['0', '1'], of: (cp) => (cp.defBlockMaybeOpen ? '1' : '0') },
  { name: 'fnDefResumable', values: ['0', '1'], of: (cp) => (cp.fnDefResumable ? '1' : '0') },
  {
    name: 'phasePoisoned',
    values: ['none', 'from0', 'fromN'],
    of: (cp) => (cp.phasePoisonedAt === Number.POSITIVE_INFINITY ? 'none' : cp.phasePoisonedAt === 0 ? 'from0' : 'fromN'),
  },
  { name: 'pendingTag', values: ['0', '1'], of: (cp) => (cp.pendingTag === null ? '0' : '1') },
  {
    name: 'truncatedTags',
    values: ['0', '1'],
    of: (cp) => (cp.pendingTruncatedTags.length === 0 ? '0' : '1'),
  },
  {
    name: 'truncatedCloses',
    values: ['0', '1'],
    of: (cp) => (cp.pendingTruncatedCloses.length === 0 ? '0' : '1'),
  },
];

/** The signature string: one field per position, order fixed by the domain
 *  table so two runs of the same corpus produce identical keys. */
export function abstractSignature(cp: FreezeScanCheckpointInternal): string {
  return SIGNATURE_DOMAIN.map((f) => f.of(cp)).join('|');
}

/** The per-field values of one signature, for coverage accounting. */
export function signatureValues(cp: FreezeScanCheckpointInternal): string[] {
  return SIGNATURE_DOMAIN.map((f) => f.of(cp));
}

/**
 * F20's essential chain, as predicates over the abstraction rather than
 * over bytes — declared BEFORE the search runs, so "did it reach the
 * witness" is a question the search answers rather than one its results
 * define.
 *
 * F20 was a scanner member whose contract asserts the two grammars agree
 * while they do not: a type-1 raw-text block that micromark still has open
 * after parse5's tokenizer has left raw text. The fix (`maskUnbacked =
 * mdType1RawText(mdBlock) && !inRawTextTok(p5Tok)`) is a MEMBERSHIP test,
 * which is exactly why it is expressible here.
 *
 * Stage 3 is the one that matters: a bogus-comment opener while the mask
 * is unbacked is the state in which the scanner froze bytes parse5 was
 * still going to reinterpret.
 */
export const F20_CHAIN: readonly { id: string; hit: (v: Record<string, string>) => boolean }[] = [
  { id: '1:type1-rawtext-open', hit: (v) => v.mdBlock === 'html1raw' },
  {
    id: '2:mask-unbacked',
    hit: (v) => v.mdBlock === 'html1raw' && v.p5Tok !== 'rawText:inline' && v.p5Tok !== 'rawText:block' && !v.p5Tok.startsWith('script:'),
  },
  {
    id: '3:bogus-under-mask',
    hit: (v) => v.mdBlock === 'html1raw' && v.p5Tok === 'bogus',
  },
];
