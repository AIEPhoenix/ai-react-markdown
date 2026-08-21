/**
 * Foreign content (`<svg>` / `<math>`) — the branch the corpus never reached.
 *
 * `fuzzGenerators.ts` carried no svg or math element until 2026-08-21, so
 * `inForeignContent()` never returned true under fuzz and neither foreign
 * branch of the scanner — `honoursSelfClosing()` and `htmlRulesApply()` —
 * was ever exercised by the soak battery. Filling the hole took one fuzz
 * shard to produce a counterexample (seed 20260851, shrunk to 58 bytes):
 *
 *   `<svg><b></b><textarea>\nx\n</textarea></svg>\n\n[a]: /u\n\nTerm\n`
 *
 * froze across a paragraph parse5 had swallowed. One root cause, reached two
 * ways: **foreign-content depth was modelled as a name→count bag, and the
 * grammar it approximates is a stack.** parse5's "in foreign content"
 * insertion mode POPS the foreign root when a breakout start tag arrives,
 * and a bag cannot express a pop it never saw, so it reported "still in
 * foreign content" for the whole rest of the run. Downstream:
 *
 *   - `honoursSelfClosing()` honoured a flag parse5 IGNORES, so
 *     `<svg><div></div><a/></svg>` left `<a>` open in parse5 — swallowing
 *     everything after it — while the scanner counted no open element;
 *   - `htmlRulesApply()` kept saying "foreign rules", so a `<textarea>`
 *     after the breakout never set `rawTextOpen`, and the inline raw-text
 *     poison added in v2.5.3 never fired. That is the counterexample above:
 *     a fix from the previous release, bypassed by a stale model.
 *
 * `popForeignRoots()` models the pop. It clears the roots only — the spec
 * pops every foreign element down to the integration point — which leaves
 * `openTotal` at or above parse5's stack depth, the over-blocking side.
 *
 * A third gap was fixed with it: `HTML_INTEGRATION_POINTS` omitted `title`,
 * although an SVG `title` IS an HTML integration point, so `<svg><title>
 * <g/></title></svg>` honoured a self-closing flag that HTML rules ignore.
 * `annotation-xml` remains in the list unconditionally, which is wrong in
 * the safe direction (it is an integration point only when `encoding` is
 * text/html or application/xhtml+xml).
 *
 * What these tests pin, therefore, is not "the deviation is absorbed
 * downstream" — the earlier reading, which the fuzz shard refuted — but that
 * the scanner stops in front of the constructs whose HTML the model cannot
 * follow.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence, runFull } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const HEAD = '```\n```\n\n';
const TAIL = '\n\nTAILPARA\n\nSECOND\n\nTHIRD';
const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}
/** Top-level tag names of a full parse, texts rendered as `#text`. */
const topLevel = (doc: string): string[] =>
  ((runFull(doc, CATALOG[0]) as { hast: { children: HastNode[] } }).hast.children ?? []).map(
    (n) => n.tagName ?? `#${n.type}`
  );

/** Every shape here must stream identically to a full parse. Kept small on
 *  purpose: one schedule per shape, one config — the combinatorial sweep is
 *  the fuzz corpus's job (`foreignContentArb`), and a per-shape product of
 *  configs × schedules is what timed CI out on the v2.5.3 batch. */
const SHAPES: Array<[string, string]> = [
  ['plain self-closing child', '<svg><circle/></svg>'],
  ['multiline root', '<svg>\n<circle/>\n</svg>'],
  ['math with text child', '<math><mi>x</mi></math>'],
  ['self-closing root', '<svg/>'],
  ['unclosed root', '<svg><circle/>'],
  ['inline in a paragraph', 'p <svg><circle/></svg> q'],
  ['breakout then self-closing', '<svg><div></div><a/></svg>'],
  ['breakout then del', '<svg><span></span><del/></svg>'],
  ['math breakout then summary', '<math><p></p><summary/></math>'],
  ['void breakout then anchor', '<svg><br><a/></svg>'],
  ['breakout then title', '<svg><div></div><title>\n</div>\n</title></svg>'],
  ['breakout then script', '<svg><div></div><script>\n<div>\n</script></svg>'],
  ['breakout then textarea', '<svg><b></b><textarea>\n</b>\n</textarea></svg>'],
  ['foreignObject integration point', '<svg><foreignObject><div/></foreignObject></svg>'],
  ['desc integration point', '<svg><desc><g/></desc></svg>'],
  ['svg title (omitted from the list)', '<svg><title><g/></title></svg>'],
  ['annotation-xml with html encoding', '<math><annotation-xml encoding="text/html"><div/></annotation-xml></math>'],
  ['annotation-xml without encoding', '<math><annotation-xml><g/></annotation-xml></math>'],
  ['nested foreign root', '<svg><foreignObject><svg><circle/></svg></foreignObject></svg>'],
  ['table part inside foreign content', '<svg><td/></svg>'],
  ['foreign root inside a div', '<div>\n<svg><circle/></svg>\n</div>'],
  ['foreign root inside raw text', '<script><svg><circle/></script>'],
];

const SCHEDULES = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [7, 3, 5, 2, 6, 4, 8, 1],
];

describe('foreign content', () => {
  test.each(SCHEDULES)(
    'every shape streams like a full parse — schedule %#',
    (...sizes) => {
      for (const [name, shape] of SHAPES) {
        const doc = `${HEAD}${shape}${TAIL}`;
        assertStreamEquivalence(name, scheduleSnapshots(doc, sizes), CATALOG[0]);
      }
    },
    60_000
  );

  test.each(CATALOG)(
    'every shape streams like a full parse — $label',
    (config) => {
      for (const [name, shape] of SHAPES) {
        const doc = `${HEAD}${shape}${TAIL}`;
        assertStreamEquivalence(name, scheduleSnapshots(doc, [4, 4, 4, 1, 4, 4, 4, 1]), config);
      }
    },
    60_000
  );

  /** The deviation itself, stated as parse5 behaviour rather than as scanner
   *  internals: `<a>` really is left open and really does swallow the tail.
   *  If a parse5 upgrade ever stops doing this, the "safe by absorption"
   *  reasoning above needs re-deriving rather than silently holding. */
  test('a breakout tag leaves the following self-closing element open in parse5', () => {
    const swallowed = `${HEAD}<svg><div></div><a/></svg>${TAIL}`;
    // …one `a` element containing everything that follows it, rather than
    // the four top-level siblings the tail would otherwise produce.
    expect(topLevel(swallowed)).toEqual(['pre', '#text', 'p', 'div', 'a']);
    // Without the breakout there is no pop, the self-closing flag holds,
    // and the tail stays at the top level.
    expect(topLevel(`${HEAD}<svg><a/></svg>${TAIL}`)).toEqual([
      'pre',
      '#text',
      'p',
      '#text',
      'p',
      '#text',
      'p',
      '#text',
      'p',
    ]);
  });

  /** After the pop the scanner must NOT freeze past the construct: the
   *  element parse5 leaves open is counted, or the raw-text poison fires.
   *  Before `popForeignRoots()` every one of these froze clean past the
   *  element and into the tail. */
  test('the boundary stops in front of a breakout construct', () => {
    for (const shape of [
      '<svg><div></div><a/></svg>',
      '<svg><span></span><del/></svg>',
      '<svg><div></div><title>\n</div>\n</title></svg>',
      '<svg><b></b><textarea>\nx\n</textarea></svg>',
      // VOID breakout tags never reach `applyTag` — the caller skips them —
      // so the first version of the pop missed `<br>`, `<hr>`, `<img>`,
      // `<embed>` and `<meta>` entirely. Ten of twelve direction shards.
      '<svg><br><a/></svg>',
      '<svg><hr><del/></svg>',
      '<svg><img><a/></svg>',
      '<math><br><summary/></math>',
    ]) {
      const doc = `${HEAD}${shape}${TAIL}`;
      expect({ shape, past: boundary(doc) > HEAD.length + shape.length }).toEqual({ shape, past: false });
    }
  });

  /** The shrunk fuzz counterexample, at its exact size. `[a]: /u` and the
   *  paragraph after it are load-bearing: the definition is what let the
   *  boundary reach the swallowed paragraph in the first place. */
  /** The direction battery's counterexample, verbatim: a void breakout tag
   *  followed by a self-closing HTML element, then ordinary blocks. */
  test('the void-breakout counterexample from soak leg 2', () => {
    const doc =
      '<svg><br><a/></svg>\n\n- tight one\n- tight two\n\nplain prose keeps flowing here\n\n- tight one\n- tight two\n\nplain prose keeps flowing here\n';
    for (const sizes of [
      [4, 4, 4, 1, 4, 4, 4, 4],
      [1, 1, 1, 1, 1, 1, 1, 1],
    ]) {
      assertStreamEquivalence('void breakout', scheduleSnapshots(doc, sizes), CATALOG[0]);
    }
  }, 30_000);

  test('the 58-byte counterexample from seed 20260851', () => {
    const doc = '<svg><b></b><textarea>\nx\n</textarea></svg>\n\n[a]: /u\n\nTerm\n';
    for (const sizes of [
      [4, 4, 4, 4, 4, 4, 4, 4],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [7, 3, 5, 2, 6, 4, 8, 1],
    ]) {
      assertStreamEquivalence('counterexample', scheduleSnapshots(doc, sizes), CATALOG[0]);
    }
  }, 30_000);

  /** A document with no foreign root must be bit-for-bit unaffected by the
   *  pop — the same shapes with `<div>` for `<svg>` keep their old
   *  boundaries. */
  test('documents without a foreign root are untouched', () => {
    expect(boundary('<div><b></b><textarea>\nx\n</textarea></div>\n\n[a]: /u\n\nTerm\n')).toBe(53);
    expect(boundary('<svg><textarea>\nx\n</textarea></svg>\n\n[a]: /u\n\nTerm\n')).toBe(46);
  });

  /** Foreign content must not disturb the poisons that already exist. */
  test('an existing poison still fires inside foreign content', () => {
    // A stray table part outside any table re-routes parse5's tree
    // construction, so freezing must stop BEFORE the construct rather than
    // run past it (the poison here is the candidate rejection, not the
    // document-wide `phasePoisonedAt`, so the boundary halts at the last
    // safe point rather than at zero).
    const strayPart = `${HEAD}<svg><td/></svg>${TAIL}`;
    expect(boundary(strayPart)).toBeLessThanOrEqual(HEAD.length);
    // A document-structure name IS document-wide, foreign root or not.
    expect(boundary(`${HEAD}<svg><body></body></svg>${TAIL}`)).toBe(0);
  });
});
