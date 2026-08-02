# Content Preprocessors

Content preprocessors are synchronous string-to-string functions applied to the raw markdown **before** the remark/rehype pipeline parses it. Use them when the input markdown needs a transformation that's simpler at the string level than as a remark plugin — frontmatter stripping, dialect normalization, regex fixes for upstream model quirks, custom dollar-sign escaping, etc.

```ts
import type { AIMDContentPreprocessor } from '@ai-react-markdown/core';

const stripFrontmatter: AIMDContentPreprocessor = (content) =>
  content.replace(/^---[\s\S]*?---\n/, '');

<AIMarkdown content={raw} contentPreprocessors={[stripFrontmatter]} />
```

The signature is intentionally minimal:

```ts
type AIMDContentPreprocessor = (content: string) => string;
```

---

## Execution order

1. **Built-in LaTeX preprocessor** (`preprocessLaTeX`) runs first, unconditionally. It normalizes `\(…\)`/`\[…\]` to `$…$`/`$$…$$`, escapes `|` inside math to survive GFM tables, handles `mhchem` commands, recognizes currency `$` so `$5.99` isn't treated as math, and truncates unclosed `$$` blocks during streaming.
2. **Caller preprocessors** run next, in the order supplied to `contentPreprocessors`. Each receives the previous one's output (left-fold).

```ts
contentPreprocessors={[a, b, c]}
// applied as: c(b(a(latexPreprocessed(content))))
```

You can rely on `$…$` and `$$…$$` already being normalized by the time your preprocessor sees content — useful when writing math-adjacent transforms.

---

## Built-in optional: streaming tail repair (`createRemendPreprocessor`)

While a response streams, the tail of the source is frequently mid-construct — `**bold` without its closer, an unterminated `` `code `` span, a half-typed `[link](url`. By default those frames render literally (asterisks and all) until the closing bytes arrive. The library ships an opt-in factory wrapping [`remend`](https://www.npmjs.com/package/remend) (the markdown-termination engine extracted from Vercel's Streamdown; zero-dependency, Apache-2.0) that completes the unterminated syntax so every frame renders styled:

```tsx
import AIMarkdown, { createRemendPreprocessor } from '@ai-react-markdown/core';

// Module scope — see “Reference stability” below.
const PREPROCESSORS = [createRemendPreprocessor()];

<AIMarkdown content={streamed} streaming contentPreprocessors={PREPROCESSORS} />;
```

It is tree-shakeable: `remend` only enters your bundle if you import the factory.

What it repairs: bold/italic/bold-italic, inline code, strikethrough, links, images (incomplete images are **dropped**, not placeholder-rendered), setext-heading ambiguity, stray `>`/`~` false positives. It is a no-op on well-formed text, so the final frame renders identically with or without it.

Two defaults differ from stock `remend`, one overridable and one not:

- `linkMode: 'text-only'` (overridable) — remend's own default substitutes a `streamdown:incomplete-link` placeholder URL for half-streamed links, but this library's URL sanitizer strips unknown protocols, which would leave a dead `<a>` for the duration of the stream. Text-only renders the link text plainly until the real URL arrives. Pass `{ linkMode: 'protocol' }` if you handle the placeholder scheme yourself.
- `katex`/`inlineKatex`: forced **off** (not overridable, removed from the option type) — the built-in LaTeX preprocessor runs first and already owns `$`/`$$` handling, including truncating unclosed `$$` tails. Two writers on the same delimiters would fight.

### Interactions with the streaming optimizations

- **Block-level memoization** (`blockMemo`, default on): zero conflict. Repairs only affect the tail; earlier blocks' bytes — and therefore their memoized hast — are untouched.
- **Incremental parsing** (`incrementalParse`): partial discount. A frame whose tail was repaired is not a byte-append of the previous frame, so the engine's append gate falls back to a full parse for exactly the frames sitting inside an unterminated construct. The fallback is per-frame, not sticky — splicing resumes as soon as the construct closes in the real bytes. Typical prose streams degrade on a minority of frames; heavily-inline content degrades more. Both flags stay correct in combination; you are trading some splice hits for mid-stream visual completeness.

### Footguns

- **Create the preprocessor once** (module scope or `useMemo`). A fresh factory call per render defeats `contentPreprocessors`' stable-value memoization and re-runs the whole pipeline every frame.
- **Cost is per frame over the WHOLE content, and superlinear on some inputs.** `remend` re-runs on every streamed chunk; internally it makes ~a dozen full-string passes, and its false-positive guards (single `~` between word characters, `>` in list items) re-lex from the string start once per match. A very long answer dense in such characters (shell paths, `~50%`, quoted comparisons) can spend tens of milliseconds per token frame in the preprocessor — before the pipeline the incremental engine optimizes even starts. Profile with the DevTools Performance panel if your payloads are large; the repairs themselves only ever concern the tail.
- **Don't apply it to static content.** A document that legitimately ends inside an unterminated marker (a trailing lone `*`) gets it closed. Reserve it for streaming UIs, or swap it out when `streaming` flips false (see the streaming-state pattern below).
- **Repair runs after `preprocessLaTeX`** (it lives in the caller slot). In the rare mid-stream frame where an unterminated code span contains currency (`` `$100 and… ``), the LaTeX pass may escape the `$` before the span is closed by the repair — a transient artifact on that frame only; it self-heals when the real closing backtick streams in.

---

## Recipes

### Strip YAML frontmatter

```ts
const stripFrontmatter: AIMDContentPreprocessor = (content) => {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  return end === -1 ? content : content.slice(end + 5);
};
```

Using `indexOf` is friendlier than regex on large inputs — frontmatter only lives at the start, so anchoring the search at offset 4 cuts work proportionally.

### Normalize curly quotes back to straight

The library enables SmartyPants by default, which converts straight quotes to curly. If your downstream tooling (e.g. an `<input>` autocomplete) expects straight quotes, undo it _before_ the pipeline sees them by filtering `smartypants` out of `enginePlugins` (see [the filter idiom](./cjk-typography.md#engineplugins-replaces-the-array)) — preprocessors run too early to undo decisions the remark plugins haven't made yet.

### Auto-link bare URLs that the model emitted without `<…>`

GFM already auto-links `https://…` in paragraph text. But some model outputs include URLs glued to surrounding punctuation (`see https://example.com.`) that GFM splits awkwardly. A preprocessor can rewrite these into explicit autolinks:

```ts
const explicitAutolinks: AIMDContentPreprocessor = (content) =>
  content.replace(/(?<![<\(\[\w])(https?:\/\/[^\s<>"]+?)(?=[.,;:?!]?(?:\s|$))/g, '<$1>');
```

### Convert `\n\n\n+` (too many blank lines) to standard paragraph breaks

```ts
const normalizeBlankLines: AIMDContentPreprocessor = (content) => content.replace(/\n{3,}/g, '\n\n');
```

Some models over-produce blank lines as they stream. CommonMark already treats 2+ blank lines as a single break, but stripping the noise upfront makes block-level memoization more effective (fewer position shifts).

### Replace `[[wikilink]]` syntax with standard markdown links

```ts
const wikiLinks: AIMDContentPreprocessor = (content) =>
  content.replace(/\[\[([^\]]+)\]\]/g, (_, name) => `[${name}](/wiki/${encodeURIComponent(name)})`);
```

A common request for assistants that produce Obsidian-style output. The preprocessor approach keeps the rest of the pipeline (sanitization, custom components, KaTeX) working unchanged.

### Translate LLM-specific markers ("[end of stream]", citation tags, etc.)

```ts
const stripStreamMarkers: AIMDContentPreprocessor = (content) =>
  content.replace(/\[end of stream\]\s*$/i, '').replace(/<\/citation>/g, '');
```

Useful when an upstream LLM emits sentinels you don't want surfaced.

### Multi-step pipeline

```ts
const pipeline: AIMDContentPreprocessor[] = [
  stripFrontmatter,
  normalizeBlankLines,
  stripStreamMarkers,
  wikiLinks,
];

<AIMarkdown content={raw} contentPreprocessors={pipeline} />
```

Compose by ordering, not by combining functions inside one preprocessor — this keeps each step testable in isolation.

---

## Reference stability

`contentPreprocessors` is internally stabilized via `useStableValue` (deep-equal). An inline array works correctness-wise, but pays a deep-compare cost on every render. The recommended pattern is module scope:

```ts
// ✅ Stable identity, zero overhead.
const PREPROCESSORS: AIMDContentPreprocessor[] = [stripFrontmatter, normalizeBlankLines];

function App({ content }) {
  return <AIMarkdown content={content} contentPreprocessors={PREPROCESSORS} />;
}
```

The functions themselves should also be module-scope. A `function strip(content) {…}` declaration is identity-stable; a closure-over-render-state lambda isn't.

---

## When a preprocessor is the wrong tool

Preprocessors operate on raw text. They can't see the parsed AST, can't inspect what's a code block vs a paragraph, and can't avoid affecting content inside fenced code:

````markdown
Look at this output:

```text
---
my-frontmatter-looking-block
---
```
````

A `stripFrontmatter` preprocessor that runs `content.replace(/^---[\s\S]*?---\n/, '')` against this input… is fine here (the `---` is not at the start). But a less careful regex might munge the fenced block. For **structural** transformations (changing how a fenced block renders, rewriting a specific node type), write a remark or rehype plugin instead — those operate on the AST and respect node types.

The library doesn't expose plugin slots directly because of the architectural constraints of block-level memoization (the pipeline plan is built once per content change). If you need plugin-level customization, [fork the pipeline via a custom sub-package](./extending-via-subpackage.md).

---

## Footguns

### Mutating shared state inside a preprocessor

Preprocessors are called during render. Mutating module-level state from inside one causes inconsistencies under React's concurrent rendering (an aborted render may have partially mutated and never rolled back):

```ts
// ⚠️ Mutating shared state inside a preprocessor.
let callCount = 0;
const counting: AIMDContentPreprocessor = (content) => {
  callCount++; // visible to other parts of the app, not safe under concurrent rendering
  return content;
};

// ✅ Preprocessors should be pure.
```

### Preprocessor that depends on streaming-state

If your transformation differs based on `streaming === true/false`, encoding that into a preprocessor is awkward — preprocessors don't receive render state. Two cleaner options:

1. **Keep the transformation in the preprocessor unconditionally.** Most cleanup transforms (frontmatter strip, blank-line normalize) are safe to run on partial streamed input.
2. **Move the decision to the call site.** Pre-compute the desired `content` string upstream of `<AIMarkdown>`.

```tsx
function StreamingDoc({ rawContent, isStreaming }) {
  const content = useMemo(() => (isStreaming ? rawContent : finalCleanup(rawContent)), [rawContent, isStreaming]);
  return <AIMarkdown content={content} streaming={isStreaming} />;
}
```

### Preprocessor that's expensive on long inputs

The library re-runs the preprocessor chain whenever `content` changes — which during streaming is on every chunk. A preprocessor that does `O(n²)` work per call will be the dominant cost.

For very large documents, use cheap, single-pass regex transforms; profile with React DevTools before optimizing.
