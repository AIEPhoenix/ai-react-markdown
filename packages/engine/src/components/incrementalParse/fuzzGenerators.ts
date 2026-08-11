/**
 * TEST-ONLY generators for the fuzz arbiter (spliceFuzz.test.ts) and the
 * direction battery (boundaryDirection.test.ts).
 *
 * Documents are composed from BLOCK-LEVEL constructs, not random bytes: the
 * detector's hazards are all structural (raw HTML balance, math fences,
 * reference resolution, continuation contexts), so uniform noise would test
 * the trivial "everything blocked / nothing interesting" regimes. Generation
 * is deliberately biased toward the five documented detector approximations
 * (APPROX #1-#5 in computeFreezeBoundary's module docs) and the one accepted
 * under-count edge (same-line tag before an unclosed raw opener).
 *
 * Labels are drawn from one SMALL shared pool so that ref uses and defs
 * collide across independently-drawn blocks — late-definition reach-back
 * (H1) and unresolved-taint regimes emerge naturally without explicit
 * pairing machinery (and shrink well, since blocks stay independent).
 *
 * Anti-vacuity bias (adversarial-review finding): docs carry ≥4 blocks,
 * separators are mostly blank lines, and hazard constructs mostly SETTLE —
 * an unclosed container at the top of a doc keeps the boundary at 0 for
 * every later frame, so a corpus of unclosed docs would exercise nothing
 * but the full-parse fallback. `spliceFuzz.test.ts` asserts aggregate
 * incremental-engagement floors per family to keep this honest.
 */

import fc from 'fast-check';

/** Shared label pool — small on purpose (see module docs). */
const LABELS = ['a', 'b', 'spec', '注一'] as const;

const labelArb = fc.constantFrom(...LABELS);

// --- inline fragments ---------------------------------------------------------

const plainInline = fc.constantFrom(
  'plain prose keeps flowing here',
  'and **bold** with `code` mixed in',
  '一段中文散文,含有标点。',
  'trailing words settle the line'
);

/** APPROX #1 — prose brackets count as reference taint. */
const proseBracketInline = labelArb.map((l) => `see [${l}] maybe, or [${l}][${l}] even ![${l}]`);

/** Code-span masking paths: intra-line pairs (maskable), an unpaired run
 *  (masking disabled for the paragraph), and double-backtick pairing. */
const codeSpanInline = fc.constantFrom(
  'inline `<div>` stays code',
  'a ref `[x]` in a span',
  'footnote-ish `[^n]` span',
  'double ``tick ` inner`` run',
  'an `unpaired run starts here'
);

/** Under-count accepted edge: a REAL tag sitting on the same line BEFORE an
 *  unclosed raw opener (`<!--` / `<?`) — the one place the scanner may
 *  undercount; the arbiter is its safety net. */
const underCountInline = fc.constantFrom('<b>x</b> <!-- trailing opener', '<i>y</i> <?php');

const inlineArb = fc.oneof(
  { weight: 4, arbitrary: plainInline },
  { weight: 2, arbitrary: proseBracketInline },
  { weight: 2, arbitrary: codeSpanInline },
  { weight: 1, arbitrary: underCountInline }
);

// --- block constructs ---------------------------------------------------------

const paragraphArb = fc.array(inlineArb, { minLength: 1, maxLength: 3 }).map((parts) => parts.join(', '));

/** settled=true means the construct closes what it opens. The doc assembler
 *  biases toward settled (adversarial-review: unclosed-at-top keeps the
 *  boundary at 0 and starves the splice path). */
const fencedCodeArb = fc
  .tuple(fc.constantFrom('```', '```ts'), fc.boolean())
  .map(([open, settled]) => `${open}\nconst x = "[a]<div>";\n${settled ? '```' : ''}`);

/** APPROX #5 — indented-code content is still scanned for tags/refs. */
const indentedCodeArb = fc.constantFrom('    <details>[a] scanned literal', '    [^b]: not a real def');

const mathArb = fc.boolean().map((settled) => `$$\ne = mc^2\n${settled ? '$$' : ''}`);

const rawHtmlArb = fc.oneof(
  fc.constant('<details>\n<summary>t</summary>\nbody prose\n</details>'),
  // APPROX #2 — cross-line self-closing tag stays an over-blocking opener.
  fc.constant('<embed\n  src="x"\n/>'),
  // APPROX #3 — tags inside a self-contained CDATA / PI still counted.
  fc.constant('<![CDATA[<div>data</div>]]> trailing prose'),
  fc.constant('<?instr <b> ?> after the pi'),
  fc.constant('<!-- a closed comment -->'),
  // Unsettled openers (the assembler may close them later or leave them).
  fc.constantFrom('<details>', '<!--', '<div')
);

const HTML_CLOSERS: Record<string, string> = {
  '<details>': '</details>',
  '<!--': '-->',
  '<div': 'class="x">content</div>',
};

const linkDefArb = fc.tuple(labelArb, fc.constantFrom('', ' "title"', ' "title\nwraps"')).map(
  // APPROX #4 (A2) — a multi-line title breaks the def-chain recognition.
  ([label, title]) => `[${label}]: https://example.com/${label}${title}`
);

const footnoteDefArb = fc
  .tuple(labelArb, fc.boolean())
  .map(([label, indented]) => `[^${label}]: body text${indented ? '\n\n    indented continuation' : ''}`);

const refUseArb = fc
  .tuple(labelArb, fc.constantFrom('shortcut', 'full', 'footnote'))
  .map(([label, kind]) =>
    kind === 'shortcut'
      ? `prose with [${label}] used`
      : kind === 'full'
        ? `prose [text][${label}] used`
        : `claim[^${label}] made`
  );

const listArb = fc.constantFrom('- tight one\n- tight two', '- loose one\n\n- loose two', '1. ordered\n2. items');

/** Definition-list description line — only meaningful when the defList
 *  config axis is on; under other configs it is a plain paragraph, which is
 *  itself a useful divergence probe. */
const defListArb = fc.constant('Term line\n\n:   description body');

const miscBlockArb = fc.constantFrom(
  '> a quoted line',
  'Setext title\n===',
  '---',
  '| a | b |\n| - | - |\n| 1 | 2 |',
  '## heading'
);

const benignBlockArb = fc.oneof(
  { weight: 5, arbitrary: paragraphArb },
  { weight: 2, arbitrary: listArb },
  { weight: 2, arbitrary: miscBlockArb },
  { weight: 1, arbitrary: fencedCodeArb.filter((b) => b.endsWith('```')) }
);

const hazardBlockArb = fc.oneof(
  { weight: 3, arbitrary: rawHtmlArb },
  { weight: 2, arbitrary: linkDefArb },
  { weight: 2, arbitrary: footnoteDefArb },
  { weight: 2, arbitrary: refUseArb },
  { weight: 1, arbitrary: fencedCodeArb },
  { weight: 1, arbitrary: indentedCodeArb },
  { weight: 1, arbitrary: mathArb },
  { weight: 1, arbitrary: defListArb }
);

// --- document assembly ----------------------------------------------------------

const sepArb = fc.constantFrom('\n\n', '\n\n', '\n\n', '\n\n\n', '\n');

/**
 * Assemble blocks into a document. Unsettled raw-HTML openers are CLOSED by
 * an appended closer with p≈0.8 (settle bias); unclosed fences/math are left
 * as-is only when they land in the final position (elsewhere they'd swallow
 * the rest of the doc into one giant block and starve the splice).
 */
function assembleDoc(blocks: string[], seps: string[], closeRoll: number[]): string {
  const parts: string[] = [];
  blocks.forEach((block, i) => {
    let text = block;
    const closer = HTML_CLOSERS[block];
    if (closer && (closeRoll[i] ?? 0) < 8) {
      text = block === '<div' ? `<div ${closer}` : `${block}\ninner prose\n${closer}`;
    }
    const unterminated = /^(```|\$\$)/.test(text) && !/(```|\$\$)$/.test(text.slice(3));
    if (unterminated && i < blocks.length - 1) {
      text += text.startsWith('```') ? '\n```' : '\n$$';
    }
    parts.push(text);
    if (i < blocks.length - 1) parts.push(seps[i] ?? '\n\n');
  });
  return `${parts.join('')}\n`;
}

export interface FuzzDoc {
  doc: string;
  /** Chunk sizes walked cyclically (code-point aligned) to build snapshots. */
  sizes: number[];
  /** Which CATALOG config to run (mod length at the call site). */
  configIndex: number;
}

const sizesArb = fc.array(
  fc.oneof({ weight: 5, arbitrary: fc.integer({ min: 4, max: 32 }) }, { weight: 1, arbitrary: fc.constant(1) }),
  { minLength: 8, maxLength: 24 }
);

function docFamily(blockArb: fc.Arbitrary<string>, minBlocks: number, maxBlocks: number): fc.Arbitrary<FuzzDoc> {
  return fc
    .tuple(
      fc.array(blockArb, { minLength: minBlocks, maxLength: maxBlocks }),
      fc.array(sepArb, { minLength: maxBlocks, maxLength: maxBlocks }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: maxBlocks, maxLength: maxBlocks }),
      sizesArb,
      fc.nat()
    )
    .map(([blocks, seps, closeRoll, sizes, configIndex]) => ({
      doc: assembleDoc(blocks, seps, closeRoll),
      sizes,
      configIndex,
    }));
}

/** Mostly-benign docs — must keep the splice path HOT (high engagement floor). */
export const benignDocArb: fc.Arbitrary<FuzzDoc> = docFamily(
  fc.oneof({ weight: 4, arbitrary: benignBlockArb }, { weight: 1, arbitrary: hazardBlockArb }),
  4,
  10
);

/** Hazard-dense docs — engagement is legitimately low; only equivalence matters. */
export const hazardDocArb: fc.Arbitrary<FuzzDoc> = docFamily(
  fc.oneof({ weight: 1, arbitrary: benignBlockArb }, { weight: 3, arbitrary: hazardBlockArb }),
  4,
  12
);

/** Cut a document into cumulative append-only snapshots, code-point aligned
 *  (never splits a surrogate pair — matching the production stream contract). */
export function scheduleSnapshots(doc: string, sizes: number[]): string[] {
  const snapshots: string[] = [];
  let offset = 0;
  let i = 0;
  while (offset < doc.length) {
    const take = Math.max(1, sizes[i % sizes.length] ?? 8);
    i += 1;
    let end = Math.min(doc.length, offset + take);
    const last = doc.charCodeAt(end - 1);
    if (end < doc.length && last >= 0xd800 && last <= 0xdbff) end += 1;
    snapshots.push(doc.slice(0, end));
    offset = end;
  }
  return snapshots;
}

/**
 * Generator-coverage meters (Phase 4c): each APPROX family's structural
 * marker, matched against the ASSEMBLED doc text. spliceFuzz asserts a
 * minimum hit count per family across the run, so a future generator edit
 * cannot silently hollow out the adversarial content.
 */
export const COVERAGE_MARKERS: Record<string, RegExp> = {
  proseBracketTaint: /\[(?:a|b|spec|注一)\]/,
  codeSpanMasking: /`(?:<div>|\[x\]|\[\^n\])`/,
  crossLineSelfClosing: /<embed\n/,
  selfContainedCdataPi: /<!\[CDATA\[|<\?instr/,
  multiLineDefTitle: /"title\nwraps"/,
  indentedCodeScanned: /^ {4}(?:<details>|\[\^b\])/m,
  underCountEdge: /<\/(?:b|i)> <(?:!--|\?php)/,
  unclosedRawOpener: /<details>(?![\s\S]*<\/details>)|<!--(?![\s\S]*-->)|<div\n/,
};
