/**
 * The corpus as documents — what a consumer actually feeds a renderer.
 *
 * The per-domain files hold CASES: a fragment plus what it probes. That shape
 * is right for a test, which wants one construct at a time, and wrong for a
 * benchmark, which wants a document. This file is the join, and it lives in
 * `src` rather than in a script because the benchmark apps import it: a
 * document assembled ad hoc in a runner would drift from the one the tests
 * check.
 *
 * WRAPPING IS PART OF THE JOIN, NOT AN AFTERTHOUGHT. The generated math layer
 * is bare TeX — `\alpha \quad \beta`, with no delimiters — because that is
 * what KaTeX validates. Turning it into markdown means choosing delimiters,
 * and the choice is `$$`: the engine's preprocessor normalises every single
 * dollar to a double one anyway, so a corpus written with `$…$` would not be
 * measuring the path it appears to. Verified 2026-08-31 that every generated
 * group renders under `displayMode: true` as well as inline, so the choice
 * costs no coverage.
 */
import {
  CODE_EDGE,
  CODE_INLINE,
  CODE_LANGUAGES,
  CODE_STRUCTURES,
  NESTED_FENCE_DOC,
  TILDE_FENCE_DOC,
  UNCLOSED_FENCE_DOC,
  type CodeCase,
} from './code/languages.ts';
import { MATH_AUTHORED, MATH_SEAM_CASES } from './math/authored.ts';
import {
  DISPLAY_ONLY,
  LITERAL_CHARS,
  MATH_ENVIRONMENTS,
  MATH_FUNCTIONS,
  MATH_MACROS,
  MATH_SYMBOLS,
  TEXT_SYMBOLS,
  KATEX_VERSION,
} from './math/generated.ts';
import {
  MARKDOWN_BLOCKS,
  MARKDOWN_CASES,
  MARKDOWN_CJK,
  MARKDOWN_GFM,
  MARKDOWN_HTML,
  MARKDOWN_INLINE,
  MARKDOWN_LINKS,
  type MarkdownCase,
} from './markdown/constructs.ts';
import { MERMAID_CASES, MERMAID_TYPES } from './mermaid/diagrams.ts';
import { MARKDOWN_MIXED } from './markdown/mixed.ts';

const section = (title: string, body: string) => `## ${title}\n\n${body}\n`;
/** `probes` is written lowercase in the case files, where it reads as a field
 *  value; in a document it is a sentence and needs to start like one. */
const case_ = (c: { id: string; probes: string }, body: string) =>
  `### ${c.id}\n\n${c.probes[0].toUpperCase()}${c.probes.slice(1)}.\n\n${body}\n`;
const display = (tex: string) => `$$\n${tex}\n$$`;
const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

/**
 * A run of generated fragments as consecutive display blocks.
 *
 * One block per packed line rather than one per identifier: 1139 separate
 * `$$` blocks would be 1139 block-level elements and would measure block
 * overhead rather than math. The packing already happened in the generator;
 * this only adds delimiters.
 */
const runOf = (list: readonly string[]) => list.map(display).join('\n\n');

/**
 * A case that opens a construct it never closes swallows the rest of the
 * document, so it gets a document of its own.
 *
 * This is the one composition rule that cannot be left to ordering. It WAS
 * left to ordering, once: `code.md` placed its unclosed fence last with a
 * comment explaining why, and `math.md` was then assembled with an unclosed
 * `$$` twelfth of eighteen — the 184 lines after it rendered as one enormous
 * math block. Two unclosed cases in one domain also make "put it last"
 * unsatisfiable, since only one thing can be last.
 */
const terminalDocument = (c: { id: string; probes: string; src: string }) =>
  `# ${c.id}

${c.probes[0].toUpperCase()}${c.probes.slice(1)}.

It is its own document because it opens a construct it never closes, and
anything after it would be swallowed. But that is only why it is SEPARATE.

Why it EXISTS: it is the positive control for the tail-sentinel gate. That
gate appends a sentinel heading to every document and requires it to survive;
these two are the only documents required to EAT it. Without them the
detector never sees a document that swallows, so it could return "the tail
survived" unconditionally and the whole gate would still pass — measured, by
mutating it to do exactly that: these two files were the only failures.

So the emptiness is the point. Do not add content after the open construct to
"make it a better test": the gate supplies what gets swallowed, and content of
its own would only be swallowed too.

${c.src}`;

const isTerminal = (c: { terminal?: boolean }) => c.terminal === true;
const openCases = <T extends { terminal?: boolean }>(cases: readonly T[]) => cases.filter((c) => !isTerminal(c));
const terminalCases = <T extends { terminal?: boolean }>(cases: readonly T[]) => cases.filter(isTerminal);

/** Named in the parent document so a reader knows what was pulled out. */
const pulledOut = (cases: readonly { id: string }[]) =>
  cases.length === 0
    ? ''
    : `\n> Pulled into documents of their own because each opens a construct it never closes: ${cases
        .map((c) => `\`${c.id}\``)
        .join(', ')}.\n`;

// ── math ──────────────────────────────────────────────────────────────────

export const MATH_DOCUMENT = `# Math corpus

Two layers. The generated one below covers KaTeX ${KATEX_VERSION}'s vocabulary
exhaustively, derived from its own tables; the authored one covers what a TeX
corpus structurally cannot — the markdown seams the engine's preprocessor acts
on, and formulas shaped the way a real answer shapes them.

${section('Generated: every math-mode symbol', runOf(MATH_SYMBOLS))}
${section('Generated: every text-mode symbol', runOf(TEXT_SYMBOLS))}
${section(
  'Generated: literal characters',
  `Characters the symbol table accepts as input with no command form — capital Greek and the like.\n\n${runOf(LITERAL_CHARS)}`
)}
${section('Generated: every function', runOf(MATH_FUNCTIONS))}
${section('Generated: every macro', runOf(MATH_MACROS))}
${section('Generated: every environment', runOf(MATH_ENVIRONMENTS))}
${section(
  'Generated: display-only constructs',
  `These throw between single dollars. \`align\`, \`gather\`, \`equation\`, \`split\`, \`alignat\` and \`CD\`.\n\n${runOf(DISPLAY_ONLY)}`
)}
${section(
  'Authored: preprocessor seams',
  `Where math, markdown and streaming meet. Six of these must NOT be rewritten.\n${pulledOut(
    terminalCases(MATH_SEAM_CASES)
  )}\n${openCases(MATH_SEAM_CASES)
    .map((c) => case_(c, c.src))
    .join('\n')}`
)}
${section('Authored: document-shaped formulas', MATH_AUTHORED.map((c) => case_(c, c.src)).join('\n'))}`;

// ── code ──────────────────────────────────────────────────────────────────

const codeSection = (title: string, cases: readonly CodeCase[]) =>
  section(title, cases.map((c) => case_(c, fence(c.lang, c.src))).join('\n'));

export const CODE_DOCUMENT = `# Code corpus

Languages chosen to spread across highlighter cost rather than across
popularity, plus the two paths a fence-only corpus never reaches: inline
spans, and the fence itself.

${codeSection('Programming languages', CODE_LANGUAGES)}
${codeSection('Structured data', CODE_STRUCTURES)}
${section(
  'Inline code',
  `Not small fences. These sit in flowing text where the LaTeX, CJK and pangu preprocessors all operate.\n\n${CODE_INLINE.map(
    (c) => case_(c, c.src)
  ).join('\n')}`
)}
${codeSection('Fence edge cases', CODE_EDGE)}
${section(
  'Fences whose content is a fence',
  `### edge-tilde-fence

A tilde fence quoting a backtick fence — the reason tilde fences exist.

${TILDE_FENCE_DOC}

### edge-nested-fence

A four-backtick fence quoting a three-backtick one.

${NESTED_FENCE_DOC}
> The unclosed-fence fixture is \`code-unclosed-fence.md\`, for the same reason
> the unclosed math blocks have documents of their own.`
)}`;

export const CODE_UNCLOSED_DOCUMENT = `# edge-unclosed-tail

A stream that stopped inside a fence: opener present, closer never arrived.

This is its own document because it opens a construct it never closes.
Anything after it would be swallowed, so nothing is after it.

${UNCLOSED_FENCE_DOC}`;

// ── mermaid ───────────────────────────────────────────────────────────────

export const MERMAID_DOCUMENT = `# Mermaid corpus

${MERMAID_CASES.length} cases covering all ${MERMAID_TYPES.length} diagram types that mermaid registers,
including a CJK group whose labels are Chinese, Japanese and Korean. Every one
is parse-verified against the installed version; several of these types are
beta and their grammar moves between minors.

Diagrams mermaid REJECTS are deliberately absent — this document's contract is
that all of it renders. They are pinned in \`src/mermaid/nonAscii.ts\` instead,
each beside the form that works.

${MERMAID_CASES.map((c) => case_(c, fence('mermaid', c.src))).join('\n')}`;

// ── markdown ──────────────────────────────────────────────────────────────

const mdSection = (title: string, note: string, cases: readonly MarkdownCase[]) =>
  section(
    title,
    `${note}\n\n${openCases(cases)
      .map((c) => case_(c, c.src))
      .join('\n')}`
  );

export const MARKDOWN_DOCUMENT = `# Markdown corpus

The engine enables fourteen remark and rehype plugins and the previous corpus
exercised none of them. ${MARKDOWN_CASES.length} cases, roughly half of them
negative: a rewriter is only as good as what it declines to touch, so a colon
in a URL, a \`--\` in code and a \`~~\` in a file path are all here to stay
unchanged.

${mdSection('GFM', 'Tables, task lists, strikethrough, autolinks and footnotes.', MARKDOWN_GFM)}
${mdSection(
  'Inline constructs',
  'Emphasis, ==mark==, emoji shortcodes, smart punctuation, entities and hard breaks.',
  MARKDOWN_INLINE
)}
${mdSection(
  'Links and images',
  'Every link form, and images from a real endpoint so they decode and lay out — a 1x1 pixel cannot shift a page under a reader.',
  MARKDOWN_LINKS
)}
${mdSection(
  'Block structure',
  'Headings, nested lists, definition lists, quotes and thematic breaks.',
  MARKDOWN_BLOCKS
)}
${mdSection('Raw HTML', 'The rehype-raw path, including what rehype-sanitize is expected to strip.', MARKDOWN_HTML)}
${mdSection('CJK', 'Three of the fourteen plugins exist for this, and the old corpus was pure ASCII.', MARKDOWN_CJK)}
${mdSection(
  'Mixed',
  'Code, math and mermaid INSIDE these constructs. Every other document in this corpus is deep in one domain and shallow across domains, so a node-type census over all of them reads as full coverage while none of these combinations occurred — the missing thing is a pair, and pairs have a product for a denominator.',
  MARKDOWN_MIXED
)}`;

/** Every document, keyed by the file name the emit script writes. */
export const DOCUMENTS: Readonly<Record<string, string>> = {
  'math.md': MATH_DOCUMENT,
  'code.md': CODE_DOCUMENT,
  'mermaid.md': MERMAID_DOCUMENT,
  'markdown.md': MARKDOWN_DOCUMENT,
  'code-unclosed-fence.md': CODE_UNCLOSED_DOCUMENT,
  ...Object.fromEntries(terminalCases(MATH_SEAM_CASES).map((c) => [`math-${c.id}.md`, terminalDocument(c)])),
};

/** Documents that are SUPPOSED to end mid-construct. The balance gate skips
 *  these, and skips exactly these — a typo in a name would make the gate stop
 *  checking a document that should balance. */
export const UNBALANCED_BY_DESIGN: readonly string[] = [
  'code-unclosed-fence.md',
  ...terminalCases(MATH_SEAM_CASES).map((c) => `math-${c.id}.md`),
];
