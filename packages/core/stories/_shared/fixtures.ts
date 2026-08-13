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
 * A document cut off mid-sentence, with its reference definitions declared up
 * front and used further down — the shape a paused stream leaves behind. The
 * last `[spec]` reference has no definition yet, and the trailing sentence
 * stops without a period. Consumed by the orphan-reference stories, where the
 * point is that the definitions above the cut must not leak into the page as
 * literal text.
 */
export const ORPHAN_REF_DOC_TRUNCATED: string = [
  '# Release process',
  '',
  '[repo]: https://example.com/repo',
  '[issues]: https://example.com/issues',
  '[changelog]: https://example.com/changelog',
  '',
  'Every release starts from a green build on the default branch of the',
  '[main repository][repo]. Open questions are tracked in the [issue',
  'tracker][issues] and summarized in the [changelog][changelog] once the',
  'tag is pushed.',
  '',
  '## Checklist',
  '',
  '1. Confirm the soak suite finished.',
  '2. Update the version across the published packages.',
  '3. Verify the published artifacts against the [specification][spec]',
  '',
  'The final step is to announce the release, which means writing a short',
  'summary of the user-visible changes and',
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
 * The kitchen-sink payload: a single long response mixing thinking tags, raw
 * HTML, links, tables, KaTeX, admonitions, RTL text, many code fences,
 * mermaid diagrams, definition lists, and footnotes. This is what the
 * Playground streams — it exists to break things, so keep it messy (the
 * malformed LaTeX and the stray `>>>` are load-bearing).
 */
export const KITCHEN_SINK: string =
  '<thinking>我们被要求思考斐波那契数的实现过程。斐波那契数列的定义是：F(0)=0, F(1)=1, 对于n>=2，F(n)=F(n-1)+F(n-2)。有多种方法可以实现斐波那契数的计算，包括递归、迭代、矩阵快速幂、通项公式等。我们需要讨论这些方法的优缺点，可能还需要考虑时间复杂度和空间复杂度。\n\n由于用户只说了“思考一下斐波拉契数的实现过程”，我们需要给出一个全面的回答，可能包括不同的实现方法及其分析。\n\n我将用中文回答，因为用户的问题是中文的。\n\n首先，斐波那契数列是一个经典的数列，在计算机科学中常被用来演示算法和优化。以下是一些常见的实现方法：\n\n1. **递归实现**：直接根据定义递归地计算F(n)。这种方法简单直观，但效率极低，因为它会产生大量的重复计算。时间复杂度为O(2^n)，空间复杂度为O(n)（递归栈深度）。\n\n2. **记忆化递归（动态规划）**：使用一个数组或哈希表来存储已经计算过的斐波那契数，避免重复计算。时间复杂度为O(n)，空间复杂度为O(n)。\n\n3. **迭代实现（动态规划）**：使用循环从底向上计算，只保留前两个值。时间复杂度为O(n)，空间复杂度为O(1)（只存储两个变量）。\n\n4. **矩阵快速幂**：利用矩阵乘法可以将斐波那契数的计算转化为矩阵的幂运算。通过快速幂算法，可以在O(log n)时间内计算F(n)。空间复杂度为O(1)（存储矩阵）。\n\n5. **通项公式（比内公式）**：斐波那契数有通项公式：F(n) = (φ^n - ψ^n)/√5，其中φ=(1+√5)/2，ψ=(1-√5)/2。由于浮点数精度问题，对于较大的n可能不准确。时间复杂度取决于幂运算，通常为O(log n)（使用快速幂），但可能有精度误差。\n\n6. **其他方法**：如使用生成函数、递推关系等。\n\n在编程中，根据n的大小和对精度、性能的要求选择合适的方法。对于小n，递归或迭代都可以；对于大n，矩阵快速幂或通项公式更高效。\n\n此外，还需要注意整数溢出问题，当n很大时，斐波那契数可能超过整数范围，需要使用大整数运算。\n\n现在，我可以给出一个详细的回答，涵盖这些方法，并讨论它们的优缺点。\n\n由于用户没有指定n的范围或其他要求，我将提供一个全面的分析。\n\n最后，我将用中文总结。\n</thinking>\n\n>>>I\'ll create a simple Electron + Vue chat application demo. Here\'s the structure:\n\n[Star on GitHub](https://github.com/Simon-He95/markstream-vue)\n\n<a href="https://simonhe.me/">我是 a 元素标签</a>\n\nhttps://github.com/Simon-He95/markstream-vue\n\n[【Author: Simon】](https://simonhe.me/)\n\n- **[Link (Test 1)](https://simonhe.me/)**\n\n**[Link (Test 2)](https://simonhe.me/)**\n\n**Markdown链接**：  \n1. [GitHub官网](https://github.com)  \n2. [知乎 - 有问题就会有答案](https://www.zhihu.com)  \n3. **加粗链接**：[Google](https://www.google.com)  \n4. 嵌套格式的链接：[*斜体链接*](https://example.com)  \n\n**普通链接**：  \n1. https://www.wikipedia.org  \n2. http://example.com/path?query=test  \n3. 纯文本URL：https://markdown-guide.readthedocs.io\n\n![Markdown document icon](./vue-markdown-icon.svg "Markdown document icon")\n*Figure: a locally served placeholder (./vue-markdown-icon.svg) — stories make no external requests.*\n\n这是 ~~已删除的文本~~，这是一个表情 :smile:。\n\n- [ ] Star this repo\n- [x] Fork this repo\n- [ ] Create issues\n- [x] Submit PRs\n\n##  表格\n\n| 姓名 | 年龄 | 职业 |\n|------|------|------|\n| 张三 | 25   | 工程师 |\n| 李四 | 30   | 设计师 |\n| 王五 | 28   | 产品经理 |\n\n### 对齐表格\n| 左对齐 | 居中对齐 | 右对齐 |\n|:-------|:--------:|-------:|\n| 内容1  |  内容2   |  内容3 |\n| 内容4  |  内容5   |  内容6 |\n\n我将为您输出泰勒公式的一般形式及其常见展开式。\n\n---\n\n## 0. 薛定谔方程（量子力学）\n$$i\\hbar \\frac{\\partial}{\\partial t} \\Psi(\\mathbf{r},t) = \\left[ -\\frac{\\hbar^2}{2m} \\nabla^2 + V(\\mathbf{r},t) \\right] \\Psi(\\mathbf{r},t)$$\n\n\n## 1. 泰勒公式（Taylor\'s Formula）\n\n### 一般形式（在点 \\(x = a\\) 处展开）：\n[\nf(x) = f(a) + f\'(a)(x-a) + \frac{f\'\'(a)}{2!}(x-a)^2 + \frac{f\'\'\'(a)}{3!}(x-a)^3 + cdots + \frac{f^{(n)}(a)}{n!}(x-a)^n + R_n(x)\n\\]\n\n其中：\n- \\(f^{(k)}(a)\\) 是 \\(f(x)\\) 在 \\(x=a\\) 处的 \\(k\\) 阶导数\n- \\(R_n(x)\\) 是余项，常见形式有拉格朗日余项：\n[\nR_n(x) = \frac{f^{(n+1)}(xi)}{(n+1)!}(x-a)^{n+1}, quad xi \text{ 在 } a \text{ 和 } x \text{ 之间}\n\\]\n\n---\n\n## 2. 麦克劳林公式（Maclaurin\'s Formula，即 \\(a=0\\) 时的泰勒公式）：\n[\nf(x) = f(0) + f\'(0)x + \frac{f\'\'(0)}{2!}x^2 + \frac{f\'\'\'(0)}{3!}x^3 + cdots + \frac{f^{(n)}(0)}{n!}x^n + R_n(x)\n\\]\n\n---\n\n## 3. 常见函数的麦克劳林展开（前几项）\n\n- **指数函数**：\n\\[\ne^x = 1 + x + \frac{x^2}{2!} + \frac{x^3}{3!} + cdots + \frac{x^n}{n!} + cdots, quad x in mathbb{R}\n\\]\n\n- **正弦函数**：\n\\[\nsin x = x - \frac{x^3}{3!} + \frac{x^5}{5!} - \frac{x^7}{7!} + cdots + (-1)^n \frac{x^{2n+1}}{(2n+1)!} + cdots\n\\]\n\n- **余弦函数**：\n\\[\ncos x = 1 - \frac{x^2}{2!} + \frac{x^4}{4!} - \frac{x^6}{6!} + cdots + (-1)^n \frac{x^{2n}}{(2n)!} + cdots\n\\]\n\n- **自然对数**（在 \\(x=0\\) 附近）：\n\\[\nln(1+x) = x - \frac{x^2}{2} + \frac{x^3}{3} - \frac{x^4}{4} + cdots + (-1)^{n-1} \frac{x^n}{n} + cdots, quad -1 < x le 1\n\\]\n\n- **二项式展开**（\\( (1+x)^m \\)，\\(m\\) 为实数）：\n[\n(1+x)^m = 1 + mx + \frac{m(m-1)}{2!}x^2 + \frac{m(m-1)(m-2)}{3!}x^3 + cdots, quad |x| < 1\n\\]\n\n- **矩阵**：\n\\[\n\begin{bmatrix}\n2x_2 - 8x_3 = 8 \\\n5x_1 - 5x_3 = 10\nend{bmatrix}\n\\]\n\n- **公式**\n\n\n- **代入数据**\n   \\[\n   \frac{363}{15,!135} \times 100% = 2.398%\n   \\]\n\n- **计算工具验证**\n   通过数学计算工具确认结果：\n   `363 ÷ 15,135 × 100 = 2.39841427...`\n\n- **差异说明**\n   $$E=mc^2$$\n\n---\n\n如果您需要某个特定函数在特定点的泰勒展开，请告诉我，我可以为您详细写出。\n\n::: warning\n这是一个警告块。\n:::\n\n::: tip 提示标题\n这是带标题的提示。\n:::\n\n::: error 错误块\n这是一个错误块。\n:::\n\nمرحبا بكم في عالم اللغة العربية!\n\n```plaintext\npackages/\n```\n\n1. First, let\'s set up the project:\n\n```shellscript\n# Create Vue project\nnpm create vue@latest electron-vue-chat\n\n# Navigate to project\ncd electron-vue-chat\n\n# Install dependencies\nnpm install\nnpm install electron electron-builder vue-router\n\n# Install dev dependencies\nnpm install -D electron-dev-server concurrently wait-on\n```\n\n2. Create the main Electron file:\n\n```javascript:electron/main.js\nconst { app, BrowserWindow } = require(\'electron\');\nconst path = require(\'path\');\nconst isDev = process.env.NODE_ENV === \'development\';\n\nlet mainWindow;\n\nfunction createWindow() {\n  mainWindow = new BrowserWindow({\n    width: 900,\n    height: 680,\n    webPreferences: {\n      nodeIntegration: true,\n      contextIsolation: false\n    }\n  });\n\n  const url = isDev\n    ? \'http://localhost:5173\'\n    : `file://${path.join(__dirname, \'../dist/index.html\')}`;\n\n  mainWindow.loadURL(url);\n\n  if (isDev) {\n    mainWindow.webContents.openDevTools();\n  }\n\n  mainWindow.on(\'closed\', () => {\n    mainWindow = null;\n  });\n}\n\napp.on(\'ready\', createWindow);\n\napp.on(\'window-all-closed\', () => {\n  if (process.platform !== \'darwin\') {\n    app.quit();\n  }\n});\n\napp.on(\'activate\', () => {\n  if (mainWindow === null) {\n    createWindow();\n  }\n});\n```\n\n3. Update package.json:\n\n```diff json:package.json\n{\n  "name": "markstream-vue",\n  "type": "module",\n- "version": "0.0.49",\n+ "version": "0.0.54-beta.1",\n  "packageManager": "pnpm@10.16.1",\n  "description": "A Vue 3 component that renders Markdown string content as HTML, supporting custom components and advanced markdown features.",\n  "author": "Simon He",\n  "license": "MIT",\n  "repository": {\n    "type": "git",\n    "url": "git + git@github.com:Simon-He95/markstream-vue.git"\n  },\n  "bugs": {\n    "url": "https://github.com/Simon-He95/markstream-vue/issues"\n  },\n  "keywords": [\n    "vue",\n    "vue3",\n    "markdown",\n    "markdown-to-html",\n    "markdown-renderer",\n    "vue-markdown",\n    "vue-component",\n    "html",\n    "renderer",\n    "custom-component"\n  ],\n  "exports": {\n    ".": {\n      "types": "./dist/types/exports.d.ts",\n      "import": "./dist/index.js",\n      "require": "./dist/index.cjs"\n    },\n    "./index.css": "./dist/index.css",\n    "./index.tailwind.css": "./dist/index.tailwind.css",\n    "./tailwind": "./dist/tailwind.ts"\n  },\n  "main": "./dist/index.js",\n  "module": "./dist/index.js",\n  "types": "./dist/types/exports.d.ts",\n  "files": [\n    "dist"\n  ],\n}\n```\n\n4. Create chat components \\(diversified languages\\):\n\n```python:src/server/app.py\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Message(BaseModel):\n    sender: str\n    text: str\n\n@app.get("/health")\ndef health():\n    return {"status": "ok"}\n\n@app.post("/echo")\ndef echo(msg: Message):\n    return {"reply": f"Echo: {msg.text}"}\n```\n\n5. Create a native module example (C++):\n\n```cpp:src/native/compute.cpp\n#include <bits/stdc++.h>\nusing namespace std;\n\nint fibonacci(int n){\n  if(n<=1) return n;\n  int a=0,b=1;\n  for(int i=2;i<=n;++i){ int c=a+b; a=b; b=c; }\n  return b;\n}\n\nint main(){\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  cout << "fib(10)=" << fibonacci(10) << "\n";\n  return 0;\n}\n```\n\n6. Update the main App.vue:\n\n```vue:src/App.vue\n<template>\n  <router-view />\n</template>\n\n<style>\n* {\n  margin: 0;\n  padding: 0;\n  box-sizing: border-box;\n}\n\nbody {\n  font-family: Arial, sans-serif;\n}\n</style>\n```\n\n7. Set up the router:\n\n```javascript:src/router/index.js\nimport { createRouter, createWebHistory } from \'vue-router\';\nimport ChatView from \'../views/ChatView.vue\';\n\nconst routes = [\n  {\n    path: \'/\',\n    name: \'chat\',\n    component: ChatView\n  }\n];\n\nconst router = createRouter({\n  history: createWebHistory(),\n  routes\n});\n\nexport default router;\n```\n\n8. Update main.js:\n\n```javascript:src/main.js\nimport { createApp } from \'vue\';\nimport App from \'./App.vue\';\nimport router from \'./router\';\n\ncreateApp(App).use(router).mount(\'#app\');\n```\n\n9. Mermaid graphic:\n\n```mermaid\ngraph TD\n    Kira_Yamato[基拉·大和]\n    Lacus_Clyne[拉克丝·克莱因]\n    Athrun_Zala[阿斯兰·萨拉]\n    Cagalli_Yula_Athha[卡嘉莉·尤拉·阿斯哈]\n    Shinn_Asuka[真·飞鸟]\n    Lunamaria_Hawke[露娜玛丽亚·霍克]\n    COMPASS[世界和平监视组织COMPASS]\n    Foundation[芬德申王国]\n    Orphee_Lam_Tao[奥尔菲·拉姆·陶]\n    %% 节点定义结束，开始定义边\n    Kira_Yamato ---|恋人| Lacus_Clyne\n    Kira_Yamato ---|挚友| Athrun_Zala\n    Kira_Yamato -->|隶属| COMPASS\n    Kira_Yamato -->|前辈| Shinn_Asuka\n    Lacus_Clyne -->|初代总裁| COMPASS\n    Athrun_Zala ---|恋人| Cagalli_Yula_Athha\n    Athrun_Zala -.->|协力| COMPASS\n    Shinn_Asuka ---|恋人| Lunamaria_Hawke\n    Shinn_Asuka -->|隶属| COMPASS\n    Lunamaria_Hawke -->|隶属| COMPASS\n    COMPASS -->|对立| Foundation\n    Orphee_Lam_Tao -->|隶属| Foundation\n    Orphee_Lam_Tao -.->|追求| Lacus_Clyne\n```\n\n```mermaid\n  xychart\n    title "销售收入"\n    x-axis ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"]\n    y-axis "收入" 4000 --> 11000\n    line [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]\n```\n\n```infographic\ninfographic list-row-simple-horizontal-arrow\ndata\n  items\n    - label 步骤 1\n      desc 开始\n    - label 步骤 2\n      desc 进行中\n    - label 步骤 3\n      desc 完成\n```\n\n\n---\n# 复杂数学公式\n\n### 1. **理解 \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 的含义**\n   - \\(\boldsymbol{alpha}\\) 和 \\(\boldsymbol{\beta}\\) 是三维列向量，因此 \\(\boldsymbol{alpha}^T \boldsymbol{\beta}\\) 表示它们的点积（内积）。\n   - \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 意味着向量 \\(\boldsymbol{alpha}\\) 和 \\(\boldsymbol{\beta}\\) 正交（即垂直），因为点积为零表示它们之间的夹角为 90 度。\n\n### 2. **正交补空间的概念**\n   - 在线性代数中，对于一个子空间 \\(W\\)，它的正交补空间（记为 \\(W^perp\\)）定义为所有与 \\(W\\) 中每个向量正交的向量的集合。即：\n     [\n     W^perp = { mathbf{v} in mathbb{R}^3 mid mathbf{v} cdot mathbf{w} = 0 \text{ 对于所有 } mathbf{w} in W }\n     ]\n   - 例如，如果 \\(W\\) 是由一个向量 \\(\boldsymbol{alpha}\\) 张成的一维子空间（即 \\(W = operatorname{span}{\boldsymbol{alpha}}\\)），那么 \\(W^perp\\) 就是所有与 \\(\boldsymbol{alpha}\\) 正交的向量构成的二维平面。\n### 3. **\\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 与正交补空间的联系**\n   - 当 \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 时，这意味着：\n     - \\(\boldsymbol{\beta}\\) 属于 \\(operatorname{span}{\boldsymbol{alpha}}\\) 的正交补空间，即 \\(\boldsymbol{\beta} in (operatorname{span}{\boldsymbol{alpha}})^perp\\)。\n     - 同样，\\(\boldsymbol{alpha}\\) 也属于 \\(operatorname{span}{\boldsymbol{\beta}}\\) 的正交补空间，即 \\(\boldsymbol{alpha} in (operatorname{span}{\boldsymbol{\beta}})^perp\\)。\n   - 换句话说，\\(\boldsymbol{\beta}\\) 与 \\(\boldsymbol{alpha}\\) 张成的直线正交，因此 \\(\boldsymbol{\beta}\\) 位于该直线的垂直平面（即正交补空间）上。反之亦然。\n\n### 4. **在三维空间中的几何意义**\n   - 在三维空间中，如果 \\(\boldsymbol{alpha}\\) 是一个非零向量，那么 \\(operatorname{span}{\boldsymbol{alpha}}\\) 是一条通过原点的直线，而它的正交补空间 \\((operatorname{span}{\boldsymbol{alpha}})^perp\\) 是一个通过原点且与该直线垂直的平面。\n   - \\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 表示 \\(\boldsymbol{\beta}\\) 位于这个垂直平面上。同样，如果 \\(\boldsymbol{\beta}\\) 非零，那么 \\(\boldsymbol{alpha}\\) 也位于与 \\(\boldsymbol{\beta}\\) 垂直的平面上。\n\n### 5. **推广到更一般的情况**\n   - 如果考虑多个向量，正交补空间的概念可以扩展。例如，如果有一组向量 \\({\boldsymbol{alpha}_1, \boldsymbol{alpha}_2, ldots, \boldsymbol{alpha}_k}\\)，那么它们的张成子空间 \\(W = operatorname{span}{\boldsymbol{alpha}_1, ldots, \boldsymbol{alpha}_k}\\) 的正交补空间 \\(W^perp\\) 包含所有与这些向量正交的向量。\n   - 在这种情况下，\\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 可以看作 \\(\boldsymbol{\beta}\\) 与 \\(W\\) 正交的一个特例（当 \\(W\\) 只由 \\(\boldsymbol{alpha}\\) 张成时）。\n总之，\\(\boldsymbol{alpha}^T \boldsymbol{\beta} = 0\\) 直接体现了正交补空间的关系：它表明一个向量属于另一个向量张成子空间的正交补空间。如果你有更多向量或子空间，这种联系可以进一步深化。\n\n**示例：** emm`1-(5)`、`3-(3)`、`3-(4)` complex test `1-(4)`”heiheihei”中，hello world。\n\n---\n\n## Blockquote\n\n> This is a blockquote with **bold**, *italic*, and `inline code`.\n>\n> > Nested blockquotes work too.\n\n## Heading Levels\n\n### Heading 3\n#### Heading 4\n##### Heading 5\n###### Heading 6\n\n## Inline Elements\n\nText with ==highlighted text==, <sub>subscript</sub> and <sup>superscript</sup>, and <ins>inserted text</ins>.\n\nUse `npm install` to install dependencies. The `--save-dev` flag marks it as a dev dependency.\n\n## Definition List\n\nToken System\n: A set of CSS custom properties that define colors, spacing, typography, and other visual attributes.\n\nDesign Token\n: An individual variable (e.g., `--ms-foreground`) that can be overridden to customize the theme.\n\n## Footnotes\n\nThe design token system[^1] enables full theme customization.\n\n[^1]: See `design/architecture.md` for the complete token specification.\n\n::: note\nThis is a note admonition for additional context.\n:::\n\n::: danger\nThis is a danger admonition for critical warnings.\n:::\n\n## Image\n\n![Markdown document icon](./vue-markdown-icon.svg)';
