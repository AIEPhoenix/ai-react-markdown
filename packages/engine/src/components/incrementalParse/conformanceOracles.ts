/**
 * TEST-ONLY conformance oracles (two-model plan P1). The layer oracles
 * judge the scanner's boundary DIRECTLY — `computeFreezeBoundary`'s
 * number — and the engine probe compares shipped output on EVERY frame,
 * never gated on `usedIncremental`; nothing here inherits the mask of
 * `spliceTrees` returning null and falling back to the full path
 * (lie-mode 3).
 *
 * The contract under test is the identity
 *
 *     raw(prefix ++ tail) === raw(prefix) ++ raw(tail)   for every tail
 *
 * with one structural caveat, measured while building this module: the
 * system's safety contract is the scanner's boundary PLUS the splice-side
 * guards in `spliceParse` (`headRoutedCaptureUnclosed`, the stray-tag
 * bail, blocker-6 seam synthesis). The bare node-list identity at the
 * scanner's boundary diverges for tails the splice legitimately REFUSES —
 * e.g. any `<td>` tail after any paragraph prefix, because a tail-alone
 * fragment parse still starts "in template" while the full parse popped to
 * "in body" (the F8 family). So the instruments split by authority:
 *
 * - **Engine probe (authoritative)** — stream `doc` then `doc + tail`
 *   through the real engine and deep-equal frame 2 against a fresh full
 *   parse, positions included. A mismatch here is a DEFECT: shipped output
 *   differs from a full parse. The comparison is never gated on
 *   `usedIncremental` (lie-mode 3); the flag is reported so fallback-only
 *   probes are visible as proving nothing.
 * - **(M) span oracle (attribution)** — for every line start inside the
 *   frozen region, the set of mdast spans covering it must survive the
 *   probe being appended. In sweeps it is SNAPSHOT-anchored —
 *   `parse(doc)` vs `parse(doc + probe)` — because the scanner grants a
 *   boundary given every confirmed line of the snapshot (see
 *   `mSpanDisagreement`'s doc for the bad-oracle finding that forced
 *   this). Spans, not node types: micromark emits `htmlFlow` without
 *   distinguishing types 1–7, and the safety condition cares about the
 *   division alone. Probe tails are load-bearing here, not optional: on
 *   exactly the constructs blockers 3/4/5 exist for, an oracle that never
 *   appends agrees with the scanner FOR THE SAME WRONG REASON
 *   (lie-mode 1).
 * - **(P) identity oracles (design instruments)** — DIFFERENTIAL, not
 *   introspective: the hast of `prefix ++ tail` versus the hast of
 *   `prefix` followed by the hast of `tail` rebased into document
 *   coordinates, at the raw() layer and at the final layer. No field list
 *   of parse5's `Parser` to get wrong (`formElement` is the standing
 *   proof that the field enumeration does not close); a field dump is
 *   diagnostic material for explaining a failure, never the pass/fail
 *   criterion. These state the PREFIX-ANCHORED ideal identity, which
 *   overclaims at evidence-dependent boundaries, so sweeps run them only
 *   behind `idealIdentity` (exploratory); their home ground is hand
 *   fixtures, where a firing is real and an engine-clean firing is
 *   classification material (refused tail, seam-absorbed,
 *   sanitize-masked).
 *
 * Furniture the identity legitimately excludes, and why each exclusion is
 * sound:
 *
 * - The GFM footnote section is hoisted to document end by remark-rehype,
 *   so its POSITION moves with every append by design. It is stripped from
 *   both sides; the machinery that keeps footnote CONTENT correct across
 *   the splice is injection replay, pinned by `assertStreamEquivalence`.
 *   Reference retargeting inside the body — the (R) dimension — is NOT
 *   stripped: an orphan `[^x]` flipping to a sup link is a body diff.
 * - remark-rehype separates root children with `\n` text nodes. The split
 *   side lacks exactly one, at the seam; the comparison inserts it. Everything
 *   else — including whitespace-only text nodes inside the prefix region,
 *   which is where the erasure families (F9/F11/F12) manifest — is
 *   compared strictly, positions included.
 *
 * One oracle limitation is structural and recorded here rather than fixed:
 * both oracles run over whatever corpus they are handed, and every corpus
 * this repo owns was selected by surviving ALL CLEAN runs. A green sweep
 * under-reports by construction (lie-mode 2); it is a regression net, not
 * a safety argument.
 *
 * @module components/incrementalParse/conformanceOracles
 */

import isEqual from 'lodash-es/isEqual';
import rehypeRaw from '@ai-markdown/rehype-raw';

import { parseStage, transformStage } from '../markdown';
import { runFull } from './spliceArbiterHarness';
import { buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { advanceIncrementalParse } from './advanceIncrementalParse';

interface PosPoint {
  line: number;
  column: number;
  offset?: number;
}

interface NodeLike {
  type: string;
  value?: string;
  children?: NodeLike[];
  position?: { start: PosPoint; end: PosPoint };
  properties?: Record<string, unknown>;
}

// ── (M) span oracle ─────────────────────────────────────────────────────

/** Every positioned span in the tree, any depth. Collecting everything is
 *  deliberate: a safe boundary means the prefix's parse is byte-for-byte
 *  stable, so extra depth adds sensitivity without false positives. */
function collectSpans(node: NodeLike, out: Array<[number, number]>): void {
  if (!node.children) return;
  for (const child of node.children) {
    const s = child.position?.start?.offset;
    const e = child.position?.end?.offset;
    if (s !== undefined && e !== undefined) out.push([s, e]);
    collectSpans(child, out);
  }
}

function spansCovering(spans: Array<[number, number]>, offset: number): string {
  const hit = spans.filter(([s, e]) => s <= offset && offset < e);
  hit.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hit.map(([s, e]) => `${s}-${e}`).join(',');
}

function lineStarts(prefix: string): number[] {
  const starts = [0];
  for (let i = 0; i < prefix.length - 1; i++) {
    if (prefix.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/**
 * (M): compare the covering-span set at every line start below `boundary`
 * between `parse(base)` and `parse(base + tail)`. Returns a description of
 * the first disagreement, or null.
 *
 * The anchoring matters (T1.5 bad-oracle finding, 2026-08-24): the scanner
 * grants a boundary GIVEN every confirmed line of the snapshot — blockers
 * 3/4 settle candidates on evidence PAST the boundary — and the engine
 * cuts the SNAPSHOT's parse at the boundary, never a parse of the bare
 * prefix. Sweeps must therefore pass `base = the whole snapshot` and
 * `boundary = the granted boundary`; passing `base = prefix` asserts a
 * strictly stronger claim the scanner never made, and fires uniformly on
 * every evidence-dependent boundary. The prefix-anchored form is still the
 * right instrument for HAND fixtures, where the pair is chosen so the
 * claim and the instrument coincide.
 */
export function mSpanDisagreement(
  base: string,
  tail: string,
  config: CatalogConfig,
  baseMdast?: NodeLike,
  boundary = base.length
): string | null {
  const mp = baseMdast ?? (runFull(base, config).mdast as NodeLike);
  const mf = runFull(base + tail, config).mdast as NodeLike;
  const spansP: Array<[number, number]> = [];
  const spansF: Array<[number, number]> = [];
  collectSpans(mp, spansP);
  collectSpans(mf, spansF);
  for (const L of lineStarts(base.slice(0, boundary))) {
    const a = spansCovering(spansP, L);
    const b = spansCovering(spansF, L);
    if (a !== b) {
      return `M: line start ${L} covered by [${a || 'nothing'}] in parse(base) but [${b || 'nothing'}] in parse(base+tail)`;
    }
  }
  return null;
}

// ── (P) pipeline oracle ─────────────────────────────────────────────────

function isFootnoteSection(node: NodeLike): boolean {
  // `dataFootnotes` is `true` from mdast-util-to-hast but `''` once
  // rehype-raw has reserialized the attribute — presence is the signal.
  return node.type === 'element' && node.properties !== undefined && 'dataFootnotes' in node.properties;
}

function stripFurniture(children: NodeLike[]): NodeLike[] {
  const out: NodeLike[] = [];
  for (const child of children) {
    if (isFootnoteSection(child)) {
      // The separator text node remark-rehype put BEFORE the section is
      // furniture of the furniture — drop the pair, not just the section.
      const prev = out[out.length - 1];
      if (prev?.type === 'text' && /^\s*$/.test(prev.value ?? '')) out.pop();
      continue;
    }
    out.push(child);
  }
  return out;
}

function rebaseNode(node: NodeLike, byOffset: number, byLine: number): NodeLike {
  const clone: NodeLike = { ...node };
  if (node.position) {
    // Seam-adjacent raw text can carry PARTIAL positions (an `end` with no
    // `start` — measured); key presence must survive the rebase exactly,
    // because the comparison is a strict deep-equal.
    const shift = (p: PosPoint | undefined): PosPoint | undefined =>
      p === undefined || typeof p.line !== 'number'
        ? p
        : { ...p, line: p.line + byLine, ...(p.offset !== undefined ? { offset: p.offset + byOffset } : {}) };
    const rebased: Record<string, PosPoint | undefined> = {};
    if ('start' in node.position) rebased.start = shift(node.position.start);
    if ('end' in node.position) rebased.end = shift(node.position.end);
    clone.position = rebased as never;
  }
  if (node.children) {
    clone.children = node.children.map((c) => rebaseNode(c, byOffset, byLine));
  }
  return clone;
}

/** hast for `content` through the production chain truncated after
 *  `rehype-raw` — the raw() layer the identity is stated over. Everything
 *  before the truncation (remark chain, remark-rehype options, the
 *  `rehype-raw` config) is the production assembly, so a divergence here is
 *  a real parse5-layer divergence, merely one sanitize may later mask. */
function runToRawLayer(content: string, config: CatalogConfig): NodeLike {
  const options = buildAdvanceOptions(config);
  const parsed = parseStage({
    children: content,
    remarkPlugins: options.remarkPlugins,
    rehypePlugins: [[rehypeRaw, { passThrough: [] }]] as never,
    remarkRehypeOptions: options.remarkRehypeOptions,
  });
  return transformStage(parsed) as unknown as NodeLike;
}

function identityDisagreement(
  layer: string,
  prefix: string,
  left: NodeLike,
  full: NodeLike,
  right: NodeLike
): string | null {
  // Count line ENDINGS the way micromark does (`\r\n`, `\n`, lone `\r`) —
  // the tail's line numbers shift by exactly this many.
  const prefixLines = (prefix.match(/\r\n|\r|\n/g) ?? []).length;

  const leftKids = stripFurniture(left.children ?? []);
  const rightKids = stripFurniture(right.children ?? []).map((k) => rebaseNode(k, prefix.length, prefixLines));
  const expected = [...leftKids];
  if (leftKids.length > 0 && rightKids.length > 0) {
    // remark-rehype's root-child separator; the only synthesized node.
    expected.push({ type: 'text', value: '\n' });
  }
  expected.push(...rightKids);
  const actual = stripFurniture(full.children ?? []);

  if (isEqual(actual, expected)) return null;
  const max = Math.max(actual.length, expected.length);
  for (let i = 0; i < max; i++) {
    if (!isEqual(actual[i], expected[i])) {
      return (
        `${layer}: root child ${i} of ${actual.length}/${expected.length} — ` +
        `full=${JSON.stringify(actual[i])?.slice(0, 240)} ` +
        `split=${JSON.stringify(expected[i])?.slice(0, 240)}`
      );
    }
  }
  return `${layer}: children equal pairwise but roots differ (length bookkeeping)`;
}

/**
 * (P) at the FINAL-hast layer: what a divergence would actually ship.
 * `prefix` must end with a newline (every scanner candidate sits just after
 * a blank line's ending, so this holds for all real boundaries — asserted,
 * because the line-offset rebase is only exact under it).
 */
export function pipelineIdentityDisagreement(
  prefix: string,
  tail: string,
  config: CatalogConfig,
  prefixHast?: NodeLike
): string | null {
  if (!/[\n\r]$/.test(prefix)) throw new Error('pipelineIdentityDisagreement: prefix must end at a line ending');
  const left = prefixHast ?? (runFull(prefix, config).hast as NodeLike);
  const full = runFull(prefix + tail, config).hast as NodeLike;
  const right = runFull(tail, config).hast as NodeLike;
  return identityDisagreement('P-final', prefix, left, full, right);
}

/**
 * (P) at the raw() layer, BEFORE sanitize: the layer the contract is stated
 * over. Sanitize masks real parse5 divergences — the `formElement`
 * counterexample survives to the final hast as equal output ONLY because
 * `form` is not in the default schema and its children are lifted, and
 * `sanitizeSchema` is a public prop — so a green final-hast check alone
 * proves less than it appears to.
 */
export function rawLayerIdentityDisagreement(prefix: string, tail: string, config: CatalogConfig): string | null {
  if (!/[\n\r]$/.test(prefix)) throw new Error('rawLayerIdentityDisagreement: prefix must end at a line ending');
  const left = runToRawLayer(prefix, config);
  const full = runToRawLayer(prefix + tail, config);
  const right = runToRawLayer(tail, config);
  return identityDisagreement('P-raw', prefix, left, full, right);
}

// ── probe battery ───────────────────────────────────────────────────────

export interface ProbeTail {
  id: string;
  tail: string;
}

/**
 * The battery every boundary is tested against. Static entries cover the
 * plan's minimum (plain text, paragraph, `<form>`, a table part, a
 * definition, the empty tail) plus one probe per cross-blank construct
 * family in Table D; dynamic entries collide with material the prefix
 * actually contains — an element name it opened, a bracket label it used —
 * because collision is what the static battery cannot know in advance.
 */
export function probeTailsFor(prefix: string): ProbeTail[] {
  const tails: ProbeTail[] = [
    { id: 'empty', tail: '' },
    { id: 'plain', tail: 'probe tail text\n' },
    { id: 'paragraph', tail: 'probe para one\n\nprobe para two\n' },
    { id: 'form', tail: '<form>b</form>\n' },
    { id: 'tablePart', tail: '<td>cell</td>\n' },
    { id: 'gfmTable', tail: '| a | b |\n| - | - |\n| c | d |\n' },
    { id: 'definition', tail: '[zz-probe]: /probe\n' },
    { id: 'footnoteDef', tail: '[^zz-probe]: probe body\n' },
    { id: 'defListClaim', tail: ': probe description\n' },
    { id: 'setext', tail: '===\n' },
    { id: 'lazy', tail: ' lazy continuation line\n' },
    { id: 'indentedCode', tail: '    probe indented code\n' },
    { id: 'fence', tail: '```\nprobe\n```\n' },
    { id: 'htmlKeepOpen', tail: '<div>probe\n' },
  ];
  const lastTag = [...prefix.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)/g)].at(-1)?.[1];
  if (lastTag) {
    tails.push({ id: `collideTag:${lastTag}`, tail: `<${lastTag}>probe</${lastTag}>\n` });
  }
  const label = /\[([^\]\n^][^\]\n]{0,30})\]/.exec(prefix)?.[1];
  if (label && !label.includes('[')) {
    tails.push({ id: `collideDef:${label}`, tail: `[${label}]: /probe\n` });
  }
  const fnLabel = /\[\^([^\]\n]{1,30})\]/.exec(prefix)?.[1];
  if (fnLabel) {
    tails.push({ id: `collideFootnote:${fnLabel}`, tail: `[^${fnLabel}]: probe body\n` });
  }
  return tails;
}

// ── two-frame engine probe (the authoritative shipped-behavior check) ───

/**
 * Stream `baseDoc` then `baseDoc + tail` through the REAL engine and
 * deep-equal frame 2's `{mdast, hast}` against a fresh full parse. The
 * comparison always runs — never gated on `usedIncremental` (lie-mode 3);
 * the flag is reported so a probe that only ever exercises the fallback is
 * visible as such rather than silently proving nothing.
 *
 * This is the authoritative (P) verdict because the system's safety
 * contract is scanner boundary PLUS the splice-side guards
 * (`headRoutedCaptureUnclosed`, the stray-tag bail, seam synthesis): a
 * bare node-list identity at the scanner's boundary diverges for tails the
 * splice legitimately refuses — measured: a `<td>` tail diverges after ANY
 * paragraph prefix, because the tail-alone fragment parse still starts "in
 * template" while the full parse popped to "in body" (the F8 family).
 */
export function engineProbe(
  baseDoc: string,
  tail: string,
  config: CatalogConfig
): { disagreement: string | null; usedIncremental: boolean } {
  const options = buildAdvanceOptions(config);
  const first = advanceIncrementalParse(null, baseDoc, options);
  const second = advanceIncrementalParse(first.nextState, baseDoc + tail, options);
  const expected = runFull(baseDoc + tail, config);
  let disagreement: string | null = null;
  if (!isEqual(second.mdast, expected.mdast)) {
    disagreement = `engine: mdast mismatch at frame 2 (boundary=${second.boundary})`;
  } else if (!isEqual(second.hast, expected.hast)) {
    disagreement = `engine: hast mismatch at frame 2 (boundary=${second.boundary})`;
  }
  return { disagreement, usedIncremental: second.usedIncremental };
}

// ── boundary-driven sweep ───────────────────────────────────────────────

export interface OracleFinding {
  probeId: string;
  boundary: number;
  /** `defect` = the shipped engine output differs from a full parse.
   *  `info` = a layer instrument fired while the engine stayed correct —
   *  T1.5 classification material (refused tail, seam-absorbed, or
   *  sanitize-masked), never a pass/fail signal by itself. */
  severity: 'defect' | 'info';
  detail: string;
}

export interface OracleSweepStats {
  probesRun: number;
  incrementalProbes: number;
}

/**
 * Probe one document's scanner claim from every side. Append-only is
 * respected throughout: probe tails are appended to the WHOLE document
 * (the scanner granted its boundary GIVEN the document's confirmed lines —
 * replacing the real continuation would test a stream the scanner never
 * approved, and blocker 4's next-line settle makes that a false positive
 * by construction). To also stress the boundary at zero distance, the
 * claimed prefix is recursed on once as a document of its own: whatever
 * boundary the scanner grants THERE has probes landing directly on it.
 *
 * Returns every finding; an empty array is "no disagreement on this
 * corpus", never "safe" (lie-mode 2).
 */
export function oracleCheckDoc(
  doc: string,
  config: CatalogConfig,
  stats?: OracleSweepStats,
  depth = 0,
  options?: { idealIdentity?: boolean }
): OracleFinding[] {
  const { defListEnabled } = buildAdvanceOptions(config);
  const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
  if (boundary <= 0) return [];
  const prefix = doc.slice(0, boundary);
  const realTail = doc.slice(boundary);
  const probes = probeTailsFor(prefix);
  const docRun = runFull(doc, config);
  const findings: OracleFinding[] = [];

  for (const probe of [{ id: 'realTailOnly', tail: '' }, ...probes]) {
    const engine = engineProbe(doc, probe.tail, config);
    if (stats) {
      stats.probesRun += 1;
      if (engine.usedIncremental) stats.incrementalProbes += 1;
    }
    if (engine.disagreement !== null) {
      findings.push({ probeId: probe.id, boundary, severity: 'defect', detail: engine.disagreement });
    }
    // (M), snapshot-anchored: the frozen region's spans must survive the
    // probe being appended to the snapshot the boundary was granted on.
    const m = mSpanDisagreement(doc, probe.tail, config, docRun.mdast as NodeLike, boundary);
    if (m !== null) {
      findings.push({
        probeId: probe.id,
        boundary,
        severity: engine.disagreement === null ? 'info' : 'defect',
        detail: m,
      });
    }
    // The prefix-anchored ideal identity overclaims at evidence-dependent
    // boundaries (see mSpanDisagreement's doc), so in sweeps it is opt-in
    // exploratory instrumentation, not a default signal.
    if (options?.idealIdentity) {
      const r = rawLayerIdentityDisagreement(prefix, realTail + probe.tail, config);
      if (r !== null) {
        findings.push({
          probeId: probe.id,
          boundary,
          severity: engine.disagreement === null ? 'info' : 'defect',
          detail: r,
        });
      }
    }
  }

  // Zero-distance variant: the claimed prefix as its own document.
  if (depth === 0 && prefix.length < doc.length) {
    findings.push(...oracleCheckDoc(prefix, config, stats, 1, options));
  }
  return findings;
}
