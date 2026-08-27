/**
 * `<pre>` is a CommonMark type-1 block and NOT a parse5 raw-text element —
 * the one member of `TYPE1_NAMES` that is absent from `RAW_TEXT_ELEMENTS`.
 *
 * The phantom-opener gate (P4a slice 2) skips the raw-construct openers
 * while an outer TEXT-CONSUMING construct owns the bytes, and its parse5
 * half was justified with "a comment / raw-text content runs to its own
 * terminator". That holds for `script` / `style` / `textarea`; inside
 * `<pre>` parse5 stays in the DATA state, so `<?x` / `<!y` / `<![CDATA[` /
 * `</3` really do open a BOGUS COMMENT — which then eats the `>` of the
 * `</pre>` closer line and leaves the element open, swallowing every later
 * block. Before the gate existed the phantom opener's own first-`>`
 * divergence poison covered this by accident; the gate removed the phantom
 * and the accidental cover with it (F13).
 *
 * The type-1 member carries parse5-rawness now, so the gate asks the
 * member — `pre` is html{1} to micromark and DATA to parse5, and the
 * openers on its lines are scanned like any other paragraph's.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (t: string) => computeFreezeBoundary(t, { defListEnabled: false }).boundary;
const TAIL = '\n\ntail\n\nend\n';

/** Every opener parse5's DATA state acts on, inside a `<pre>` block: the
 *  bogus comment swallows the closer line's `>` and the element survives. */
const PRE_BOGUS: Array<[string, string]> = [
  ['processing instruction', `<pre>\n<?x\n</pre>${TAIL}`],
  ['declaration', `<pre>\n<!y\n</pre>${TAIL}`],
  ['CDATA', `<pre>\n<![CDATA[\n</pre>${TAIL}`],
  ['bogus end tag', `<pre>\n</3\n</pre>${TAIL}`],
  ['mid-line opener', `<pre>\nx <?y\n</pre>${TAIL}`],
  ['opener on the opening line', `<pre> <?x\n</pre>${TAIL}`],
];

/** The three REAL raw-text type-1 names: parse5 reads the same bytes as
 *  element content, both grammars agree, and the boundaries stay exactly
 *  where they were (measured on HEAD before the member gained `raw`). */
const RAW_TEXT_CONTROLS: Array<[string, string, number]> = [
  ['style', `<style>\n<?x\n</style>${TAIL}`, 28],
  ['script', `<script>\n<?x\n</script>${TAIL}`, 30],
  ['textarea', `<textarea>\n<?x\n</textarea>${TAIL}`, 34],
];

describe('type 1 vs parse5 raw text (`<pre>`)', () => {
  test('a bogus-comment opener inside `<pre>` blocks the boundary', () => {
    for (const [name, doc] of PRE_BOGUS) {
      expect({ name, boundary: boundary(doc) }).toEqual({ name, boundary: 0 });
    }
  });

  test('the real raw-text names are untouched', () => {
    for (const [name, doc, expected] of RAW_TEXT_CONTROLS) {
      expect({ name, boundary: boundary(doc) }).toEqual({ name, boundary: expected });
    }
  });

  test('the streamed counterexample matches a full parse frame for frame', () => {
    // 20 of the frames diverged on HEAD: the frozen prefix carried
    // `<pre></pre>` with the tail paragraph as a SIBLING, while the full
    // parse keeps the paragraph INSIDE the still-open `<pre>`.
    const doc = '<pre>\n<?x\n</pre>\n\ntail\n\nend\nmore text\n';
    // F13's fix poisons this shape to boundary 0 — zero engagement is the
    // asserted outcome (the pre-fix engine spliced here and shipped 20
    // divergent frames).
    assertStreamEquivalence('pre bogus opener', scheduleSnapshots(doc, [1]), CATALOG[0], { minIncrementalFrames: 0 });
  }, 30_000);
});

/**
 * F20 — the same gate, disarmed from outside: the mask outliving the grammar
 * that justifies it.
 *
 * The gate's third term is `mdType1RawText(cp.mdBlock)`, whose contract is
 * "the state in which BOTH grammars agree every byte up to the closer is
 * content". `</script/>` breaks the agreement. The `/` is a bogus
 * self-closing flag parse5 ignores, so the element closes for parse5, while
 * CommonMark's type-1 end condition wants the LITERAL `</script>` and the
 * block runs on. From that line the mask hides tags parse5 really acts on —
 * including the `<pre>` and the bogus opener the tests above exist to catch,
 * so F13's poison never arms and the swallow ships:
 *
 *   <script>
 *   </script/>
 *
 *   <pre>
 *   </3
 *   </pre>
 *
 *   t
 *
 * 41 bytes, boundary 39, and the tail lands INSIDE the `<pre>`. Live shipped
 * output, not a raw-layer claim: 100% of the frames that engaged diverged, on
 * three of the six configs (the other three never engage — an aggregate over
 * all six reads 2 of 12 and looks like noise, which is why engagement is
 * counted per config). Pre-existing and byte-identical through v2.8.1 and
 * db9f091; found by the v2.8.2 release gate's oracle leg, shards 5 and 6.
 *
 * F17 fixed the INLINE-opened case of exactly this and exempted the
 * block-opened one, on the ground that "their close is tracked exactly
 * (attribute-bearing end tags included)". That is true of parse5's close and
 * false of micromark's, and the mask asks micromark.
 *
 * (Why a candidate exists at all after the desync: CommonMark's type-1 end
 * condition is "the line contains one of `</script>`, `</pre>`, `</style>`,
 * `</textarea>`" — ANY of the four, not the one that opened. The `</pre>`
 * line is what finally closes the script-opened block.)
 */
describe('the type-1 mask outliving parse5 (F20)', () => {
  /** The CLASS, not the two spellings the fuzzer drew. parse5's end-tag
   *  grammar takes a name then any whitespace, attributes and a bogus
   *  self-closing slash; CommonMark's type-1 end condition is the LITERAL
   *  string `</script>`. Everything parse5 accepts and that literal test
   *  refuses parts the two grammars, and the guard is spelling-agnostic
   *  because it tests the resulting STATE disagreement rather than any of
   *  these shapes. */
  const DESYNC_CLOSERS = [
    '</script/>',
    '</script >',
    '</script foo>',
    '</script\t>',
    '</script//>',
    '</script  bar=1>',
    '</SCRIPT/>',
    'x</script/>y', // mid-line: the block still runs on
  ];
  /** Both spellings that close BOTH grammars on the same line. */
  const BACKED_CLOSERS = ['</script>', '</SCRIPT>'];

  test('a bogus opener behind an unbacked mask blocks the boundary', () => {
    for (const closer of DESYNC_CLOSERS) {
      for (const opener of ['</3', '<?x', '<!y', '<![CDATA[']) {
        const doc = `<script>\n${closer}\n\n<pre>\n${opener}\n</pre>\n\nt\n`;
        expect({ closer, opener, boundary: boundary(doc) }).toEqual({ closer, opener, boundary: 0 });
      }
    }
  });

  /** The opener axis: every type-1 name that IS raw text to parse5 carries
   *  the same disagreement, and the guard reads the member rather than the
   *  name. `pre` is absent on purpose — it is not raw text to parse5, so no
   *  mask is ever on and F13 above owns it. */
  test.each(['script', 'style', 'textarea'])('the disagreement is per member, not per name — %s', (name) => {
    expect(boundary(`<${name}>\n</${name}/>\n\n<pre>\n</3\n</pre>\n\nt\n`)).toBe(0);
    // and the literal close of the same name still freezes
    expect(boundary(`<${name}>\n</${name}>\n\n<pre>\n</3\n</pre>\n\nt\n`)).toBeGreaterThan(0);
  });

  /** The REVERSE disagreement, and why it needs no code here. CommonMark's
   *  end condition accepts ANY of the four literals, so a `</pre>` line
   *  closes a `<script>`-opened block for micromark while parse5's script
   *  data runs on — micromark closed, parse5 open, the mirror of F20. It is
   *  already covered, and the two guards are exactly complementary: F10's
   *  blank-line poison is skipped for type-1 blocks (`!mdHtml(mdBlock, 1)`,
   *  correct — a blank does not end one), which is why F20 exists; and in
   *  the reverse case `mdBlock` is NOT type-1, so F10 fires. A candidate
   *  cannot appear before the first blank, so the blank is the whole
   *  exposure. Pinned so that narrowing either guard shows up here. */
  test('the reverse disagreement is covered by the blank-line poison', () => {
    for (const closer of ['</pre>', '</style>', '</textarea>']) {
      expect({ closer, boundary: boundary(`<script>\n${closer}\n\n<div>\nd\n</div>\n\ntail para\n`) }).toEqual({
        closer,
        boundary: 0,
      });
    }
  });

  test.each(CATALOG)(
    'the 41-byte minimum streams like a full parse — $label',
    (config) => {
      for (const opener of ['</3', '<?x']) {
        const doc = `<script>\n</script/>\n\n<pre>\n${opener}\n</pre>\n\nt\n`;
        assertStreamEquivalence(`F20 ${opener}`, scheduleSnapshots(doc, [1]), config, { minIncrementalFrames: 0 });
      }
    },
    60_000
  );

  /** The two gate reproducers, whole. */
  test('the gate counterexamples stream like a full parse', () => {
    const docs = [
      '<script>\nx\n</script/>\n\n<div>\nd\n</div>\n\n<pre>\n</3\n</pre>\n\ntail para\ntrailing words settle the line, 一段中文散文，含有标点。\rTerm line\n\n:   description body\n',
      'footnote-ish `[^n]` span\n$$\ne = mc^2\n\n$$\n\n<script>\nx\n</script/>\n\n<div>\nd\n</div>\n\n<pre> <?x\n</pre>\n\ntail para\n\n\n$$\ne = mc^2\n$$\n\n\n一段中文散文，含有标点。\n',
    ];
    for (const doc of docs) {
      assertStreamEquivalence('F20 gate', scheduleSnapshots(doc, [1]), CATALOG[0], { minIncrementalFrames: 0 });
    }
  }, 60_000);

  /** The discrimination. A literal `</script>` closes BOTH grammars on the
   *  same line, so the mask is backed and nothing here fires — this is F13's
   *  own fixture, and an earlier draft of the guard broke it by testing the
   *  desync mid-scan, where `mdBlock` is not yet settled. */
  test('a literal close leaves F13 to do its own job', () => {
    for (const closer of BACKED_CLOSERS) {
      expect({ closer, boundary: boundary(`<script>\n${closer}\n\n<pre>\n</3\n</pre>\n\nt\n`) }).toEqual({
        closer,
        boundary: 20,
      });
    }
  });

  /** A truncated `<script` at EOL was forecast as a one-line over-block (the
   *  block opens for micromark while parse5 is still inside the tag).
   *  Measured: it does not happen — pinned so that a later change to the
   *  pending-tag path cannot introduce the cost unnoticed. */
  test('a tag-spanning open costs nothing', () => {
    expect(boundary('<script\n>\nx\n</script>\n\ntail para\n\nmore\n')).toBeGreaterThan(0);
  });

  test('well-formed raw-text blocks still freeze', () => {
    for (const doc of [
      '<script>\nx\n</script>\n\ntail para here\n\nmore prose\n',
      '<style>\nb{}\n</style>\n\ntail para here\n\nmore prose\n',
      '<textarea>\nv\n</textarea>\n\ntail para here\n\nmore prose\n',
    ]) {
      expect({ doc, frozen: boundary(doc) > 0 }).toEqual({ doc, frozen: true });
    }
  });
});
