/**
 * The curated fixture library. Every story that needs markdown pulls it from
 * here so the same document can appear in a feature story, in the Playground,
 * and (later) in another framework's Storybook without being retyped.
 *
 * House rules for anything added here:
 * - No network resources. Images point at `.storybook/assets/` (served through
 *   `staticDirs`), so the whole site renders with zero external requests.
 * - Self-contained: a fixture must make sense on its own, without the prose of
 *   the story that happens to use it.
 */

/**
 * The GFM baseline: one short document touching every syntax a reader expects
 * to work before they look at anything else — headings, emphasis, both list
 * flavors plus task items, an aligned table, a nested blockquote, an autolink,
 * strikethrough, inline code, and a thematic break.
 */
export const GFM_BASICS: string = [
  '# Markdown basics',
  '',
  'A short document covering the syntax `@ai-react-markdown/core` handles out of',
  'the box. Text can be *emphasized*, **strong**, ~~struck through~~, or marked as',
  '`inline code`.',
  '',
  '## Lists',
  '',
  '- Unordered item',
  '- Another item',
  '  - Nested one level',
  '',
  '1. First ordered item',
  '2. Second ordered item',
  '3. Third ordered item',
  '',
  '- [x] Task lists render as checkboxes',
  '- [ ] Unchecked items stay unchecked',
  '',
  '## Table',
  '',
  '| Prop               | Type      |   Default |',
  '| :----------------- | :-------: | --------: |',
  '| `content`          | `string`  |  required |',
  '| `streaming`        | `boolean` |   `false` |',
  '| `blockMemo`        | `boolean` |    `true` |',
  '',
  '## Quotes and links',
  '',
  '> Blockquotes carry **inline formatting** too.',
  '>',
  '> > And they nest.',
  '',
  'Autolinks resolve on their own: https://github.com/AIEPhoenix/ai-react-markdown',
  '',
  '---',
  '',
  'That is the baseline. Everything else in this Storybook builds on it.',
].join('\n');

/**
 * A short prose sample for the theming stories, where the same document is
 * rendered three or four times on one page. It touches the elements a size or
 * color change is most visible on — two heading levels, body text, inline
 * code, a list, a blockquote — and stays short enough that the copies fit
 * side by side. No links and no task items, so it does not drag the known
 * library-level a11y violations into a story that is about theming.
 */
export const PROSE_SAMPLE: string = [
  '# Rendering pipeline',
  '',
  'The renderer parses markdown to mdast, runs the selected engine plugins, and',
  'hands the result to React. Every dimension it draws is derived from a single',
  'anchor, `--aim-font-size-root`.',
  '',
  '## What scales',
  '',
  '- Headings, at their own multiple of the anchor',
  '- Vertical rhythm — the spacing scale is anchored the same way',
  '- Inline `code` spans and fenced blocks',
  '',
  '> Changing one prop rescales the whole document, because nothing in the',
  '> default variant is written as an absolute length.',
].join('\n');

/**
 * Table alignment on its own: the three column alignments GFM understands
 * (`:---`, `:---:`, `---:`), a default-aligned column, and cells carrying
 * inline formatting. Deliberately narrow so the alignment is the only thing
 * a reader has to look at.
 */
export const TABLES_DOC: string = [
  '## Column alignment',
  '',
  'The dashes in the delimiter row decide the alignment: a leading colon means',
  'left, colons on both ends mean center, a trailing colon means right, and a',
  'bare run of dashes leaves the cell at its default.',
  '',
  '| Default    | Left        |   Center   |       Right |',
  '| ---------- | :---------- | :--------: | ----------: |',
  '| `content`  | `string`    |  required  |           — |',
  '| `fontSize` | `string`    |  optional  |  `0.9375rem` |',
  '| `streaming`| `boolean`   |  optional  |     `false` |',
  '',
  '## Formatting inside cells',
  '',
  '| Syntax          | Renders as                     |',
  '| :-------------- | :----------------------------- |',
  '| `**strong**`    | **strong**                     |',
  '| `` `code` ``    | `code`                         |',
  '| `~~struck~~`    | ~~struck~~                     |',
  '| `[a link](https://example.com)` | [a link](https://example.com) |',
].join('\n');

/**
 * GFM task lists, checked and unchecked, flat and nested. The checkboxes are
 * rendered `disabled` — the markdown describes state, it does not offer an
 * input the reader can change.
 */
export const TASK_LIST_DOC: string = [
  '## Release checklist',
  '',
  '- [x] Freeze the branch',
  '- [x] Run the soak suite',
  '- [ ] Write the release notes',
  '  - [x] Collect the merged pull requests',
  '  - [ ] Summarize the breaking changes',
  '- [ ] Publish to npm',
  '',
  'Task items mix freely with ordinary list items:',
  '',
  '- [ ] An item with a checkbox',
  '- An item without one',
  '- [x] Another checked item, this one with **emphasis** and `code`',
].join('\n');

/**
 * Footnotes in every shape the GFM extension supports: a numeric label, a
 * named label, a multi-paragraph definition, and a definition carrying a
 * fenced code block. Note that the rendered numbering follows the order the
 * references appear in the prose, not the order of the definitions or the
 * labels themselves — `[^setup]` below is footnote 2 because it is referenced
 * second.
 */
export const FOOTNOTES_DOC: string = [
  '# Footnotes',
  '',
  'The renderer collects every definition into a single footer section and',
  'renumbers the markers[^1] in reference order. Labels can be numbers or',
  'words[^setup], and a definition can run to several paragraphs[^long].',
  '',
  'A reference may also appear inside other inline formatting, such as',
  '**bold text[^nested]** or a list item:',
  '',
  '- The first item cites a source[^1].',
  '- The second one does not.',
  '',
  '[^1]: A short, single-paragraph definition.',
  '',
  '[^setup]: Referenced second, so it renders as footnote 2 regardless of',
  '    where its definition sits in the source.',
  '',
  '[^long]: The first paragraph of a longer note.',
  '',
  '    A second paragraph, indented four spaces to stay inside the note.',
  '',
  '    ```ts',
  "    import { defaultEnginePlugins } from '@ai-react-markdown/core/plugins';",
  '    ```',
  '',
  '[^nested]: Definitions are matched by label, so nesting the reference',
  '    inside emphasis changes nothing.',
].join('\n');

/**
 * PHP-Markdown-Extra definition lists — a term on one line, its definitions on
 * following lines opened with `: `. Without the `definitionList` engine plugin
 * this exact source renders as ordinary paragraphs with literal colons, which
 * is what the Engine Plugins comparison shows.
 */
export const DEFINITION_LIST_DOC: string = [
  '# Glossary',
  '',
  'Design token',
  ': A named CSS custom property such as `--aim-color-anchor`.',
  ': The smallest unit a consumer can override without touching a stylesheet.',
  '',
  'Engine plugin',
  ': One selectable entry in the parse chain. The set is sealed — plugins are',
  '  values exported by the library, not functions a consumer writes.',
  '',
  'Prefix freeze',
  ': The incremental parsing strategy. Everything before the frozen boundary is',
  '  reused verbatim across a streaming append; only the tail is reparsed.',
  '',
  'A term may carry inline formatting, and so may its definitions:',
  '',
  '**Clobber prefix**',
  ': The per-document namespace prepended to generated ids so that two',
  '  documents on one page cannot collide.',
].join('\n');

/**
 * Math in both flavors. Inline `$…$` is normalized to display-safe delimiters
 * by the content preprocessor before parsing; `$$…$$` on its own lines becomes
 * a centered block. Includes an `aligned` environment and a matrix, since
 * those are where a KaTeX stylesheet that failed to load is most obvious.
 */
export const MATH_DOC: string = [
  '# Math',
  '',
  'Inline formulas sit in the run of text: the mass–energy equivalence $E = mc^2$',
  'and the golden ratio $\\varphi = \\frac{1 + \\sqrt{5}}{2}$ both flow with the',
  'surrounding prose.',
  '',
  '## Display math',
  '',
  'A `$$` block is centered on its own line:',
  '',
  '$$',
  '\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '## Aligned equations',
  '',
  '$$',
  '\\begin{aligned}',
  'f(x) &= (x + 1)^2 \\\\',
  '     &= x^2 + 2x + 1',
  '\\end{aligned}',
  '$$',
  '',
  '## Matrices',
  '',
  '$$',
  'A = \\begin{pmatrix}',
  '1 & 2 \\\\',
  '3 & 4',
  '\\end{pmatrix}',
  '\\qquad',
  '\\det A = -2',
  '$$',
  '',
  'Sums and limits keep their full size in display mode:',
  '',
  '$$',
  '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
  '$$',
].join('\n');

/**
 * Chinese, Japanese, and Korean prose against the two typography rules that
 * matter for CJK: emphasis delimiters that sit next to full-width punctuation,
 * and the missing space where a Latin word abuts a CJK character. The Latin
 * runs here are deliberately written WITHOUT surrounding spaces — that is the
 * input the `pangu` plugin exists to fix, and a pre-spaced fixture would make
 * the plugin look like a no-op. The Korean section is unspaced too, and stays
 * that way: the spacing rule covers Han characters and kana, not Hangul.
 */
export const CJK_MIXED_DOC: string = [
  '# 国际化文本',
  '',
  '## 中文',
  '',
  '这个组件用React18写的，构建工具是Vite，包管理器用pnpm。',
  '**「强调」**紧跟全角标点时，星号依然要渲染成加粗。',
  '',
  '## 日本語',
  '',
  'このライブラリはTypeScriptで書かれており、Reactのバージョンは18です。',
  '**「強調」**の直後に句読点が来ても、アスタリスクは記号として扱われます。',
  '',
  '## 한국어',
  '',
  '이 라이브러리는TypeScript로 작성되었고React18에서 동작합니다.',
  '**「강조」**뒤에 문장 부호가 와도 별표는 그대로 표시되지 않습니다.',
  '',
  '## 表格',
  '',
  '| 属性 | 类型 | 说明 |',
  '| :--- | :--- | :--- |',
  '| `content` | `string` | 要渲染的markdown文本 |',
  '| `streaming` | `boolean` | 是否处于流式输出中 |',
  '| `fontSize` | `string` | 根字号，其余尺寸按比例缩放 |',
].join('\n');

/**
 * A right-to-left document. The browser resolves the direction from the
 * characters themselves (the Unicode bidirectional algorithm), so no `dir`
 * attribute is needed for the paragraph to lay out right-to-left — but list
 * markers and the Latin fragment inside the last item are worth looking at,
 * because that is where a naive renderer breaks the run.
 */
export const RTL_DOC: string = [
  '# النص العربي',
  '',
  'هذه فقرة قصيرة باللغة العربية تعرض كيفية عرض النص من اليمين إلى اليسار.',
  'المتصفح يحدد اتجاه النص من الأحرف نفسها.',
  '',
  '- العنصر الأول',
  '- العنصر الثاني',
  '- عنصر يحتوي على كلمة إنجليزية مثل `streaming` داخل النص',
  '',
  '> اقتباس قصير يوضح أن التنسيق يعمل أيضًا مع النص العربي.',
].join('\n');

/**
 * `==marked==` runs, the syntax the `highlight` engine plugin adds. The name
 * is worth reading carefully: the plugin turns `==text==` into a `<mark>`
 * element. It has nothing to do with syntax highlighting inside code fences.
 */
export const MARK_HIGHLIGHT_DOC: string = [
  '# Highlighted text',
  '',
  'A run wrapped in double equals signs becomes ==a mark element==, which the',
  'default stylesheet paints with `--aim-color-mark-bg`.',
  '',
  '- A ==highlighted phrase== inside a list item',
  '- Highlighting composes with **bold**, so ==**both at once**== works',
  '- It stops at the closing delimiter: ==this is marked== and this is not',
  '',
  '> A blockquote can carry ==a highlight== too.',
  '',
  'Inside a code span the syntax is inert: `==not marked==`.',
].join('\n');

/**
 * Straight quotes, dashes, and dot runs — the input the `smartypants` plugin
 * rewrites into typographic punctuation. What actually changes: straight
 * double and single quotes curl, `--` becomes a dash, and `...` becomes a
 * single ellipsis character. A run of three hyphens is left alone.
 */
export const SMARTYPANTS_DOC: string = [
  '# Typographic punctuation',
  '',
  'She said "the renderer handles this" and then added \'or it should\'.',
  '',
  'A pause -- the kind that wants a dash -- and a trailing thought...',
  '',
  'A run of three hyphens --- inside a sentence is left exactly as typed.',
  '',
  '- "Quoted list item"',
  "- An item with an apostrophe: the parser's job",
  '- A range written with a dash: pages 10 -- 20',
  '',
  'Inside code the characters are left exactly as typed: `"quoted" -- and...`,',
  'and the same holds for fenced blocks:',
  '',
  '```text',
  'printf("literal -- quotes and dots... survive\\n");',
  '```',
].join('\n');

/**
 * Prose interleaved with HTML comments. Useful for checking what a reader can
 * see: the comment text must not reach the page under any configuration.
 */
export const COMMENTS_DOC: string = [
  '# Draft notes',
  '',
  '<!-- Reviewer: tighten the opening paragraph before publishing. -->',
  '',
  'The visible document opens here. Nothing in this paragraph came from a',
  'comment, and nothing a comment says should ever appear on the page.',
  '',
  'A comment can also sit inline <!-- like this one --> in the middle of a',
  'sentence without breaking the run of text around it.',
  '',
  '<!--',
  'A multi-line comment.',
  'It holds several lines of notes that are not part of the document.',
  '-->',
  '',
  '## Second section',
  '',
  'Comments inside a fenced block are content, not comments, and stay visible:',
  '',
  '```html',
  '<!-- this one is source code, so it renders -->',
  '```',
].join('\n');

/**
 * Every link scheme worth testing at once, including the two the default
 * sanitize schema drops (`javascript:` and `data:`) and one custom scheme a
 * consumer might want to allow. Dropped links keep their text and lose their
 * `href`, so the prose stays readable.
 */
export const URL_SCHEMES_DOC: string = [
  '# Link schemes',
  '',
  'Allowed by the default schema:',
  '',
  '- [An absolute https link](https://example.com/guide)',
  '- [A relative link](./getting-started.md)',
  '- [A fragment link](#link-schemes)',
  '- [A mailto link](mailto:support@example.com)',
  '',
  'Dropped by the default schema — the text survives, the `href` does not:',
  '',
  '- [A javascript: link](javascript:alert(1))',
  '- [A data: link](data:text/html,hello)',
  '',
  'Dropped unless the consumer extends the schema:',
  '',
  '- [A custom app scheme](app://settings/appearance)',
  '- [Another custom scheme](myapp:open?id=42)',
  '',
  'Autolinks go through the same check: https://example.com/autolinked',
].join('\n');

/**
 * One chunk of an answer whose footnote definitions have landed but whose
 * citing sentence has not. Every definition here is an **orphan** — no `[^…]`
 * reference matches it anywhere in this chunk — which is the exact state the
 * `preserveOrphanReferences` switch decides what to do with.
 *
 * Deliberately contains no reference at all. A definition that sits above its
 * own reference in the same document is a different (and currently
 * mis-rendered) case, and mixing the two would make the comparison unreadable.
 */
export const ORPHAN_FOOTNOTE_CHUNK: string = [
  '## Sources',
  '',
  '[^soak]: The soak suite runs 300k splice iterations against the incremental',
  '    parser before a release is tagged.',
  '[^artifacts]: Every published artifact is verified against the pushed tag',
  '    before the release notes go out.',
  '',
  'The paragraph that cites both of those notes is still being written, so at',
  'this instant the definitions have nothing pointing at them',
].join('\n');

/**
 * Link-heavy prose with two code fences — the document the custom-component
 * stories render, where an `a` override and a `pre` override both have plenty
 * to attach themselves to. Every URL is on an allowed scheme, so nothing here
 * is competing with the sanitization stories for the reader's attention.
 */
export const LINKED_PROSE_DOC: string = [
  '# Integration notes',
  '',
  'Start from the [package README](https://example.com/readme) and the',
  '[configuration guide](https://example.com/config). The [changelog](https://example.com/changelog)',
  'lists what moved in each major version, and questions go to the',
  '[issue tracker](https://example.com/issues).',
  '',
  'Install it and render a string:',
  '',
  '```tsx',
  "import AIMarkdown from '@ai-react-markdown/core';",
  '',
  'export const Answer = ({ text }: { text: string }) => <AIMarkdown content={text} />;',
  '```',
  '',
  'Replacing a renderer is one prop. See the [custom components guide](https://example.com/custom-components)',
  'for the full element list:',
  '',
  '```ts',
  'const COMPONENTS = { a: BadgedLink, pre: CopyPre };',
  '```',
  '',
  'Contact [support](mailto:support@example.com) if a document renders wrong.',
].join('\n');

/**
 * A run of code fences. The library emits `language-*` class names and leaves
 * token colouring to the host application (or to the Mantine package, which
 * substitutes a highlighting code block) — nothing here is syntax highlighted
 * by core. The fixture also covers the two info-string shapes worth knowing
 * about: a `language:filename` string, which becomes the class verbatim, and
 * an unknown language, which is passed through untouched.
 */
export const CODE_SAMPLES_DOC: string = [
  '# Code blocks',
  '',
  'A TypeScript fence:',
  '',
  '```ts',
  "import AIMarkdown from '@ai-react-markdown/core';",
  '',
  'export const Answer = ({ text }: { text: string }) => (',
  '  <AIMarkdown content={text} streaming />',
  ');',
  '```',
  '',
  'A Python fence:',
  '',
  '```python',
  'def stream(chunks):',
  '    buffer = ""',
  '    for chunk in chunks:',
  '        buffer += chunk',
  '        yield buffer',
  '```',
  '',
  'A minified JSON payload, wide enough to need horizontal scrolling:',
  '',
  '```json',
  '{"model":"claude","stream":true,"messages":[{"role":"user","content":"hi"}],"max_tokens":1024,"metadata":{"session":"a1b2c3","retries":0}}',
  '```',
  '',
  'An info string carrying a filename — the whole string becomes the class name:',
  '',
  '```js:src/main.js',
  "console.log('hello');",
  '```',
  '',
  'An unrecognized language is passed through rather than guessed at:',
  '',
  '```wobbledy',
  'nobody knows what this is',
  '```',
  '',
  'And a fence with no info string at all:',
  '',
  '```',
  'plain preformatted text',
  '```',
].join('\n');

/**
 * An answer that leaks credentials three ways — bare in prose, inside an
 * inline code span, and inside a fenced block. All three keys are invented and
 * match no real key format closely enough to be mistaken for one; the point is
 * only that a text-stage rewrite reaches all three positions, where a
 * tree-stage one would have to be taught about each.
 */
export const SECRETS_DOC: string = [
  '# Deploying the worker',
  '',
  'Set the API key to sk-a91f4c7d2be08135 before the first request, or the',
  'client falls back to anonymous quota.',
  '',
  'You can also export it inline: `export ANTHROPIC_API_KEY=sk-77b0e14aa9c3d562`.',
  '',
  '```bash',
  'curl https://api.example.test/v1/messages \\',
  "  -H 'x-api-key: sk-3f1c99e07ad4b628' \\",
  "  -H 'content-type: application/json'",
  '```',
  '',
  'Rotate the key after the deploy.',
].join('\n');

/**
 * One streaming frame, frozen at the least convenient moment. The document is
 * well-formed up to the last paragraph, whose tail sits inside an unclosed
 * `**` run **and** inside a link whose URL is still being typed — the two
 * repairs that are most visible when they are missing.
 *
 * The completed code fence above it is deliberate: `2 ** attempt` is a pair of
 * asterisks that must not be treated as an unclosed emphasis marker, and it is
 * there to prove that tail repair respects fences.
 */
export const BROKEN_TAIL_FRAME: string = [
  '## Rate limiting',
  '',
  'Requests are throttled per organization, not per key, so a burst from one worker',
  'slows the others down. Read `x-ratelimit-remaining` on every response.',
  '',
  '```python',
  'wait = base * (2 ** attempt)',
  '```',
  '',
  'The client recovers with **exponential backoff — see [the retry guidance](https://example.test/re',
].join('\n');

/**
 * The reported CJK emphasis bug, one line per script. Every `**…**` pair here
 * sits against CJK punctuation — a full-width quote, a Japanese 。, a Korean
 * parenthesis — and every one of them must render as emphasis rather than as
 * literal asterisks. The last three repeat the set with `~~` strikethrough
 * nested inside, which is where the naive fix breaks.
 */
export const CJK_EMPHASIS_REGRESSION: string =
  '这是一个**“会引起”**渲染错误的**“已知问题”**，当加重符号\\*\\*遇到某些中文标点时，可能就会出现**“识别不了”**的情况。就如这句话展现的一样。\n\n**このアスタリスクは強調記号として認識されず、そのまま表示されます。**この文のせいで。\n\n**该星号不会被识别，而是直接显示。**这是因为它没有被识别为强调符号。\n\n**이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)**이 문장 때문에.\n\n**~~このアスタリスクは強調記号として認識されず、そのまま表示されます。~~**この文のせいで。\n\n**~~该星号不会被识别，而是直接显示。~~**这是因为它没有被识别为强调符号。\n\n**~~이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)~~**이 문장 때문에.';

/**
 * The showcase document: one plausible assistant answer that touches every
 * capability a reader is likely to look for, written to be read rather than to
 * be inventoried. Prose, three heading levels, four fenced blocks (tsx,
 * Python, shell, and a mermaid source — which core renders as a code block,
 * since diagram drawing lives in the Mantine package), a table, display and
 * inline math, a task list, a blockquote, a pointer to the dedicated CJK
 * stories, a locally served image, and footnotes. English only by owner
 * decision — CJK/RTL text lives solely in
 * the fixtures whose purpose is CJK/RTL (CJK_MIXED_DOC, CJK_EMPHASIS_REGRESSION,
 * RTL_DOC).
 *
 * This is what the Playground streams. It is deliberately well-formed: the
 * malformed-input cases live in `BROKEN_TAIL_FRAME` (tail repair) and in the
 * QA suite, where a failure is an assertion rather than something a reader has
 * to notice.
 */
export const KITCHEN_SINK: string = [
  '# Streaming a model response into React',
  '',
  'You asked how to render tokens as they arrive without the layout jumping around.',
  'The short answer: keep one buffer, parse all of it on every frame, and let the',
  'renderer work out what actually changed. The long answer is below.',
  '',
  '## Why appending markup fails',
  '',
  'A response that is still being written is *malformed* almost all of the time — a',
  'fence that has opened but not closed, a table with a header and no body, a link',
  'whose URL stops halfway. Appending pre-rendered HTML bakes each of those',
  'half-states into the DOM permanently.',
  '',
  '> Treat every frame as a complete document that simply happens to be short.',
  '> A parser that expects well-formed input will fight you on every token.',
  '',
  '## The render loop',
  '',
  '```mermaid',
  'flowchart LR',
  '    A[Token arrives] --> B[Append to buffer]',
  '    B --> C[Parse the whole buffer]',
  '    C --> D{Prefix unchanged?}',
  '    D -- yes --> E[Reuse cached blocks]',
  '    D -- no --> F[Re-render the tail]',
  '    E --> G[Commit]',
  '    F --> G',
  '```',
  '',
  '## Wiring it up',
  '',
  'The client owns a single string and hands it down whole. There is no diffing to',
  'write by hand — `streaming` tells the renderer that the tail is provisional:',
  '',
  '```tsx',
  "import { useEffect, useState } from 'react';",
  "import AIMarkdown from '@ai-react-markdown/core';",
  '',
  'export function Answer({ stream }: { stream: AsyncIterable<string> }) {',
  "  const [text, setText] = useState('');",
  '  const [streaming, setStreaming] = useState(true);',
  '',
  '  useEffect(() => {',
  '    (async () => {',
  '      for await (const delta of stream) setText((prev) => prev + delta);',
  '      setStreaming(false);',
  '    })();',
  '  }, [stream]);',
  '',
  '  return <AIMarkdown content={text} streaming={streaming} />;',
  '}',
  '```',
  '',
  'On the server, relaying an upstream response is the same shape:',
  '',
  '```python',
  'async def relay(client, messages):',
  '    async with client.messages.stream(model=MODEL, messages=messages) as stream:',
  '        async for delta in stream.text_stream:',
  '            yield delta',
  '```',
  '',
  'Worth checking the transport by hand once, before blaming the renderer:',
  '',
  '```bash',
  'curl -N https://api.example.test/v1/messages \\',
  "  -H 'content-type: application/json' \\",
  '  -d @request.json',
  '```',
  '',
  '## What it costs',
  '',
  'Measured on a 12,000-character answer delivered over roughly 900 frames[^bench]:',
  '',
  '| Stage | Median | p95 | Share of frame |',
  '| :---- | -----: | --: | -------------: |',
  '| Parse | 0.9 ms | 2.4 ms | 31% |',
  '| Reconcile | 1.4 ms | 4.1 ms | 48% |',
  '| Paint | 0.6 ms | 1.8 ms | 21% |',
  '',
  'The cost of a frame tracks the number of blocks that changed, not the length of',
  'the document. With $n$ blocks and a per-block render cost $c_i$, the work is',
  'proportional to the blocks whose content actually moved:',
  '',
  '$$',
  'T(n) = t_{\\text{parse}} + \\sum_{i=1}^{n} c_i \\cdot \\left[ b_i \\neq \\hat{b}_i \\right]',
  '$$',
  '',
  'In a streamed answer only the last block changes between most frames, so the sum',
  'collapses to a single term and the parse dominates.',
  '',
  '## Before you ship',
  '',
  '- [x] Render from one buffer, never from appended fragments',
  '- [x] Keep the parse a pure function of the buffer',
  '- [ ] Decide what a footnote does before its citation arrives',
  '  - [x] Pick a policy',
  '  - [ ] Write it down for the next reader',
  '- [ ] Show something when the stream stalls',
  '',
  '## Beyond Latin text',
  '',
  'Answers are not always English. Emphasis markers that sit flush against',
  'full-width punctuation, spacing between CJK and Latin words, right-to-left',
  'paragraphs — each has its own failure mode, and each has a dedicated story',
  'under *Features → CJK & International Text* showing how the renderer handles',
  'it.',
  '',
  '![Streaming document icon](./vue-markdown-icon.svg "Streaming document icon")',
  '',
  'That icon is served from the local assets directory — this document makes no',
  'external requests.',
  '',
  '[^bench]: Numbers come from the Performance Lab harnesses in this Storybook,',
  '    running a development build of React. Treat the ratios as meaningful and the',
  '    absolute values as inflated.',
].join('\n');
