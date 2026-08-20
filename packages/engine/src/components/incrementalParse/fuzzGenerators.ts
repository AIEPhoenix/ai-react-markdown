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
  'trailing words settle the line',
  // Prose `<letter` at end of line: a line-truncated "tag" that never gets
  // its `>` — the scanner counts it, then reverts it at the paragraph's
  // blank line (eng-parse-06). Placed LAST in a paragraph often enough by
  // the joiner to end lines.
  'compare a<b',
  // Prose `</letter` at end of line: a line-truncated CLOSING "tag". Never
  // counted — a close tag cannot carry attributes and a line-start `>`
  // is a blockquote, so it can only be prose (2026-08-19 review P1: the
  // corpus had truncated opens only, and the on-the-spot decrement let a
  // boundary cross a still-open `<style>`).
  'closing </b'
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

/** A REAL tag on the same line as a raw opener/terminator: before an
 *  unclosed `<!--` / `<?` (once an accepted under-count edge — the scanner
 *  now masks raw spans and counts tags around them, v2.4.0 review P1/P4),
 *  and a real tag whose closing `>` hides inside a code-span mask
 *  (`<div x="\`">b\``: micromark parses the tag first — review R2(a)). */
const underCountInline = fc.constantFrom(
  '<b>x</b> <!-- trailing opener',
  '<i>y</i> <?php',
  '<details> <?php',
  'a <div x="`">b`'
);

/**
 * Unicode whitespace that JS `trim()`/`\s` strips but micromark does NOT
 * treat as markdown space (only U+0020 / U+0009 are). A line holding only
 * U+3000 or U+00A0 is a paragraph lazy-continuation line for micromark, not
 * a blank line; a fence closer followed by NBSP is not a closer. Both were
 * invisible to every generator (v2.4.1 review P1).
 */
const unicodeBlankArb = fc.constantFrom(
  'foo line\n\u3000\n\u3000\nbar joins the paragraph',
  'nbsp line\n\u00a0\nstill one paragraph',
  '```\ncode\n```\u00a0\nstill inside the fence\n```',
  '$$\nx\n$$\u3000\nstill inside math\n$$',
  // A def rest ending in NBSP is a PARAGRAPH (`[a]` stays a live ref); a
  // U+3000 before a paragraph-inline `<!--` is text, so the comment never
  // closes inside the paragraph and the `<details>` below is a real open
  // block (adversarial review of the first fix).
  '[a]: /u "t"\u00a0',
  '\u3000<!-- c\n<details>\n\n-->'
);

/** A shortcut reference whose label spans a soft line break — micromark
 *  allows it (the label normalizes to `l l`), while a per-line bracket
 *  scan never sees `[…]` closed on one line (v2.4.1 review P1). Paired
 *  with `crossLineDefLabelArb` so a later definition can retarget it. */
const crossLineRefInline = labelArb.map((l) => `see [${l}\n${l}] end`);

/** `[label](bad url)`: the inline resource FAILS micromark's grammar (space
 *  in a bare destination), so `[label]` is a live shortcut reference a later
 *  def retargets — the `(`-follow skip must not release it (v2.4.1 review
 *  follow-up). `[label](/u "t")` is the well-formed control. */
const failedInlineLinkInline = fc
  .tuple(labelArb, fc.boolean())
  .map(([l, ok]) => (ok ? `see [${l}](/u "t") linked` : `see [${l}](bad url) not a link`));

const inlineArb = fc.oneof(
  { weight: 4, arbitrary: plainInline },
  { weight: 1, arbitrary: crossLineRefInline },
  { weight: 1, arbitrary: failedInlineLinkInline },
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

/**
 * Overlapping / divergent terminators (2026-08 project-review P1 family):
 * constructs whose CLOSER shares bytes with the opener (`<!-->`, `<!--->`,
 * `<?>` — CommonMark and parse5 both close them on the spot), plus shapes
 * where micromark's block terminator and parse5's tokenizer disagree
 * (`--!>` closes an HTML comment for parse5 but is not `-->` for
 * CommonMark; a bogus comment `<?x >` closes at the FIRST `>` for parse5
 * but needs `?>` for CommonMark). Each is glued to a REAL `<details>` and a
 * stray terminator line: a scanner that leaves the construct open skips
 * the container and freezes past a parse5-open element (swallow class).
 * The unsettled openers get their `</details>` closer from HTML_CLOSERS
 * with the usual settle bias.
 */
const OVERLAP_OPENERS = ['<!-->', '<!--->', '<?>', '<!--x--!>', '<?x >'] as const;
const overlapTerminatorArb = fc
  .constantFrom(...OVERLAP_OPENERS)
  .map((opener) => `${opener}\n<details>\n${opener.startsWith('<?') ? '?>' : '-->'}`);
/** Same constructs self-contained on one line (resync check: the scanner
 *  must treat them as CLOSED and keep scanning the rest of the line). */
const overlapSettledArb = fc.constantFrom(
  '<!--> after an empty comment',
  '<!---> after an empty comment',
  '<?> after an empty pi',
  '<!--x--!> after a bang-closed comment <b>x</b>',
  // v2.4.0 review shapes: a stray end tag leaving whitespace-only remnant
  // after a closed comment (P2); a tag right after a PI terminator (P1); a
  // stray end tag html block whose dropped-tag remnant merges with the
  // wrap separator (P3).
  '<!-- c --> </s>',
  '<?x?><details>x</details>',
  '</t>\ntext after a stray end tag'
);

/**
 * CommonMark type-1 raw-text blocks (`<script>`/`<style>`/`<textarea>`/
 * `<pre>`): micromark ends them only at the matching end tag; parse5 keeps
 * script/style/textarea content as TEXT (a `<details>` inside is not an
 * element) while `<pre>` is a normal container. The scanner counts tags
 * inside them literally — over-block only — but the family was absent from
 * every generator (2026-08 project review), so the arbiter never saw it.
 */
const rawTextBlockArb = fc.constantFrom(
  '<script>\nlet s = "<details>[a]";\n</script>',
  '<style>\n.x::before { content: "</details>"; }\n</style>',
  '<textarea>\n<!-- not a comment here\n</textarea>',
  '<pre>\n<div>pre content</div>\n</pre>',
  "<script>alert('<div>')</script> same-line close"
);
/** Type-1 block BOUNDARIES, which differ from every other html block:
 *  the block ends at the line holding the literal closer, and a blank line
 *  does NOT end it. Both halves were mismodelled until 2026-08-20 (see
 *  type1BlockFlow.test.ts). The corpus could reach these shapes only when
 *  `sepArb` happened to pick a single `\n` between a raw-text block and a
 *  paragraph, which is why 50k splice samples and 20k direction prefixes
 *  passed for releases on end — bake the shapes in instead of leaving them
 *  to separator luck. Invalid closers (`</script >`, `</script/>`) leave the
 *  block open to EOF and are the second half of the family. */
const type1BoundaryArb = fc.constantFrom(
  '<script>\nlet a = 1;\n</script>\np <div> x </div a="b"> y',
  '<pre>\ncode\n</pre>\np <div> x </div a="b"> y',
  '<style>\n.a{}\n</style>\np <div> x </div a="b"> y',
  '<textarea>\nt\n</textarea>\np <div> x </div a="b"> y',
  '<script>a</script>\np <div> y',
  '<script></script >\n\n```\n```',
  '<script>\nx\n</script/>\n\n<div>\nd\n</div>',
  '<pre>\nx\n</pre >\n\n```\ncode\n```',
  '<script>\nx\n</scripty>\n\n<!-- c -->'
);
/** parse5 RAWTEXT / RCDATA elements that sit in the CommonMark type-6 list
 *  (no hazardVerdict): their content is TEXT to parse5 — a `</div>` inside
 *  must not close anything (2026-08-19 review r2 P1-4). */
const rawTextElementArb = fc.constantFrom(
  '<div>\n<title>\n</div>\n</title>',
  '<div>\n<iframe>\n</div>\n</iframe>',
  '<div>\n<noframes>\n<!-- c -->\n</div>\n</noframes>',
  '<div>\n<xmp>\n</div>\n</xmp>',
  'para <title>x</div>y</title> z'
);

/**
 * parse5 tree-construction quirks no generator carried (v2.4.2 review P1):
 * a stray `</br>` / `</p>` end tag is SYNTHESIZED (`<br>` / empty `<p>`)
 * rather than dropped — the tail-only parse cannot reproduce that; a
 * stray `<td>` outside any table makes the following GFM table's cell text
 * foster-parent to the root and its skeleton vanish.
 */
const treeQuirkArb = fc.constantFrom(
  '</br>',
  '</p>',
  '</br>\ntext after a synthesized br',
  '<!-- c -->\n\n</br>',
  '<td>s</td>\n\n| a |\n| - |',
  '<td>s</td>\n\n| a | b |\n| - | - |\n| 1 | 2 |',
  '<td>s</td>\n\npara\n\n| a |\n| - |',
  '<col>'
);

/** Cross-line tag garbage (oracle review of 2.4.4, pre-existing under-
 *  block): a line ending inside a tag leaves parse5's tokenizer in it, so a
 *  REAL-looking end tag on the next line is attribute garbage up to the
 *  first `>` — the outer element stays open. Open / close / void openers,
 *  a quoted `>`, and the completing `>` on its own line. */
const crossLineTagGarbageArb = fc.constantFrom(
  '<div>\n<div>\n</div\n</div>\n\ntail para',
  '<details>\n<summary>\n</summary\n</details>\n\ntail para',
  '<div>\n<br\n</div>\n\ntail para',
  '<div>\n</br\n</div>\n\ntail para',
  '<span>\n<div>\n</span\n</div\n>\n\ntail para',
  '<div>\ncontent\n</div\n>\n\ntail para',
  '<div>\n<b\ntitle=">"\n</div>\n\ntail para',
  '<div>\n<b class="x"\n</div>\n\ntail para',
  // NOT real html-flow starts (paragraphs): the next line's block is real.
  '</i\n<div>\n\ntail para',
  '<br\n<div>\n\ntail para',
  '</textarea\n<!-- c\n- li\n\ntail para',
  '</i\n<!-- c\n<div\n\ntail para',
  // De-indent out of a list item's html block: the `<div>` is real.
  '- a\n  </div\n<div>\n\ntail para'
);

/** Second review round (2026-08-19 r2): quotes and bogus comments across
 *  the line ending — its own family so the meters see enough of each. */
const danglingQuoteArb = fc.constantFrom(
  // Dangling OPEN quote at the line ending (r2 P1-2): the next line's `>`
  // is a value byte; the outer element stays open. Its own family so the
  // coverage meter clears its floor at any seed.
  '<div>\n<hr title="\n<p></div>\n\ntail para',
  '<div>\n<span class="\n</div>\n\ntail para',
  '<div>\n<b title="\n</div>\n\ntail para'
);
const crossLineQuoteBogusArb = fc.constantFrom(
  // Attributes on the next line with PAIRED quotes: ordinary (r2 P2-3).
  '<div\n  class="a" data-x=\'b\'>\ncontent\n</div>\n\ntail para',
  '<div\n  title=">"\n>\ncontent\n</div>\n\ntail para',
  // parse5 bogus comments (r2 P1-3): `<!` / `</` + non-letter eat to `>`.
  '<div>\n<!\n</div>\n\ntail para',
  '<div>\n<!-\n</div>\n\ntail para',
  '<div>\n</\n</div>\n\ntail para',
  '<div>\n<//\n</div>\n\ntail para',
  '<div>\n<! x > </div>\n\ntail para',
  // Quoted `>` on the tag's own line (close and open); noscript is HTML.
  '<div>\n</div a=">\n\ntail para',
  '<div a="x></div>">\n\ntail para',
  '<div title="a>b" class="c">x</div>\n\ntail para',
  'x <noscript> y <b> z </noscript> w\n\ntail para'
);
/** Type-4 declarations (`<!` + letter) whose `>` terminator lands on a
 *  LATER line, so `declOpen` has to survive the line boundary. The corpus
 *  had no `<!` + letter shape at all: every `<!` form was `<!--`, `<!-`,
 *  `<! x >` or `<![CDATA[`, so the declaration opener and its cross-line
 *  carry were unreachable from fuzz (verified 2026-08-20 by a drop-write
 *  mutant on the carry — it survived the whole 784-test engine suite).
 *  Tags in the body are DATA: counting them would open an element that
 *  reparents later siblings. */
const multiLineDeclArb = fc.constantFrom(
  '<!DOCTYPE\nhtml>\n\ntail para',
  '<div>\n<!ENTITY x\n<details>\n>\n</div>\n\ntail para',
  '<!ATTLIST a\nb "c>d"\n>\ntail para',
  '<div>\n<!NOTATION n\n</div>\n>\n\ntail para'
);
/** CDATA whose `]]>` lands on a LATER line. The only CDATA the corpus had
 *  was self-contained (`selfContainedCdataPi`), so the `c === -1` arm that
 *  carries `cdataOpen` past EOL was unreachable — same drop-write mutant
 *  result as the declaration family. Contrast `<?x >` in OVERLAP_OPENERS,
 *  which does carry `piOpen` across a line, so PI was already covered. */
const multiLineCdataArb = fc.constantFrom(
  '<![CDATA[\n<details>\n]]> trailing prose',
  '<div>\n<![CDATA[\ndata\n]]>\n</div>\n\ntail para',
  '<![CDATA[\na ]] b\n]]>\ntail para',
  '<div>\n<![CDATA[\n</div>\n]]>\n\ntail para'
);
/** parse5 CONSUMES the document-structure tokens — they emit no node and
 *  the text around them merges, which rewrites hast BEFORE the construct.
 *  The scanner poisons the whole document for these (see
 *  DOCUMENT_STRUCTURE_NAMES); the corpus had none of them, and the
 *  under-block that hid there shipped through v2.5.2. Indented and fenced
 *  variants are the control side: there parse5 sees code, not markup, so
 *  the poison must NOT fire. */
const documentStructureArb = fc.constantFrom(
  '<!DOCTYPE html>\n\ntail para',
  '<!doctype html>\n\ntail para',
  '<!DOCTYPE html PUBLIC "x">\n\ntail para',
  '<body>\nx\n</body>\n\ntail para',
  '<head>\nx\n</head>\n\ntail para',
  '<html>\nx\n</html>\n\ntail para',
  '<!DOCTYPE html>\n<html>\n<body>\nx\n</body>\n</html>\n\ntail para',
  '<BODY>\nx\n</BODY>\n\ntail para',
  '    <!DOCTYPE html>\n\ntail para',
  '```html\n<!DOCTYPE html>\n```\n\ntail para'
);
/** Paragraph context: a closing tag with attributes is literal text to
 *  micromark — the `<div>` stays open (own family for its meter). */
const paragraphCloseWithAttrsArb = fc.constantFrom(
  'p <div> x </div a="b"> y\n\ntail para',
  'p <title> x </title a> y\n\ntail para',
  'p <span> x </span class="c"> y\n\ntail para',
  // Alone on a line: not type 7 (a closing tag takes no attributes) and not
  // type 6 (span/b are not type-6 names) — paragraph text either way.
  '<span>\n\n</span a="b">\n\ntail para',
  '<b>\n\n</b a>\n\ntail para'
);

/** RAWTEXT/RCDATA elements parse5 LIFTS out of the flow (`title`,
 *  `noframes`, `iframe`), opened INLINE in a paragraph and spanning a line
 *  ending — the shape that rewrites an already-frozen paragraph. The corpus
 *  had these names only as block-level runs (`rawTextElementArb`), so the
 *  inline cross-line form went unsampled for releases on end. The attribute
 *  close (`</title a>`) is the second half: literal text to micromark, a
 *  real end tag to parse5's tokenizer. */
const inlineRawTextSpanArb = fc.constantFrom(
  'p<title>\n</title>',
  'p <title> x </title a> y\n\n<div>\n<title>\n</div>\n</title>',
  'p<iframe>\ninner\n</iframe>',
  'p<noframes>\n</noframes>',
  'prose <title>\nlifted\n</title> tail',
  'p<iframe> x </iframe a> y'
);

const rawHtmlArb = fc.oneof(
  { weight: 1, arbitrary: treeQuirkArb },
  { weight: 2, arbitrary: crossLineTagGarbageArb },
  { weight: 3, arbitrary: crossLineQuoteBogusArb },
  { weight: 2, arbitrary: multiLineDeclArb },
  { weight: 2, arbitrary: multiLineCdataArb },
  { weight: 2, arbitrary: documentStructureArb },
  { weight: 1, arbitrary: danglingQuoteArb },
  { weight: 1, arbitrary: paragraphCloseWithAttrsArb },
  { weight: 2, arbitrary: fc.constant('<details>\n<summary>t</summary>\nbody prose\n</details>') },
  // APPROX #2 — cross-line self-closing tag stays an over-blocking opener.
  { weight: 2, arbitrary: fc.constant('<embed\n  src="x"\n/>') },
  // APPROX #3 — tags inside a self-contained CDATA / PI still counted.
  { weight: 2, arbitrary: fc.constant('<![CDATA[<div>data</div>]]> trailing prose') },
  { weight: 2, arbitrary: fc.constant('<?instr <b> ?> after the pi') },
  { weight: 2, arbitrary: fc.constant('<!-- a closed comment -->') },
  { weight: 2, arbitrary: overlapSettledArb },
  { weight: 1, arbitrary: rawTextBlockArb },
  { weight: 2, arbitrary: type1BoundaryArb },
  { weight: 1, arbitrary: rawTextElementArb },
  { weight: 2, arbitrary: inlineRawTextSpanArb },
  // Unsettled openers (the assembler may close them later or leave them).
  { weight: 4, arbitrary: fc.constantFrom('<details>', '<!--', '<div') },
  { weight: 2, arbitrary: overlapTerminatorArb }
);

const HTML_CLOSERS: Record<string, string> = {
  '<details>': '</details>',
  '\u3000<!-- c\n<details>\n\n-->': '</details>',
  '<!--': '-->',
  '<div': 'class="x">content</div>',
  ...Object.fromEntries(
    OVERLAP_OPENERS.map((opener) => [`${opener}\n<details>\n${opener.startsWith('<?') ? '?>' : '-->'}`, '</details>'])
  ),
};

/**
 * Link-definition destinations: the valid URL the corpus always had, plus
 * shapes micromark REJECTS (the def line is then a paragraph whose
 * `[label]` stays a live shortcut ref): a bare destination with unbalanced
 * parentheses, a stray `)` at balance zero, an angle destination containing
 * `<`, an unclosed angle destination, and no destination at all (a bare
 * `[label]:` with a quoted "title" after it is VALID — the quotes are the
 * destination). A scanner that registers any of these as a def releases reference
 * taint early (ghost def — 2026-08 project-review P1). `/u(x)y` is the
 * balanced control.
 */
// `/u\\ x`: a backslash escapes only `(`, `)`, `\\` — before a space it is a
// literal and the space ENDS the destination (garbage after → paragraph).
const INVALID_DESTS = ['/u(x', '/u)', '<u<v>', '<u', '/u\\ x', ''] as const;
/** Valid controls next to the invalid shapes: balanced parens, and an
 *  angle destination WITH whitespace (legal — only `<`, `>` and line
 *  endings are forbidden inside the brackets). */
const VALID_ODD_DESTS = ['/u(x)y', '<u v>'] as const;
const crossLineDefLabelArb = labelArb.map((l) => `${l} ${l}`);
const linkDefArb = fc
  .tuple(
    fc.oneof({ weight: 5, arbitrary: labelArb }, { weight: 1, arbitrary: crossLineDefLabelArb }),
    fc.oneof(
      { weight: 5, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: fc.constantFrom(...VALID_ODD_DESTS) },
      { weight: 3, arbitrary: fc.constantFrom(...INVALID_DESTS) }
    ),
    fc.constantFrom('', ' "title"', ' "title\nwraps"')
  )
  .map(
    // APPROX #4 (A2) — a multi-line title breaks the def-chain recognition.
    ([label, dest, title]) =>
      `[${label}]:${dest === null ? ` https://example.com/${label}` : dest ? ` ${dest}` : ''}${title}`
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
  { weight: 1, arbitrary: defListArb },
  { weight: 1, arbitrary: unicodeBlankArb }
);

// --- document assembly ----------------------------------------------------------

// Lone `\r` and CRLF are line endings to micromark too (r2 P1-5: the
// scanner split on `\n` only and a fence opener after `a\r` hid inside a
// paragraph line) — a few of the seams carry them.
const sepArb = fc.constantFrom('\n\n', '\n\n', '\n\n', '\n\n\n', '\n', '\r\r', '\r\n\r\n', '\r', '\r\n');

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
  multiLineDecl: /<!(?:DOCTYPE|ENTITY|ATTLIST|NOTATION)[^>\n]*\n/,
  multiLineCdata: /<!\[CDATA\[\n/,
  documentStructure: /<!(?:DOCTYPE|doctype)|<\/?(?:body|BODY|head|html)>/,
  multiLineDefTitle: /"title\nwraps"/,
  indentedCodeScanned: /^ {4}(?:<details>|\[\^b\])/m,
  underCountEdge: /<\/(?:b|i)> <(?:!--|\?php)/,
  unclosedRawOpener: /<details>(?![\s\S]*<\/details>)|<!--(?![\s\S]*-->)|<div\n/,
  overlappingTerminator: /<!-->|<!--->|<\?>|--!>|<\?x >/,
  invalidLinkDef: /\]:(?: \/u\(x| \/u\)| <u<v>| <u| \/u\\ x)(?:\n| "title)|\]:\n/,
  rawTextBlock: /<(?:script|style|textarea|pre)>/,
  type1Boundary: /<\/(?:script|pre|style|textarea)(?:>\n[a-z<]|[ /y])/,
  proseTruncatedTag: /a<b\n/,
  proseTruncatedClose: /<\/b\n/,
  crossLineTagGarbage:
    /<\/(?:div|summary|br|span)\n<\/(?:div|details)>|<br\n<\/div>|title=">"\n|class="x"\n<\/div>|<\/i\n<|<br\n<div>|<\/textarea\n<!--|- a\n {2}<\/div\n<div>/,
  danglingQuote: /<(?:hr title|span class|b title)="\n/,
  bogusComment: /<div>\n(?:<!|<!-|<\/|<\/\/)\n<\/div>|<! x > /,
  quotedGtOnTagLine: /<\/div a=">|a="x><\/div>"|title="a>b"|<noscript> y <b>/,
  closeWithAttrsInParagraph: /<\/(?:div a="b"|title a|span class="c")> y|\n<\/(?:span a="b"|b a)>/,
  rawTextElement: /<(?:title|iframe|noframes|xmp)>/,
  inlineRawTextSpan: /(?:^|[a-z ])<(?:title|iframe|noframes)>\n|<\/(?:title|iframe) a>/m,
  loneCr: /\r(?!\n)/,
  reviewShapes: /<!-- c --> <\/s>|<\?x\?><details>|<\/t>\ntext|<details> <\?php|x="`">b`/,
  treeQuirks: /<\/br>|<\/p>|<td>s<\/td>\n\n|<col>/,
  unicodeBlank: /\n[\u3000\u00a0]\n|```\u00a0\n|\$\$\u3000\n|"t"\u00a0|\u3000<!--/,
  failedInlineLink: /\]\(bad url\)/,
  crossLineRef: /see \[(?:a|b|spec|注一)\n(?:a|b|spec|注一)\] end/,
};
