/**
 * Generators and harness for the entry-point equivalence leg. Shared by
 * `latexEntryEquivalence.fuzz.test.ts` (the gate) and
 * `latexEntryFloor.evidence.ts` (the measurement that set its floors), which
 * is why it is a plain module and not part of either.
 *
 * The property under test lives in the test file; everything here exists to
 * make the property's counterexamples REACHABLE and to prove they were
 * reached. See the test file's header for why the previous generator could
 * not reach them.
 */

import fc from 'fast-check';

import { preprocessLaTeX, createIncrementalLatexPreprocessor } from './latex';
import { scheduleSnapshots } from '../components/incrementalParse/fuzzGenerators';

/* ------------------------------------------------------------------ *
 * Option matrix
 * ------------------------------------------------------------------ */

export interface EntryConfig {
  label: string;
  /** `undefined` = do not pass the option, i.e. the production default
   *  (512). Passing `512` explicitly would pin a literal this file owns
   *  rather than the constant the renderer actually gets. */
  freezeThreshold?: number;
  backoff?: boolean;
}

/**
 * Three cells, and each earns its place:
 *
 *   threshold-0/backoff-off  every call attempts a freeze, so SHORT
 *                            documents exercise the cut rules instead of
 *                            passing vacuously through the fallback. This is
 *                            the cell the `1e0af4e` counterexample needs.
 *   threshold-0/backoff-on   attempts are skipped after a failure, so cuts
 *                            land at different offsets than above.
 *   defaults                 what the renderer ships. Only documents past
 *                            512 active bytes reach its frozen path, which
 *                            is why both families carry a padding axis.
 *
 * Backoff can only freeze LESS, so backoff-off subsumes backoff-on for
 * REACHABILITY; it does not subsume it for the cut OFFSETS, which is the
 * second cell's job.
 */
export const CATALOG: EntryConfig[] = [
  { label: 'threshold-0/backoff-off', freezeThreshold: 0, backoff: false },
  { label: 'threshold-0/backoff-on', freezeThreshold: 0 },
  { label: 'defaults' },
];

/* ------------------------------------------------------------------ *
 * Generators
 * ------------------------------------------------------------------ */

/**
 * The axis the old generator did not have. `opensMathFlow` walks back to the
 * line start and disqualifies the delimiter on any tab or a fourth space, so
 * these straddle that rule with its boundary (3 vs 4 spaces) sampled from
 * both sides. Applied to EVERY line, so the shape is reachable anywhere a
 * line is.
 */
export const INDENTS = ['', ' ', '  ', '   ', '    ', '     ', '        ', '\t', ' \t', '\t ', '  \t  '];

/**
 * Line bodies. Every entry is either a construct whose meaning changes when
 * later bytes arrive (the retroactive-rewrite class: unclosed spans, tags,
 * fences, `\text{`, `\[`, backtick runs) or one that steers the `$` token
 * stream, which the currency rules rewrite — counterexample B5. A bare `''`
 * is a blank line, and load-bearing: a blank line releases the backtick
 * hazard latch.
 */
export const BODIES = [
  '',
  'prose text with $x^2$ inline',
  'settled prose, nothing to see',
  '$$',
  '$$\\int_0^1 x\\,dx$$',
  '$$ E = mc^2',
  '$',
  '$x$',
  '$4.2M revenue',
  '$1,000.50 total',
  'price in US$ today',
  '\\$$x$ each',
  '| a | b |',
  '| --- | --- |',
  '`',
  '``x``',
  '`code $x$`',
  '```',
  '```\nfenced $f',
  '~~~',
  '<span>',
  '</span>',
  '<span title="multi',
  'line $5">',
  '<code>$c$</code>',
  '<pre>$p',
  '</pre>',
  '\\[',
  '\\]',
  '\\(y\\)',
  '\\ce{H2O}',
  '$\\ce{CO2}$',
  '\\text{a_b}',
  '\\text{open',
  '}',
  '!\\[img\\]',
  '\\\\',
];

/** A line that transforms and then settles: it carries a trigger, so the
 *  monotone `hasLatexTrigger` gate is open, and closes everything it opens,
 *  so the slice is quiescent and a cut may land after it. Padding built from
 *  it is how a document reaches the production threshold. */
export const QUIET_LINE = 'settled prose with $x^2$ and \\(y\\) inline, nothing open.';

/** Chunk schedules: cyclic sizes, biased small, with 1 always in reach — a
 *  1-char chunking splits every straddle-able token (`\`+`[`, `<sp`+`an>`,
 *  `$`+`$`, `</co`+`de>`). */
const sizesArb = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: fc.integer({ min: 2, max: 24 }) },
    { weight: 2, arbitrary: fc.constant(1) },
    { weight: 1, arbitrary: fc.integer({ min: 25, max: 96 }) }
  ),
  { minLength: 4, maxLength: 16 }
);

const configIndexArb = fc.integer({ min: 0, max: CATALOG.length - 1 });

/** Mostly no rewind; when there is one it happens at `1/n` of the stream. */
const rewindArb = fc.oneof(
  { weight: 4, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.integer({ min: 2, max: 8 }) }
);

/** Padding is off for most samples — short documents are where the cut rules
 *  are densest — but present often enough that the `defaults` cell, which
 *  needs 512 active bytes before it attempts anything, is not vacuous. */
const padArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant(0) },
  { weight: 2, arbitrary: fc.integer({ min: 10, max: 40 }) }
);

export interface Sample {
  doc: string;
  sizes: number[];
  configIndex: number;
  /** Re-feed an earlier snapshot at `1/rewindAt` of the stream (0 = never).
   *  A discarded-render replay is a non-append and must reset the state. */
  rewindAt: number;
}

const padding = (lines: number, eol: string): string =>
  lines === 0 ? '' : Array.from({ length: lines }, () => QUIET_LINE).join(eol) + eol;

/** Family 1 — line soup under an orthogonal indent axis. Broad: it composes
 *  shapes nobody thought to write down, and it is where the indent axis pays
 *  off, since every line can carry any indent. */
export const soupDocArb: fc.Arbitrary<Sample> = fc
  .record({
    padLines: padArb,
    lines: fc.array(fc.tuple(fc.constantFrom(...INDENTS), fc.constantFrom(...BODIES)), {
      minLength: 2,
      maxLength: 26,
    }),
    crlf: fc.boolean(),
    trailingEol: fc.boolean(),
    sizes: sizesArb,
    configIndex: configIndexArb,
    rewindAt: rewindArb,
  })
  .map(({ padLines, lines, crlf, trailingEol, sizes, configIndex, rewindAt }) => {
    const eol = crlf ? '\r\n' : '\n';
    const body = lines.map(([indent, text]) => indent + text).join(eol) + (trailingEol ? eol : '');
    return { doc: padding(padLines, eol) + body, sizes, configIndex, rewindAt };
  });

/**
 * Family 2 — the conjunction, composed: a head built to freeze, a seam whose
 * indentation is the variable, an opener that engages a whole-string
 * operation, and then MORE CONTENT.
 *
 * The trailing content is not decoration. A first version ended the document
 * at the opener, which put the hazard in the last one or two frames of a
 * long stream and metered six hits in four hundred samples — the shape was
 * right and the observation window was one frame wide. Streaming past the
 * opener also matches the real regime: an unclosed display block with text
 * still arriving behind it.
 *
 * `closes` picks whether the block eventually closes. Both regimes matter —
 * while it is open the stateless run truncates the tail, and when it closes
 * the previously-truncated bytes become correct again, which is the whole
 * reason the seam correction is applied at compose time rather than to the
 * frozen output (B3).
 */
export const seamDocArb: fc.Arbitrary<Sample> = fc
  .record({
    padLines: fc.integer({ min: 1, max: 40 }),
    seamIndent: fc.constantFrom(...INDENTS),
    opener: fc.oneof(
      // Weighted toward `$$`: it is the only opener whose truncation arms
      // the seam flag, and therefore the only one the divergence class needs.
      { weight: 5, arbitrary: fc.constantFrom('$$', '$$ x^2', '$$\\int_0^1') },
      { weight: 2, arbitrary: fc.constantFrom('$', '\\[', '\\text{open') },
      { weight: 1, arbitrary: fc.constantFrom('`', '<span title="a', '<pre>$p', '```') }
    ),
    tailLines: fc.array(fc.tuple(fc.constantFrom(...INDENTS), fc.constantFrom(...BODIES)), {
      minLength: 1,
      maxLength: 12,
    }),
    closes: fc.boolean(),
    crlf: fc.boolean(),
    sizes: sizesArb,
    configIndex: configIndexArb,
    rewindAt: rewindArb,
  })
  .map(({ padLines, seamIndent, opener, tailLines, closes, crlf, sizes, configIndex, rewindAt }) => {
    const eol = crlf ? '\r\n' : '\n';
    const tail = tailLines.map(([indent, text]) => indent + text).join(eol);
    const doc = padding(padLines, eol) + seamIndent + opener + eol + tail + eol + (closes ? '$$' + eol : '');
    return { doc, sizes, configIndex, rewindAt };
  });

/* ------------------------------------------------------------------ *
 * Meters
 * ------------------------------------------------------------------ */

export interface Meters {
  samples: number;
  frames: number;
  rewinds: number;
  /** Samples in which at least one freeze succeeded, by config label. A cell
   *  that never freezes asserted nothing about the frozen path. */
  frozeSamples: Record<string, number>;
  /**
   * Samples that reached the conjunction: a freeze HAS happened and the
   * active region begins with a `$$`, split by whether that delimiter's
   * indentation opens a math flow.
   *
   * Counted per SAMPLE, not per frame. A frame count measures the chunk
   * schedule as much as the corpus — halve the chunk sizes and every frame
   * meter doubles while proving exactly the same thing — so a floor built on
   * frames drifts whenever the schedule distribution is touched. The sample
   * is the unit that corresponds to "this counterexample shape was tried".
   */
  seamSamples: { mathFlow: number; disqualified: number };
}

export const newMeters = (): Meters => ({
  samples: 0,
  frames: 0,
  rewinds: 0,
  frozeSamples: {},
  seamSamples: { mathFlow: 0, disqualified: 0 },
});

/** The active region always begins at a line start — a cut lands after a
 *  `\n` — so classifying its leading `$$` needs only the indent, and the
 *  indent is read the way `opensMathFlow` reads it, by inspecting characters
 *  rather than by a regex that restates the rule. A second model of the same
 *  rule is how the flag and the truncation came apart to begin with. */
const SEAM_DOUBLE_RE = /^([ \t]*)\$\$/;

function classifySeam(active: string): 'mathFlow' | 'disqualified' | null {
  const match = SEAM_DOUBLE_RE.exec(active);
  if (match === null) return null;
  const indent = match[1];
  return !indent.includes('\t') && indent.length <= 3 ? 'mathFlow' : 'disqualified';
}

/* ------------------------------------------------------------------ *
 * The driver
 * ------------------------------------------------------------------ */

/** Thrown on divergence; the test turns it into a fast-check failure and the
 *  evidence harness ignores it (it measures reachability, not correctness). */
export class EntryDivergence extends Error {}

/**
 * Replay one sample, asserting byte-equality at every call, and record what
 * the sample reached. Returns nothing; `meters` is the output.
 */
export function drive(sample: Sample, tag: string, meters: Meters): void {
  const config = CATALOG[sample.configIndex % CATALOG.length];
  // Only `onAttempt` is always passed; it is a test hook that cannot change
  // behaviour. The other two are omitted when undefined so the `defaults`
  // cell runs against the constant the renderer gets.
  let frozenSrc = 0;
  const options: Parameters<typeof createIncrementalLatexPreprocessor>[0] = {
    onAttempt: ({ frozenBytes }) => {
      frozenSrc += frozenBytes;
    },
  };
  if (config.freezeThreshold !== undefined) options.freezeThreshold = config.freezeThreshold;
  if (config.backoff !== undefined) options.backoff = config.backoff;

  const incremental = createIncrementalLatexPreprocessor(options);
  const snapshots = scheduleSnapshots(sample.doc, sample.sizes);
  const rewindIndex = sample.rewindAt === 0 ? -1 : Math.floor(snapshots.length / sample.rewindAt);

  const check = (snapshot: string, note: string): void => {
    const got = incremental(snapshot);
    const want = preprocessLaTeX(snapshot);
    if (got !== want) {
      throw new EntryDivergence(
        `${tag} [${config.label}]${note} byte divergence at len=${snapshot.length}\n` +
          `  doc:         ${JSON.stringify(sample.doc)}\n` +
          `  sizes:       ${JSON.stringify(sample.sizes)}\n` +
          `  snapshot:    ${JSON.stringify(snapshot)}\n` +
          `  stateless:   ${JSON.stringify(want)}\n` +
          `  incremental: ${JSON.stringify(got)}`
      );
    }
    meters.frames++;
  };

  let froze = false;
  const seen = { mathFlow: false, disqualified: false };
  for (let i = 0; i < snapshots.length; i++) {
    check(snapshots[i], '');
    // `frozenSrc` is advanced by `onAttempt` DURING the call above, so after
    // it the value is the frozen prefix that the NEXT frame's tail pass sits
    // behind — which is the region the seam classifier is about.
    if (frozenSrc > 0) {
      froze = true;
      const kind = classifySeam(snapshots[i].slice(frozenSrc));
      if (kind !== null) seen[kind] = true;
    }
    if (i === rewindIndex && i > 0) {
      // A non-append: an older snapshot replayed (a discarded render), then
      // the stream resumes. Byte-equality is owed on every call, these
      // included.
      //
      // The counter is zeroed BEFORE the call, not after. A non-append makes
      // the preprocessor drop its frozen prefix and then, in the same call,
      // possibly freeze again on the older content — so zeroing afterwards
      // discards a freeze that really happened and leaves this mirror
      // reading 0 while the preprocessor sits at some positive offset. The
      // seam classifier slices by this number, so the error would silently
      // point it at the wrong region for the rest of the stream.
      meters.rewinds++;
      frozenSrc = 0;
      check(snapshots[Math.floor(i / 2)], ' [rewind]');
    }
  }
  if (froze) meters.frozeSamples[config.label] = (meters.frozeSamples[config.label] ?? 0) + 1;
  if (seen.mathFlow) meters.seamSamples.mathFlow++;
  if (seen.disqualified) meters.seamSamples.disqualified++;
  meters.samples++;
}
