/**
 * The markdown surface itself — the layer the old corpus had none of.
 *
 * The engine enables fourteen remark/rehype plugins, and the previous corpus
 * exercised zero of them. It was five generated shapes drawn from a nineteen-
 * word English vocabulary: no tables, no footnotes, no definition lists, no
 * raw HTML, no emoji, no CJK. Three of those plugins exist SPECIFICALLY for
 * CJK behaviour, and the corpus was pure ASCII, so the work this library does
 * that its competitors do not was the work least covered.
 *
 * The plugin list this file is written against, read from the engine rather
 * than from memory:
 *
 *   remark-gfm                            tables, strikethrough, task lists,
 *                                         autolinks, footnotes
 *   remark-math                           covered in ../math
 *   remark-breaks                         a single newline is a hard break
 *   remark-cjk-friendly                   emphasis at CJK boundaries
 *   remark-cjk-friendly-gfm-strikethrough the same for ~~
 *   remark-pangu                          spacing between CJK and Latin
 *   remark-definition-list                definition lists
 *   remark-emoji                          :shortcode:
 *   remark-smartypants                    quotes, dashes, ellipses
 *   remark-remove-comments                HTML comments
 *   remark-squeeze-paragraphs             empty paragraphs
 *   rehype-raw (forked)                   raw HTML
 *   rehype-unwrap-images                  an image alone in a paragraph
 *   remark-mark-highlight                 ==mark==
 *
 * WHY NEGATIVE CASES ARE HALF THE FILE. Every one of these plugins rewrites
 * text, and a rewriter is only as good as what it declines to touch. The math
 * layer found this the hard way — six of its eighteen seam fixtures exist to
 * pin things that must NOT change. The same applies here: `:` inside a URL is
 * not an emoji shortcode, `--` inside code is not an em dash, `~~` in a file
 * path is not strikethrough, and an apostrophe in a variable name is not a
 * curly quote.
 */

import { MARKDOWN_MIXED } from './mixed.ts';

export interface MarkdownCase {
  readonly id: string;
  /** What this case is here to expose. */
  readonly probes: string;
  readonly src: string;
  /** Opens a construct it never closes — see MathCase.terminal. */
  readonly terminal?: boolean;
}

/**
 * A stable random-image endpoint.
 *
 * Real images, not a data URI and not a 1x1 pixel: an image that decodes and
 * lays out is the one that can shift the page under a reader, and layout
 * shift from late-arriving images is a thing a streaming renderer is
 * plausibly bad at. The size is in the path, so a case can ask for the shape
 * it needs.
 */
const img = (w = 320, h = 240) => `https://loremflickr.com/${w}/${h}`;

// ── GFM ───────────────────────────────────────────────────────────────────

export const MARKDOWN_GFM: readonly MarkdownCase[] = [
  {
    id: 'gfm-table-alignment',
    probes: 'all three column alignments, and cells of very uneven width',
    src: `| Left | Centre | Right | Default |
| :--- | :----: | ----: | ------- |
| a | b | c | d |
| a much longer cell than its neighbours | x | 1 | — |
| | empty leading cell | 1,000,000 | |`,
  },
  {
    id: 'gfm-table-inline-content',
    probes: 'every inline construct inside table cells, where the pipe is the hazard',
    src: `| Construct | Example | Note |
| --- | --- | --- |
| code | \`a \\| b\` | a pipe inside a span |
| link | [spec](https://example.test) | |
| image | ![tiny](${img(80, 60)}) | |
| emphasis | *em* **strong** ***both*** | |
| strike | ~~gone~~ | |
| mark | ==kept== | |
| math | $x^2$ | |
| break | one<br>two | an HTML break inside a cell |`,
  },
  {
    id: 'gfm-table-wide',
    probes: 'a table far wider than any viewport — horizontal overflow, not wrapping',
    src: `| id | scenario | app | bytes | streamMs | settleMs | commits | chunks | domNodes | renderedNodes | longTasks | totalBlockingMs | rafP95Ms | outcome |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | cold-short | react-core | 2152 | 4 | 14 | 1 | 1 | 214 | 8 | 0 | 0 | 8.4 | settled |
| 2 | cold-xlong | react-core | 1206784 | 11 | 4998 | 1 | 1 | 5224 | 5018 | 3 | 412 | 91.2 | settled |
| 3 | steps-xlong | react-core | 1206784 | 2190 | 95 | 100 | 100 | 5224 | 5018 | 1 | 84 | 22.7 | settled |`,
  },
  {
    id: 'gfm-task-list',
    probes: 'task list items, including nested ones and a mixed ordinary list',
    src: `- [x] Generate the math layer from KaTeX's tables
- [x] Cover all 31 mermaid types
  - [x] Parse-verify every case
  - [ ] Group them by family in the emitted document
- [ ] Wire the five existing corpora onto this one
  - [ ] \`benchmarks/kit\`
  - [ ] \`packages/engine/src/fixtures\`
- an ordinary item with no checkbox
- [ ] a task whose text contains [brackets] and \`[x]\` literally`,
  },
  {
    id: 'gfm-strikethrough',
    probes: 'strikethrough, and the shapes that must not become one',
    src: `The ~~old corpus~~ new corpus covers ~~five~~ ~~fourteen~~ every plugin.

Not strikethrough: a path like \`~/.claude/settings.json\`, a home directory ~,
an approximation ~500ms, and a tilde fence marker ~~~ on its own.`,
  },
  {
    id: 'gfm-autolink',
    probes: 'bare URLs and emails become links; the lookalikes must not',
    src: `Docs live at https://example.test/docs and issues at
https://example.test/issues?q=is%3Aopen+label%3Abug#top. Mail
corpus@example.test for access.

Not autolinks: the word example.test in prose, a version like v11.16.1, a
scoped package @bench/corpus, and a URL inside code: \`https://example.test\`.`,
  },
  {
    id: 'gfm-footnotes',
    probes: 'footnote references and definitions, including multi-paragraph and out-of-order ones',
    src: `The exponent is 1.22[^fit], but the per-update floor is the real
finding[^floor], and the whole reading was nearly wrong[^wrong].

[^floor]: Defined out of order deliberately — the renderer has to collect
    definitions before it can place them.

    A second paragraph inside a footnote, which is what the four-space
    continuation is for.

[^fit]: A least-squares slope over four points on one machine.
[^wrong]: See \`b7a7cc3\`, and the correction in \`e11bdb6\`.`,
  },
  {
    id: 'gfm-footnote-reused',
    probes: 'one definition referenced three times, plus a reference with no definition',
    src: `Measured on the laptop[^env], again after the fix[^env], and once more
under throttle[^env]. The remote machine[^missing] was not used.

[^env]: macOS, unthrottled, four kept samples per cell.`,
  },
];

// ── inline constructs ─────────────────────────────────────────────────────

export const MARKDOWN_INLINE: readonly MarkdownCase[] = [
  {
    id: 'inline-emphasis',
    probes: 'every emphasis form, including the intraword cases the rules differ on',
    src: `*em* and _em_, **strong** and __strong__, ***both*** and ___both___,
**_mixed_** and _**mixed**_.

Intraword: snake_case_name stays whole, but un*bel*ievable emphasises.
Escaped: \\*not emphasis\\* and \\_not emphasis\\_.`,
  },
  {
    id: 'inline-mark',
    probes: '==mark== from remark-mark-highlight, and what must not become one',
    src: `The floor is ==1.6 ms per update==, which is ==98%== of a 24-character
update.

Not a mark: an equality \`a == b\`, a comparison in prose (x == y), and an
escaped \\==pair\\==.`,
  },
  {
    id: 'inline-emoji',
    probes: 'emoji shortcodes from remark-emoji, and the colons that are not shortcodes',
    src: `Status :white_check_mark: green, :warning: watch, :x: failed.
Also :rocket: :tada: :bug: :mag: :hammer_and_wrench:.

Not shortcodes: a time 12:30, a ratio 33:1, a URL https://example.test,
a YAML key \`key: value\`, and a Windows path C:\\Users.`,
  },
  {
    id: 'inline-smartypants',
    probes: 'smart quotes, dashes and ellipses — and the code that must keep straight ones',
    src: `He said "the gate is a green light" -- and it was. It's the checker's
job... not the corpus's.

Ranges use an en dash: pages 10-20, 2026-08-31.

In code they must stay straight: \`const s = "it's ok";\` and \`a -- b\`
and \`x...y\`.`,
  },
  {
    id: 'inline-entities-escapes',
    probes: 'HTML entities and backslash escapes',
    src: `Entities: &amp; &lt; &gt; &quot; &copy; &mdash; &hellip; &#8212; &#x2014;
&nbsp;between&nbsp;words.

Escapes: \\* \\_ \\# \\[ \\] \\( \\) \\\` \\\\ \\| \\~ \\= \\$ \\! \\+ \\- \\.`,
  },
  {
    id: 'inline-breaks',
    probes: 'remark-breaks makes a single newline a hard break — the plugin most visible in prose',
    src: `First line.
Second line, after a single newline.
Third.

A new paragraph, after a blank line.

Trailing-space form:  
also a hard break.

Backslash form:\\
also a hard break.`,
  },
];

// ── links and images ──────────────────────────────────────────────────────

export const MARKDOWN_LINKS: readonly MarkdownCase[] = [
  {
    id: 'image-reference',
    probes: 'reference-style IMAGES — a distinct mdast node from a reference link, and absent until measured',
    src: `Full reference: ![the freeze boundary][boundary]

Collapsed reference: ![boundary][]

Shortcut reference: ![boundary]

A definition with a title, and one reference that resolves to nothing:

![missing][no-such-label]

[boundary]: ${img()} 'The offset before which output cannot change'`,
  },
  {
    id: 'link-forms',
    probes: 'every link form, including reference styles and one with a title',
    src: `An [inline link](https://example.test/a), one [with a title](https://example.test/b "The title"),
a [reference link][ref], a [collapsed one][], and a [shortcut one].

An empty-text link: [](https://example.test/c). A link with formatting:
[**bold** and \`code\`](https://example.test/d).

[ref]: https://example.test/ref "Reference title"
[collapsed one]: https://example.test/collapsed
[shortcut one]: https://example.test/shortcut`,
  },
  {
    id: 'link-hash-and-escapes',
    probes: 'in-document anchors and URLs full of characters that need escaping',
    src: `Jump to [the scale section](#scale--one-size-axis-three-families) or
[a footnote](#user-content-fn-floor).

Awkward URLs: [parens](https://example.test/a_(b)_c),
[spaces](<https://example.test/a b c>),
[query](https://example.test/s?q=a%20b&n=1#frag).`,
  },
  {
    id: 'image-unwrapped',
    probes: 'an image alone in a paragraph — rehype-unwrap-images removes the wrapper',
    src: `![A random photograph](${img(320, 240)})`,
  },
  {
    id: 'image-inline-and-linked',
    probes: 'images that are NOT alone, so the wrapper must stay, plus a linked image',
    src: `Text before ![inline](${img(120, 90)}) and text after.

[![a linked image](${img(320, 240)})](https://example.test/target)

Two in one paragraph: ![one](${img(160, 120)}) ![two](${img(160, 120)})

With a title, which rides on the node rather than in the alt text:
![charted](${img(240, 180)} 'cost per KB against document size')`,
  },
  {
    id: 'image-gallery',
    probes: 'several images arriving late — the layout-shift shape a streaming reader notices',
    src: [1, 2, 3, 4, 5, 6].map((n) => `![Photograph ${n}](${img(400, 300)}?lock=${n})`).join('\n\n'),
  },
  {
    id: 'image-broken',
    probes: 'an image that will not load — alt text and the box it leaves behind',
    src: `![This will not load](https://example.invalid/missing.png)

![No alt text either](https://example.invalid/also-missing.png)`,
  },
];

// ── block structure ───────────────────────────────────────────────────────

export const MARKDOWN_BLOCKS: readonly MarkdownCase[] = [
  {
    id: 'block-indented-code',
    probes: 'indented code — a separate block construct from a fence, and the one that interacts with list indentation',
    src: `An indented block, four spaces, no language and no fence:

    const boundary = computeFreezeBoundary(text);
    if (boundary === 0) return fallback();

A fence with no info string, which parses to the same node type:

\`\`\`
plain text, no highlighting requested
\`\`\`

Inside a list item, where the indentation has to be counted twice:

1.  A step.

        indented code inside the item

2.  The next step.

> Inside a blockquote:
>
>     indented code inside the quote`,
  },
  {
    id: 'block-headings',
    probes: 'both heading syntaxes at every level, plus one with inline formatting',
    src: `# Level one

## Level two

### Level three

#### Level four

##### Level five

###### Level six

Setext level one
================

Setext level two
----------------

## A heading with \`code\`, *emphasis* and a [link](https://example.test)`,
  },
  {
    id: 'block-lists-nested',
    probes: 'ordered and unordered nesting, a custom start, and loose against tight in both flavours',
    src: `1. First
2. Second
   - nested unordered
   - another
     1. and ordered again
     2. deeper
3. Third

Starting at seven:

7. seven
8. eight

A loose ORDERED list, which carries a different spread flag from the bullet one below:

1. first item, with a blank line after it

2. second item

3. third item

Loose list — note the blank lines:

- item one

- item two

Tight list:
- item one
- item two`,
  },
  {
    id: 'block-definition-list',
    probes: 'remark-definition-list — a construct no other corpus in this repo contains',
    src: `Freeze boundary
: The offset before which rendered output cannot change.

Terminal case
: A fixture that opens a construct it never closes.
: A second definition for the same term.

Soak
: The six-leg fresh-seed run that gates a release.

  A second paragraph inside a definition.`,
  },
  {
    id: 'block-quotes',
    probes: 'nested quotes, lazy continuation, and a quote containing other blocks',
    src: `> A quote.
>
> > Nested one level.
> >
> > > And two.

> A quote with lazy continuation
that carries on without the marker.

> A quote containing a list:
>
> - one
> - two
>
> and a fence:
>
> \`\`\`ts
> const x = 1;
> \`\`\``,
  },
  {
    id: 'block-thematic-breaks',
    probes: 'every thematic-break spelling',
    src: `Before.

---

Between.

***

Between.

___

Between.

- - -

After.`,
  },
  {
    id: 'block-squeeze',
    probes: 'the empty paragraphs remark-squeeze-paragraphs removes',
    src: `First paragraph.

<!-- a comment between paragraphs -->

Second paragraph.

<div></div>

Third paragraph.`,
  },
];

// ── raw HTML ──────────────────────────────────────────────────────────────

export const MARKDOWN_HTML: readonly MarkdownCase[] = [
  {
    id: 'html-inline',
    probes: 'inline HTML mixed into prose — the rehype-raw path',
    src: `Text with <strong>bold</strong>, <em>italic</em>, <code>code</code>,
<kbd>Ctrl</kbd>+<kbd>C</kbd>, <sub>sub</sub> and <sup>sup</sup>, plus a
<span style="color: rebeccapurple">styled span</span> and an
<abbr title="Total Blocking Time">TBT</abbr>.`,
  },
  {
    id: 'html-block',
    probes: 'block-level HTML containing markdown, which rehype-raw has to reconcile',
    src: `<details>
<summary>What the gate checks</summary>

Every claim the corpus makes, against the tool that would render it:

- mermaid parses
- math renders
- documents do not swallow their tails

</details>

<figure>
  <img src="${img(400, 300)}" alt="A photograph">
  <figcaption>An image inside a figure element.</figcaption>
</figure>`,
  },
  {
    id: 'html-table',
    probes: 'an HTML table, which takes a different path from a GFM one',
    src: `<table>
  <thead>
    <tr><th>Family</th><th>Updates</th><th align="right">1.15 MB</th></tr>
  </thead>
  <tbody>
    <tr><td>cold</td><td>1</td><td align="right">5009 ms</td></tr>
    <tr><td>steps</td><td>100</td><td align="right">2285 ms</td></tr>
    <tr><td>scale</td><td>50283</td><td align="right">did not finish</td></tr>
  </tbody>
</table>`,
  },
  {
    id: 'html-comments',
    probes: 'HTML comments, which remark-remove-comments strips',
    src: `<!-- a leading comment -->
Visible text.
<!-- a comment
     spanning
     several lines -->
More visible text. <!-- a trailing inline comment -->`,
  },
  {
    id: 'html-sanitize-hazards',
    probes:
      'what rehype-sanitize must strip — present so the corpus states the expected outcome rather than avoiding the subject',
    src: `<script>window.__corpus = 'must not run';</script>

<img src="x" onerror="window.__corpus = 'must not run'">

<a href="javascript:void(0)">a javascript: href</a>

<iframe src="https://example.test"></iframe>

<style>body { display: none; }</style>`,
  },
];

// ── CJK ───────────────────────────────────────────────────────────────────

/**
 * Three of the engine's plugins exist for this and the old corpus had none of
 * it. `remark-cjk-friendly` fixes emphasis at CJK boundaries, its
 * gfm-strikethrough sibling does the same for `~~`, and `remark-pangu`
 * inserts spacing between CJK and Latin.
 *
 * CJK is also the only content here where a character is two columns wide,
 * which is a different question from which glyph is drawn: alignment,
 * measurement and line breaking all change.
 */
export const MARKDOWN_CJK: readonly MarkdownCase[] = [
  {
    id: 'cjk-emphasis-boundary',
    probes: 'emphasis touching CJK with no surrounding space — what remark-cjk-friendly fixes',
    src: `这是**加粗**的文字，这是*斜体*的文字，这是***两者***的文字。

英文中的 **bold** 需要空格，中文里的**加粗**不需要。

带标点的边界：「**引号内加粗**」、（**括号内**）、**句末加粗**。`,
  },
  {
    id: 'cjk-strikethrough-boundary',
    probes: 'the same boundary problem for ~~, which needs its own plugin',
    src: `原来的结论是~~超线性~~，实际是~~渲染成本~~更新次数。

混排：the ~~old~~ 新的语料，以及~~中文删除线~~后面紧跟文字。`,
  },
  {
    id: 'cjk-pangu-spacing',
    probes: 'remark-pangu inserting space between CJK and Latin, digits and symbols',
    src: `在 config.ts 里加了 3 行代码，覆盖率从 20% 涨到 98%。

冻结边界扫描器处理 1139 个 KaTeX 标识符和 31 种 mermaid 图表，耗时 5009ms。

已有空格的不该再加：已经 有 空格 的情况。

代码里不该加：\`const 变量名 = 1\` 和 \`文件.ts\`。`,
  },
  {
    id: 'cjk-mixed-document',
    probes: 'a whole answer in mixed CJK and Latin — the shape this library is actually for',
    src: `## 增量解析的三个不变量

引擎在流式渲染时依赖三条不变量，改动 \`computeFreezeBoundary\` 前必须逐条确认：

1. **前缀冻结**：边界之前的输出不会再变，所以可以复用上一次的 hast。
2. **续扫**：扫描器从 \`cp.confirmedOffset\` 开始，只走新确认的行，代价是 O(delta)。
3. **保守优先**：拿不准时 over-block 而不是 under-block——少复用只是慢，错复用是错。

实测数据（react-core，不限速）：

| 交付方式 | 148KB | 1.15MB |
| --- | ---: | ---: |
| 一次性 | 229ms | 5009ms |
| 100 次 | 324ms | 2285ms |
| 每 24 字符 | 10315ms | 跑不完 |`,
  },
  {
    id: 'cjk-other-scripts',
    probes: 'Japanese, Korean, and scripts with different width and direction behaviour',
    src: `日本語：ストリーミング中のマークダウンを**レンダリング**します。

한국어: 스트리밍 마크다운을 **렌더링**합니다.

Ελληνικά: απόδοση ροής markdown.

Русский: потоковый рендеринг markdown.

العربية: عرض ماركداون المتدفق — right-to-left inside a left-to-right document.

Emoji as text: 🎉 👩‍💻 🇯🇵 — including a ZWJ sequence and a flag.`,
  },
  {
    id: 'cjk-full-width-punctuation',
    probes: 'full-width punctuation next to markdown syntax characters',
    src: `使用「引号」和（括号），以及：冒号、分号；还有句号。

标点紧邻语法字符：**加粗**。*斜体*，\`代码\`；[链接](https://example.test)！

全角与半角混用：这是 100% 的覆盖率（不是 100％）。`,
  },
];

// ── the whole surface, in one list ────────────────────────────────────────

export { MARKDOWN_MIXED };

export const MARKDOWN_CASES: readonly MarkdownCase[] = [
  ...MARKDOWN_GFM,
  ...MARKDOWN_INLINE,
  ...MARKDOWN_LINKS,
  ...MARKDOWN_BLOCKS,
  ...MARKDOWN_HTML,
  ...MARKDOWN_CJK,
  ...MARKDOWN_MIXED,
];
