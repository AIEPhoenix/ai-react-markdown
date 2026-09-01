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
