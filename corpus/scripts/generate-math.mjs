#!/usr/bin/env node
/**
 * Derive the exhaustive math corpus from KaTeX's OWN tables.
 *
 * WHY GENERATED AND NOT WRITTEN. KaTeX 0.16.47 defines 322 function names,
 * 649 symbols and 337 macros. A hand-written "comprehensive" math corpus is a
 * claim about coverage that nobody can check and that decays silently the
 * first time KaTeX adds a symbol. Reading the tables makes coverage a fact,
 * and `pnpm --filter @bench/corpus generate:math` re-derives it after an
 * upgrade — with the diff showing exactly what the new version added.
 *
 * WHY IT VALIDATES RATHER THAN TRUSTS. Not every identifier in those tables
 * is usable in a document. Some are TeX internals (`\@firstoftwo`,
 * `\expandafter`), some only parse inside a specific host construct, some are
 * infix, and some accept an argument shape this script cannot infer. So every
 * candidate is RENDERED with `throwOnError: true` and kept only if it
 * survives. What does not survive goes to `excluded.json` WITH the error
 * KaTeX raised, so the exclusion list is auditable rather than a silent gap —
 * an identifier missing from the corpus should always be traceable to a
 * reason.
 *
 * The output is a checked-in file. `validate.mjs` re-runs the derivation and
 * fails if it differs, which is what keeps the checked-in copy honest without
 * making the corpus depend on KaTeX's source layout at consumer build time.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);

/** KaTeX ships `src/` in its npm tarball, which is what makes this possible.
 *  Resolved through the package rather than hard-coded so the corpus tracks
 *  whatever version the workspace actually installed. */
const KATEX_PKG = dirname(require.resolve('katex/package.json'));
const KATEX_SRC = join(KATEX_PKG, 'src');
const KATEX_VERSION = JSON.parse(readFileSync(join(KATEX_PKG, 'package.json'), 'utf8')).version;

const katex = require('katex');

// ── read the tables ───────────────────────────────────────────────────────

/**
 * Every `.ts` under KaTeX's `src/`, read once.
 *
 * The readers below scan ALL of them rather than the file each definition
 * "should" live in, because this script guessed the layout three times and
 * was wrong three times: `defineMacro` turned up in `macros.ts`, then in
 * `functions/operatorname.ts` (which is where the public `\operatorname`
 * lives, while `macros.ts` had only the private `\operatorname@`), then in
 * `environments/array.ts` (`\notag`). Each miss was invisible — the
 * identifier simply was not in the corpus, and nothing said so.
 *
 * Keying on the CALL rather than on the file is what closes that class of
 * hole for good: a future KaTeX that moves a definition, or adds a fourth
 * home for one, changes nothing here.
 */
function allSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(KATEX_SRC);
  return out;
}

const SOURCES = allSources();

/** `defineSymbol(mode, font, group, "replace", "\\name", acceptUnicodeChar?)`.
 *  Mode and group both matter: a text-mode symbol has to be rendered inside
 *  `\text{}` or it fails for a reason that has nothing to do with support,
 *  and an `accent-token` takes an argument. */
function readSymbols() {
  const out = [];
  const re =
    /defineSymbol\(\s*(math|text)\s*,\s*\w+\s*,\s*([\w-]+)\s*,\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|null)\s*,\s*"((?:[^"\\]|\\.)*)"/g;
  for (const src of SOURCES) {
    for (const m of src.matchAll(re)) {
      const [, mode, group, rawName] = m;
      const name = rawName.replace(/\\\\/g, '\\');
      if (!name.startsWith('\\')) continue; // bare characters, not commands
      out.push({ name, mode, group });
    }
  }
  return out;
}

/** `defineFunction({ names: [...], props: { numArgs: N } })`. The block is
 *  matched loosely and then the two fields are pulled out of it, because the
 *  handlers in between contain every bracket shape imaginable. */
function readFunctions() {
  const out = [];
  for (const src of SOURCES) {
    for (const block of src.matchAll(/defineFunction\(\{([\s\S]*?)\n\}\)/g)) {
      const body = block[1];
      const namesMatch = body.match(/names:\s*\[([\s\S]*?)\]/);
      if (namesMatch === null) continue;
      const numArgs = Number(body.match(/numArgs:\s*(\d+)/)?.[1] ?? 0);
      const infix = /infix:\s*true/.test(body);
      for (const nm of namesMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const name = nm[1].replace(/\\\\/g, '\\');
        if (!name.startsWith('\\')) continue;
        out.push({ name, numArgs, infix });
      }
    }
  }
  return out;
}

/**
 * `defineMacro("\\name", ...)`, from `macros.ts` AND from the function files.
 *
 * Both, because KaTeX does not keep them in one place and reading only
 * `macros.ts` silently lost the public names of anything whose macro sits
 * beside its implementation. `\operatorname` is the clearest case: the
 * FUNCTION is `\operatorname@` (private, correctly skipped) and the name a
 * document actually writes is a macro declared in `functions/operatorname.ts`.
 * Scanning one file kept the private half and dropped the public one.
 */
function readMacros() {
  const out = [];
  const seenNames = new Set();
  for (const src of SOURCES) {
    for (const m of src.matchAll(/defineMacro\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const name = m[1].replace(/\\\\/g, '\\');
      if (name.startsWith('\\') && !seenNames.has(name)) {
        seenNames.add(name);
        out.push({ name });
      }
    }
  }
  return out;
}

/** Environment names, read from the `\begin{...}` side rather than guessed. */
function readEnvironments() {
  const out = new Set();
  for (const src of SOURCES) {
    for (const block of src.matchAll(/defineEnvironment\(\{([\s\S]*?)\n\}\)/g)) {
      const namesMatch = block[1].match(/names:\s*\[([\s\S]*?)\]/);
      if (namesMatch === null) continue;
      for (const nm of namesMatch[1].matchAll(/"([^"]*)"/g)) out.add(nm[1]);
    }
  }
  return [...out];
}

// ── turn each identifier into a candidate fragment ────────────────────────

/** A placeholder argument that is valid in every position KaTeX accepts one.
 *  `x` rather than something longer so a 6-argument function stays readable. */
const ARG = 'x';

/**
 * The generic ladder of argument shapes, tried in order until one renders.
 *
 * Guessing beats a per-name table for the same reason the whole file is
 * generated: a table goes stale. The FIRST pass of this script used only the
 * `numArgs` KaTeX declares and dropped 175 identifiers — including every
 * display environment, the whole `\left`/`\right`/`\big` delimiter family and
 * 105 argument-taking macros, none of which are unsupported. They were
 * missing because the shape was wrong, and a corpus that silently omits
 * `\left(…\right)` while claiming full coverage is worse than one that
 * claims less.
 */
const LADDER = [
  (n) => n,
  (n) => `${n}{${ARG}}`,
  (n) => `${n}{${ARG}}{${ARG}}`,
  (n) => `${n}{${ARG}}{${ARG}}{${ARG}}`,
  // Dimensions: `\kern`, `\rule`, `\raisebox`, `\above` and friends reject a
  // group and want a length.
  (n) => `${n}{1em}`,
  (n) => `${n}{1em}{1em}`,
  (n) => `${n}1em`,
  (n) => `${n}{1em}{${ARG}}`,
  // Delimiter takers: `\big`, `\bigl`, `\Bigm`, … want a delimiter CHARACTER,
  // not a group.
  (n) => `${n}(`,
  (n) => `${n}( ${ARG} ${n}`.replace(/l\($/, 'r)'),
];

/** Shapes no ladder can reach, each because the construct spans more than the
 *  command itself. Kept deliberately small — every entry is a thing TeX
 *  genuinely requires, not a workaround for a bad guess. */
const EXPLICIT = {
  '\\left': ['\\left( ' + ARG + ' \\right)'],
  '\\right': ['\\left( ' + ARG + ' \\right)'],
  '\\middle': ['\\left( ' + ARG + ' \\middle| ' + ARG + ' \\right)'],
  '\\verb': ['\\verb|' + ARG + '|'],
  '\\char': ['\\char"41'],
  '\\htmlData': ['\\htmlData{a=b}{' + ARG + '}'],
  '\\genfrac': ['\\genfrac{(}{)}{0pt}{0}{' + ARG + '}{' + ARG + '}'],
  '\\above': [ARG + ' \\above 1pt ' + ARG],
  '\\abovewithdelims': [ARG + ' \\abovewithdelims ( ) 1pt ' + ARG],
  '\\atopwithdelims': [ARG + ' \\atopwithdelims ( ) ' + ARG],
  '\\overwithdelims': [ARG + ' \\overwithdelims ( ) ' + ARG],
  '\\raisebox': ['\\raisebox{1em}{' + ARG + '}'],
  '\\rule': ['\\rule{1em}{1em}'],
  '\\hskip': ['\\hskip 1em'],
  '\\kern': ['\\kern 1em'],
  '\\mkern': ['\\mkern 1mu'],
  '\\mskip': ['\\mskip 1mu'],
  '\\hspace': ['\\hspace{1em}'],
  '\\includegraphics': ['\\includegraphics[height=1em]{x.png}'],
};

/**
 * TeX internals that are correctly absent from a document corpus.
 *
 * These are real KaTeX identifiers and they are deliberately NOT exercised:
 * they define, expand or delimit other macros rather than typesetting
 * anything, so a "fragment" containing one is either meaningless or is really
 * a test of macro expansion — a different subject with a different corpus.
 * Listed by name so the exclusion is a decision on the record rather than a
 * shape the ladder happened to miss.
 */
const INTERNALS = new Set([
  // Definition and expansion control.
  '\\def',
  '\\edef',
  '\\gdef',
  '\\xdef',
  '\\let',
  '\\futurelet',
  '\\global',
  '\\long',
  '\\expandafter',
  '\\noexpand',
  '\\newcommand',
  '\\renewcommand',
  '\\providecommand',
  // Grouping and environment delimiters — half of a construct, never a
  // fragment on their own.
  '\\bgroup',
  '\\egroup',
  '\\begin',
  '\\end',
  '\\relax',
  // KaTeX's own `// terminal (console) tools`. These typeset the empty string
  // and write to the console instead, so including them put stray lines in
  // this script's output and would have put invisible no-ops in the corpus.
  '\\message',
  '\\errmessage',
  '\\show',
]);

/** TeX's private namespace. Identifiers containing `@` are internal helpers
 *  that a document cannot name — `\bra@ket`, `\@firstoftwo`, `\tmspace`'s
 *  siblings. Keyed on the RULE rather than on the four names that happened to
 *  surface as errors, so a KaTeX upgrade that adds a fifth is covered without
 *  anyone noticing it had to be. */
const isPrivate = (name) => name.includes('@');

function candidatesForSymbol(sym) {
  // `accent-token` is the one group whose members are incomplete on their
  // own: `\acute` is an error, `\acute{x}` is an accent. Text-mode accents
  // need the same treatment INSIDE the `\text{}`, which the first pass got
  // wrong for `\'`, `` \` ``, `\^`, `\c`, `\H`, `\r`, `\u` and `\v`.
  const bodies = sym.group === 'accent-token' ? [`${sym.name}{${ARG}}`, sym.name] : [sym.name, `${sym.name}{${ARG}}`];
  return sym.mode === 'text' ? bodies.map((b) => `\\text{${b}}`) : bodies;
}

function candidatesForFunction(fn) {
  if (EXPLICIT[fn.name] !== undefined) return EXPLICIT[fn.name];
  // An infix operator needs something on both sides — `\over` alone is a
  // parse error, `x \over y` is a fraction.
  if (fn.infix) return [`${ARG} ${fn.name} ${ARG}`];
  const declared = fn.name + `{${ARG}}`.repeat(fn.numArgs);
  return [declared, ...LADDER.map((f) => f(fn.name))];
}

function candidatesForMacro(name) {
  if (EXPLICIT[name] !== undefined) return EXPLICIT[name];
  return LADDER.map((f) => f(name));
}

/** Environments need a body, and the body shape differs by family. Rather
 *  than encode a table of shapes, try a few and keep the first that renders:
 *  the point here is coverage, and which body got it there does not matter.
 *  `align`, `gather`, `equation`, `split`, `alignat` and `CD` are display-only
 *  — `renders()` retries in display mode, which is what admits them. */
function candidatesForEnvironment(env) {
  const bodies = [`${ARG} & ${ARG} \\\\ ${ARG} & ${ARG}`, `${ARG} \\\\ ${ARG}`, ARG];
  const args = ['', '{cc}', '{c}', '{2}'];
  const out = [];
  for (const a of args) for (const b of bodies) out.push(`\\begin{${env}}${a}${b}\\end{${env}}`);
  return out;
}

// ── validate ──────────────────────────────────────────────────────────────

/** Returns null when the fragment renders, else the error. Display mode is
 *  tried as a fallback rather than as the default: inline is the commoner
 *  form, and a fragment that only works in display mode should be recorded as
 *  such so the corpus puts it in a `$$` block. */
function renders(tex) {
  let firstError = null;
  for (const displayMode of [false, true]) {
    try {
      katex.renderToString(tex, { throwOnError: true, displayMode });
      return { displayMode };
    } catch (e) {
      firstError ??= String(e.message ?? e)
        .replace(/\s+/g, ' ')
        .slice(0, 160);
    }
  }
  return { error: firstError };
}

// ── main ──────────────────────────────────────────────────────────────────

const symbols = readSymbols();
const functions = readFunctions();
const macros = readMacros();
const environments = readEnvironments();

const kept = { symbolsMath: [], symbolsText: [], functions: [], macros: [], environments: [] };
const excluded = [];
const internals = [];

const seen = new Set();
const consider = (kind, id, candidates, meta) => {
  const key = `${kind}:${id}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (INTERNALS.has(id) || isPrivate(id)) {
    internals.push({ kind, id });
    return;
  }
  let firstError = null;
  for (const tex of candidates) {
    const r = renders(tex);
    if (r.error === undefined) {
      kept[kind].push({ id, tex, displayOnly: r.displayMode, ...meta });
      return;
    }
    firstError ??= r.error;
  }
  excluded.push({ kind, id, tried: candidates, error: firstError });
};

for (const s of symbols) {
  consider(s.mode === 'text' ? 'symbolsText' : 'symbolsMath', s.name, candidatesForSymbol(s), {
    group: s.group,
  });
}
for (const f of functions) {
  consider('functions', f.name, candidatesForFunction(f), { numArgs: f.numArgs, infix: f.infix });
}
for (const m of macros) {
  consider('macros', m.name, candidatesForMacro(m.name), {});
}
for (const e of environments) {
  consider('environments', e, candidatesForEnvironment(e), {});
}

// ── emit ──────────────────────────────────────────────────────────────────

/** Pack fragments into lines of a readable width. A corpus of 600 one-symbol
 *  formulas would be 600 block elements and would say more about block
 *  overhead than about math; grouping keeps the DOM shape plausible while the
 *  coverage stays complete. */
function pack(items, perLine) {
  const lines = [];
  for (let i = 0; i < items.length; i += perLine) {
    // Each fragment gets its own group. Without the braces, TeX's "only one
    // infix operator per group" rule fires as soon as two of `\\over`,
    // `\\choose`, `\\atop`, `\\brace` or `\\brack` land on the same packed
    // line — which they did, and the corpus shipped a line that threw.
    lines.push(
      items
        .slice(i, i + perLine)
        .map((it) => `{${it.tex}}`)
        .join(' \\quad ')
    );
  }
  return lines;
}

/** Split what renders inline from what only renders in display mode. Packing
 *  a display-only construct into an inline run would put a fragment in the
 *  corpus that throws in the very context the corpus places it. */
const inline = (list) => list.filter((it) => it.displayOnly !== true);
const displayOnly = (list) => list.filter((it) => it.displayOnly === true);
const ALL_DISPLAY_ONLY = [
  ...displayOnly(kept.symbolsMath),
  ...displayOnly(kept.symbolsText),
  ...displayOnly(kept.functions),
  ...displayOnly(kept.macros),
  ...displayOnly(kept.environments),
];

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const total =
  kept.symbolsMath.length +
  kept.symbolsText.length +
  kept.functions.length +
  kept.macros.length +
  kept.environments.length;

const out = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Re-derive with \`pnpm --filter @bench/corpus generate:math\`.
 * \`pnpm --filter @bench/corpus validate\` fails if this file and the
 * installed KaTeX have drifted apart.
 *
 * Derived from KaTeX ${KATEX_VERSION}'s own tables and then filtered by
 * rendering every candidate with \`throwOnError\`. Coverage below is what
 * survived, not what was attempted; \`excluded.json\` carries the rest with
 * the error each one raised.
 *
 *   math symbols   ${String(kept.symbolsMath.length).padStart(4)} of ${String(symbols.filter((s) => s.mode === 'math').length).padStart(4)}
 *   text symbols   ${String(kept.symbolsText.length).padStart(4)} of ${String(symbols.filter((s) => s.mode === 'text').length).padStart(4)}
 *   functions      ${String(kept.functions.length).padStart(4)} of ${String(new Set(functions.map((f) => f.name)).size).padStart(4)}
 *   macros         ${String(kept.macros.length).padStart(4)} of ${String(macros.length).padStart(4)}
 *   environments   ${String(kept.environments.length).padStart(4)} of ${String(environments.length).padStart(4)}
 */

export const KATEX_VERSION = '${KATEX_VERSION}';

/** Every math-mode symbol KaTeX defines, grouped into inline formulas. */
export const MATH_SYMBOLS: readonly string[] = [
${pack(inline(kept.symbolsMath), 12)
  .map((l) => `  \`${esc(l)}\`,`)
  .join('\n')}
];

/** Every text-mode symbol, each already wrapped in \\text{}. */
export const TEXT_SYMBOLS: readonly string[] = [
${pack(inline(kept.symbolsText), 12)
  .map((l) => `  \`${esc(l)}\`,`)
  .join('\n')}
];

/** Every callable function name, applied to placeholder arguments. */
export const MATH_FUNCTIONS: readonly string[] = [
${pack(inline(kept.functions), 8)
  .map((l) => `  \`${esc(l)}\`,`)
  .join('\n')}
];

/** Every macro that renders standalone. */
export const MATH_MACROS: readonly string[] = [
${pack(inline(kept.macros), 10)
  .map((l) => `  \`${esc(l)}\`,`)
  .join('\n')}
];

/** Every environment, with a body shaped to fit it. One per entry — these are
 *  display-level constructs and packing them would change what is measured. */
export const MATH_ENVIRONMENTS: readonly string[] = [
${inline(kept.environments)
  .map((e) => `  \`${esc(e.tex)}\`,`)
  .join('\n')}
];

/** Fragments that KaTeX accepts ONLY in display mode — \`align\`, \`gather\`,
 *  \`equation\`, \`split\`, \`alignat\`, \`CD\` and anything else the generator
 *  found to behave that way. Consumers must wrap these in \`$$\`; putting one
 *  between single dollars throws, which is why they are a separate export
 *  rather than mixed into the lists above. */
export const DISPLAY_ONLY: readonly string[] = [
${ALL_DISPLAY_ONLY.map((e) => `  \`${esc(e.tex)}\`,`).join('\n')}
];

/** Total distinct KaTeX identifiers exercised by the four lists above. */
export const GENERATED_IDENTIFIER_COUNT = ${total};
`;

mkdirSync(join(ROOT, 'src/math'), { recursive: true });
writeFileSync(join(ROOT, 'src/math/generated.ts'), out);
writeFileSync(
  join(ROOT, 'src/math/excluded.json'),
  `${JSON.stringify(
    {
      katexVersion: KATEX_VERSION,
      note: 'Identifiers NOT in the corpus. `internals` is a decision (see INTERNALS in scripts/generate-math.mjs); `excluded` is everything no candidate shape could render, kept with the error so a real gap is distinguishable from a bad guess.',
      internals: internals.map((i) => i.id).sort(),
      excluded: excluded.sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    2
  )}\n`
);

process.stdout.write(
  `[corpus] katex ${KATEX_VERSION}\n` +
    `[corpus]   math symbols  ${kept.symbolsMath.length}\n` +
    `[corpus]   text symbols  ${kept.symbolsText.length}\n` +
    `[corpus]   functions     ${kept.functions.length}\n` +
    `[corpus]   macros        ${kept.macros.length}\n` +
    `[corpus]   environments  ${kept.environments.length}\n` +
    `[corpus]   display-only  ${ALL_DISPLAY_ONLY.length} (of the above)\n` +
    `[corpus]   TOTAL KEPT    ${total}\n` +
    `[corpus]   internals     ${internals.length} (deliberately not exercised)\n` +
    `[corpus]   excluded      ${excluded.length} (see src/math/excluded.json)\n`
);
