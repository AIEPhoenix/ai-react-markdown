#!/usr/bin/env node
/**
 * The corpus gate. Every claim this package makes about coverage is checked
 * here against the tool that would actually render it.
 *
 * Three checks, and each exists because the alternative is a corpus that
 * looks comprehensive and is not:
 *
 *  1. MERMAID PARSES. Every case goes through the installed `mermaid.parse`.
 *     Several of the 31 registered types are beta and their grammar moves
 *     between minors; without this, an upgrade turns a diagram into a
 *     rendered error box and every benchmark keeps reporting a number.
 *
 *  2. MATH RENDERS. Every generated fragment goes through KaTeX with
 *     `throwOnError`. The generator already filtered on this, so a failure
 *     here means the checked-in file and the installed KaTeX have diverged —
 *     which is exactly what a dependency bump does.
 *
 *  3. THE GENERATED FILE IS IN SYNC. Re-derives the math corpus and compares
 *     byte-for-byte with what is checked in. A stale generated file is the
 *     failure mode that hides the other two: it would keep passing checks 1
 *     and 2 against the OLD identifier set while the installed KaTeX has a
 *     new one.
 *
 * Run with `pnpm --filter @bench/corpus validate`.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);

let failed = 0;
const fail = (msg) => {
  failed += 1;
  process.stdout.write(`[corpus] FAIL ${msg}\n`);
};

// ── 1. mermaid ────────────────────────────────────────────────────────────

const { MERMAID_CASES, MERMAID_TYPES } = await import('../src/mermaid/diagrams.ts');

/**
 * mermaid needs a DOM even to PARSE, because it sanitises label text through
 * DOMPurify on the way in. A bare-node run reports
 * `DOMPurify.sanitize is not a function` for every diagram that has a label —
 * which reads exactly like a corpus error and is not one. The first version
 * of this gate looked green against a label-free `A-->B` and would have gone
 * on looking green while validating nothing.
 *
 * Installed before importing mermaid: the module captures `window` at load.
 */
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator ??= dom.window.navigator;
globalThis.DOMPurify = undefined;

const mermaid = (await import('mermaid')).default;
const mermaidVersion = JSON.parse(
  readFileSync(join(dirname(require.resolve('mermaid/package.json')), 'package.json'), 'utf8')
).version;

mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

const seenIds = new Set();
for (const c of MERMAID_CASES) {
  if (seenIds.has(c.id)) fail(`mermaid: duplicate id ${c.id}`);
  seenIds.add(c.id);
  try {
    await mermaid.parse(c.src);
  } catch (e) {
    fail(
      `mermaid ${c.id} (${c.type}): ${String(e.message ?? e)
        .split('\n')[0]
        .slice(0, 120)}`
    );
  }
}
process.stdout.write(
  `[corpus] mermaid ${mermaidVersion}: ${MERMAID_CASES.length} cases across ${MERMAID_TYPES.length} types\n`
);

/**
 * Coverage against what mermaid REGISTERS, not against a number written by
 * hand. The registry is the only thing that knows when a version adds a type,
 * and a corpus that tracks a hand-copied list would go quietly out of date on
 * exactly the upgrade that matters.
 */
const registered = (() => {
  const dir = join(dirname(require.resolve('mermaid/package.json')), 'dist/diagrams');
  const { readdirSync } = require('node:fs');
  // `common` and `error` are infrastructure, not diagram types a document can
  // name; `globalStyles.d.ts` is a file, not a directory.
  const infra = new Set(['common', 'error']);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !infra.has(e.name))
    .map((e) => e.name);
})();

/** mermaid's directory names and its keyword names differ (`user-journey` is
 *  written `journey`, `sequence` is `sequenceDiagram`). Mapped explicitly so a
 *  mismatch is a decision rather than a silent pass. */
const DIR_TO_TYPE = {
  architecture: 'architecture',
  block: 'block-beta',
  c4: 'C4Context',
  class: 'classDiagram',
  cynefin: 'cynefin',
  er: 'erDiagram',
  eventmodeling: 'eventmodeling',
  flowchart: 'flowchart',
  gantt: 'gantt',
  git: 'gitGraph',
  info: 'info',
  ishikawa: 'ishikawa',
  kanban: 'kanban',
  mindmap: 'mindmap',
  packet: 'packet',
  pie: 'pie',
  'quadrant-chart': 'quadrantChart',
  radar: 'radar-beta',
  railroad: 'railroad',
  requirement: 'requirementDiagram',
  sankey: 'sankey-beta',
  sequence: 'sequenceDiagram',
  state: 'stateDiagram-v2',
  // The directory is plural; the id mermaid registers is singular.
  swimlanes: 'swimlane',
  timeline: 'timeline',
  treemap: 'treemap',
  treeView: 'treeView',
  'user-journey': 'journey',
  venn: 'venn',
  wardley: 'wardley',
  xychart: 'xychart-beta',
};

const covered = new Set(MERMAID_TYPES);
const uncovered = registered.filter((d) => {
  const t = DIR_TO_TYPE[d];
  if (t === undefined) {
    fail(`mermaid: registered diagram '${d}' has no entry in DIR_TO_TYPE — add it, then cover it`);
    return false;
  }
  return !covered.has(t);
});
if (uncovered.length > 0) fail(`mermaid: ${uncovered.length} registered type(s) uncovered: ${uncovered.join(', ')}`);
else process.stdout.write(`[corpus] mermaid: ${registered.length}/${registered.length} registered types covered\n`);

// ── 2. math renders ───────────────────────────────────────────────────────

const katex = require('katex');
const katexVersion = JSON.parse(
  readFileSync(join(dirname(require.resolve('katex/package.json')), 'package.json'), 'utf8')
).version;
const math = await import('../src/math/generated.ts');

if (math.KATEX_VERSION !== katexVersion) {
  fail(`math: generated against katex ${math.KATEX_VERSION}, installed is ${katexVersion} — run generate:math`);
}

const checkAll = (name, list, displayMode) => {
  let bad = 0;
  for (const tex of list) {
    try {
      katex.renderToString(tex, { throwOnError: true, displayMode });
    } catch (e) {
      if (bad === 0) fail(`math ${name}: ${String(e.message ?? e).slice(0, 120)}`);
      bad += 1;
    }
  }
  if (bad > 0) fail(`math ${name}: ${bad} of ${list.length} fragments do not render`);
  return list.length;
};

let mathFragments = 0;
mathFragments += checkAll('MATH_SYMBOLS', math.MATH_SYMBOLS, false);
mathFragments += checkAll('TEXT_SYMBOLS', math.TEXT_SYMBOLS, false);
mathFragments += checkAll('MATH_FUNCTIONS', math.MATH_FUNCTIONS, false);
mathFragments += checkAll('MATH_MACROS', math.MATH_MACROS, false);
mathFragments += checkAll('MATH_ENVIRONMENTS', math.MATH_ENVIRONMENTS, false);
mathFragments += checkAll('DISPLAY_ONLY', math.DISPLAY_ONLY, true);
process.stdout.write(
  `[corpus] katex ${katexVersion}: ${mathFragments} fragments render, ` +
    `${math.GENERATED_IDENTIFIER_COUNT} identifiers covered\n`
);

// ── 2b. the authored formulas render ──────────────────────────────────────

/**
 * `MATH_AUTHORED` only. The seam cases are markdown fixtures and several are
 * deliberately malformed — an unclosed `$$`, a price that must NOT be math, a
 * pipe that only becomes valid after the engine rewrites it. Feeding those to
 * KaTeX would fail for exactly the reason they exist.
 *
 * The authored cases carry the opposite obligation: they are here to say what
 * real formulas cost, and a formula that throws costs nothing and renders an
 * error box. Every `$$…$$` and `$…$` body in them is extracted and rendered.
 */
const authored = await import('../src/math/authored.ts');

const bodies = [];
for (const c of authored.MATH_AUTHORED) {
  for (const m of c.src.matchAll(/\$\$([\s\S]+?)\$\$/g)) bodies.push({ c, tex: m[1], display: true });
  const withoutDisplay = c.src.replace(/\$\$[\s\S]+?\$\$/g, '');
  for (const m of withoutDisplay.matchAll(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g))
    bodies.push({ c, tex: m[1], display: false });
}
let authoredBad = 0;
for (const b of bodies) {
  try {
    katex.renderToString(b.tex, { throwOnError: true, displayMode: b.display });
  } catch (e) {
    fail(`math authored ${b.c.id}: ${String(e.message ?? e).split('\n')[0].slice(0, 110)}`);
    authoredBad += 1;
  }
}
if (bodies.length < authored.MATH_AUTHORED.length) {
  fail(`math authored: only ${bodies.length} formulas extracted from ${authored.MATH_AUTHORED.length} cases`);
}
if (authoredBad === 0) {
  process.stdout.write(
    `[corpus] katex: ${bodies.length} authored formulas render, ` +
      `${authored.MATH_SEAM_CASES.length} seam fixtures (not rendered — several are malformed on purpose)\n`
  );
}

// ── 2c. every code fence names a language the highlighter knows ───────────

/**
 * A fence tagged with an unregistered language does not fail — it renders as
 * plain text. So a corpus can claim to cover Solidity, quietly get plaintext,
 * and post a number for it forever. `lang` is therefore resolved against the
 * installed highlight.js, and the languages that are deliberately unknown are
 * checked to still BE unknown: if a future highlight.js registers one,
 * promoting it to `CODE_LANGUAGES` should be a decision someone makes rather
 * than a silent change in what the corpus measures.
 */
const code = await import('../src/code/languages.ts');
const hljs = (await import('highlight.js')).default;
const hljsVersion = JSON.parse(
  readFileSync(join(dirname(require.resolve('highlight.js/package.json')), 'package.json'), 'utf8')
).version;

const codeIds = new Set();
let langCases = 0;
for (const c of [...code.CODE_LANGUAGES, ...code.CODE_STRUCTURES, ...code.CODE_EDGE, ...code.CODE_INLINE]) {
  if (codeIds.has(c.id)) fail(`code: duplicate id ${c.id}`);
  codeIds.add(c.id);
  if (c.lang === '') continue; // a bare fence, deliberately untagged
  langCases += 1;
  if (hljs.getLanguage(c.lang) === undefined) {
    fail(`code ${c.id}: highlight.js ${hljsVersion} does not know '${c.lang}'`);
  }
}
for (const l of code.CODE_UNKNOWN_LANGS) {
  if (hljs.getLanguage(l) !== undefined) {
    fail(`code: '${l}' is listed as unknown but highlight.js ${hljsVersion} now registers it — promote it`);
  }
}
process.stdout.write(
  `[corpus] highlight.js ${hljsVersion}: ${langCases} tagged fences resolve, ` +
    `${code.CODE_UNKNOWN_LANGS.length} deliberately unknown\n`
);

/**
 * The tag resolving is necessary and not sufficient: a fence tagged `rust`
 * whose body is prose resolves fine and highlights into nothing. So each
 * fixture is highlighted and required to produce real tokens.
 *
 * Calibrated against the measured floor rather than guessed: the least-marked
 * fixture in the set is `data-ini` at 9 spans, which is expected — it is in
 * the corpus precisely as the simplest grammar available. 5 sits below that
 * with room, and well below anything a genuinely-wrong fixture would reach.
 */
const MIN_SPANS = 5;
for (const c of [...code.CODE_LANGUAGES, ...code.CODE_STRUCTURES]) {
  const spans = (hljs.highlight(c.src, { language: c.lang }).value.match(/<span/g) ?? []).length;
  if (spans < MIN_SPANS) {
    fail(`code ${c.id}: highlights into only ${spans} spans — the body may not be ${c.lang}`);
  }
}

/** The three fence-level fixtures are assembled from parts, so a typo would
 *  produce a document with an unbalanced fence and no error anywhere. */
const fenceRuns = (s) => (s.match(/^\s*(`{3,}|~{3,})/gm) ?? []).length;
if (fenceRuns(code.TILDE_FENCE_DOC) !== 4) fail('code: TILDE_FENCE_DOC does not have four fence markers');
if (fenceRuns(code.NESTED_FENCE_DOC) !== 4) fail('code: NESTED_FENCE_DOC does not have four fence markers');
if (fenceRuns(code.UNCLOSED_FENCE_DOC) !== 1) fail('code: UNCLOSED_FENCE_DOC should have exactly one, unclosed');

const collected = await import('../src/math/collected.ts');
// ── 2c-bis. markdown cases parse, and ids are unique across every domain ──

/**
 * Two checks the four domains only need now that there are four of them.
 *
 * IDS ARE GLOBALLY UNIQUE. Each domain checked its own ids and none checked
 * across, which was fine with one list and is not with four: benchmark
 * scenarios are keyed by case id, so a `basic` in two domains would make two
 * different cells share a name and a comparison silently average them.
 *
 * EVERY MARKDOWN CASE PRODUCES NODES. A markdown fixture cannot fail loudly —
 * a typo just yields a paragraph of literal text, which renders, measures and
 * proves nothing. Requiring at least one node is a floor, not a proof; the
 * real check is that roughly half of these cases are NEGATIVE and pin things
 * that must not change, which belongs in the engine's tests, not here.
 */
const markdown = await import('../src/markdown/constructs.ts');

const allIds = new Map();
const addIds = (domain, cases) => {
  for (const c of cases) {
    const prev = allIds.get(c.id);
    if (prev !== undefined) fail(`ids: '${c.id}' is used by both ${prev} and ${domain}`);
    else allIds.set(c.id, domain);
  }
};
addIds('mermaid', MERMAID_CASES);
addIds('math', [...authored.MATH_SEAM_CASES, ...authored.MATH_AUTHORED]);
addIds('collected', collected.COLLECTED_MATH_CASES);
addIds('code', [...code.CODE_LANGUAGES, ...code.CODE_STRUCTURES, ...code.CODE_EDGE, ...code.CODE_INLINE]);
addIds('markdown', markdown.MARKDOWN_CASES);

/** The parsers both remaining gates need. Declared once, before either. */
const { unified } = await import('unified');
const remarkParse = (await import('remark-parse')).default;
const remarkMath = (await import('remark-math')).default;
const mdParser = unified().use(remarkParse).use(remarkMath);

// ── 2c-ter. the collected cases render as annotated ──────────────────────

/**
 * The real-use cases, checked against the FULL pipeline rather than against
 * mdast.
 *
 * The layer matters and this gate learned it the hard way. Counting `math`
 * nodes after `remark-parse` + the core remark chain reported three failures;
 * running the same 95 cases through remark-rehype and the core rehype chain
 * and counting rendered KaTeX roots reported two, and not the same two. One
 * finding appeared only in the fuller chain and one disappeared. A gate that
 * stops one layer short of what the user sees is measuring a different
 * question.
 *
 * `repair` asserts that the loose form and the normalised form RENDER THE
 * SAME, not that either equals a string — an engine change that alters the
 * intermediate text without changing the output should not fail.
 *
 * `ambig` asserts only reproducibility: the same input, rendered twice, must
 * give the same answer. It is the one expectation that compares a case
 * against itself, and it is the reason the scheme was worth importing.
 */
const engine = await import('@ai-react-markdown/engine');
const remarkRehype = (await import('remark-rehype')).default;
const { defaultSchema } = await import('rehype-sanitize');

const fullProc = unified()
  .use(remarkParse)
  .use(engine.buildCoreRemarkPlugins([]))
  .use(remarkRehype, engine.buildCoreRemarkRehypeOptions(false))
  .use(engine.buildCoreRehypePlugins(defaultSchema, ''));

/** Rendered KaTeX roots, which is what a reader actually sees, plus the
 *  visible text so a silent degradation to a literal `$` is legible in the
 *  failure message rather than only as a count. */
const renderCase = (md) => {
  const pre = engine.preprocessLaTeX(md);
  const scan = (n, a = { katex: 0, text: '' }) => {
    if (n.type === 'text') a.text += n.value;
    const cls = n.properties?.className;
    if (Array.isArray(cls) && cls.some((c) => String(c) === 'katex')) a.katex += 1;
    (n.children ?? []).forEach((c) => scan(c, a));
    return a;
  };
  return scan(fullProc.runSync(fullProc.parse(pre), pre));
};

const knownGaps = new Set(collected.COLLECTED_KNOWN_GAPS);
let collectedBad = 0;
for (const c of collected.COLLECTED_MATH_CASES) {
  const r = renderCase(c.src);
  let ok;
  switch (c.expectation) {
    case 'math':
    case 'mixed':
      ok = r.katex >= 1;
      break;
    case 'text':
    case 'raw':
      ok = r.katex === 0;
      break;
    case 'repair': {
      if (c.equivalentTo === undefined) {
        fail(`collected ${c.id}: expectation 'repair' needs an equivalentTo form`);
        ok = false;
        break;
      }
      ok = r.katex >= 1 && r.katex === renderCase(c.equivalentTo).katex;
      break;
    }
    case 'ambig':
      // Either reading is fine; rendering it twice must not disagree.
      ok = r.katex === renderCase(c.src).katex && r.text === renderCase(c.src).text;
      break;
    default:
      fail(`collected ${c.id}: unknown expectation '${c.expectation}'`);
      ok = false;
  }
  if (knownGaps.has(c.id)) {
    if (ok) fail(`collected ${c.id}: listed as a known gap but it now passes — remove it from COLLECTED_KNOWN_GAPS`);
    continue;
  }
  if (!ok) {
    fail(`collected ${c.id} [${c.expectation}]: ${r.katex} katex root(s); visible ${JSON.stringify(r.text.replace(/\s+/g, ' ')).slice(0, 90)}`);
    collectedBad += 1;
  }
}
if (collectedBad === 0) {
  process.stdout.write(
    `[corpus] collected: ${collected.COLLECTED_MATH_CASES.length} real-use cases render as annotated ` +
      `(${knownGaps.size} known gaps held open)\n`
  );
}

// ── 2d. no document swallows its own tail ────────────────────────────────

/**
 * Append a sentinel to every document and require it to come out as a
 * top-level heading.
 *
 * This replaces a `$$`-parity counter, and the replacement is the point.
 * Parity was a PROXY for the hazard, and the proxy stopped matching the
 * moment the engine was fixed: an unclosed `$$` that sits mid-line leaves an
 * odd count and is completely harmless, because mathFlow is a leaf block and
 * cannot open there. The counter would have failed a document that renders
 * perfectly — the same keying mistake the engine bug was, made in the gate
 * that was supposed to catch it.
 *
 * A sentinel measures the hazard itself: did anything in this document
 * swallow what follows it. It uses the real parser, so it cannot drift from
 * remark-math's actual rules the way a reimplementation of them would, and it
 * covers unclosed fences and unclosed math with one check.
 */
const documents = await import('../src/documents.ts');
const exempt = new Set(documents.UNBALANCED_BY_DESIGN);

for (const name of exempt) {
  if (documents.DOCUMENTS[name] === undefined) {
    fail(`documents: UNBALANCED_BY_DESIGN names '${name}', which is not a document`);
  }
}

const SENTINEL = 'corpus-tail-sentinel';

const tailSurvives = async (body) => {
  const tree = await mdParser.run(mdParser.parse(`${body}\n\n## ${SENTINEL}\n`));
  return tree.children.some(
    (n) => n.type === 'heading' && JSON.stringify(n).includes(SENTINEL)
  );
};

for (const [name, body] of Object.entries(documents.DOCUMENTS)) {
  const survives = await tailSurvives(body);
  if (exempt.has(name)) {
    if (survives) {
      fail(`documents ${name}: listed as swallowing its tail, but the tail survived — drop it from the list`);
    }
    continue;
  }
  if (!survives) {
    fail(`documents ${name}: something in it swallows everything after — an unclosed fence or a line-start $$`);
  }
}
let mdEmpty = 0;
for (const c of markdown.MARKDOWN_CASES) {
  const tree = await mdParser.run(mdParser.parse(c.src));
  if (tree.children.length === 0) {
    fail(`markdown ${c.id}: parses to nothing`);
    mdEmpty += 1;
  }
}
if (mdEmpty === 0) {
  process.stdout.write(
    `[corpus] markdown: ${markdown.MARKDOWN_CASES.length} cases parse, ` +
      `${allIds.size} case ids unique across four domains\n`
  );
}

process.stdout.write(
  `[corpus] documents: ${Object.keys(documents.DOCUMENTS).length} assembled, ` +
    `${exempt.size} swallow their tail by design\n`
);

// ── 3. the generated file is in sync ──────────────────────────────────────

const before = readFileSync(join(ROOT, 'src/math/generated.ts'), 'utf8');
execFileSync(process.execPath, [join(HERE, 'generate-math.mjs')], { cwd: ROOT, stdio: 'ignore' });
const after = readFileSync(join(ROOT, 'src/math/generated.ts'), 'utf8');
if (before !== after) {
  fail('math: src/math/generated.ts is stale — re-run generate:math and commit the result');
} else {
  process.stdout.write('[corpus] math: generated.ts matches a fresh derivation\n');
}

// ── verdict ───────────────────────────────────────────────────────────────

if (failed > 0) {
  process.stdout.write(`\n[corpus] ${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write('\n[corpus] ALL CLEAN\n');
