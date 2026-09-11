# CJK Typography

Parsing and Pangu behavior come from engine and apply to both adapters. Typography variants and tokens below are React-specific; Vue uses its base stylesheet and application CSS, and exports `pangu` from its root. See the [Vue guide](../../../../packages/vue/README.md#minimal-component) and [package setup](getting-started.md).

CJK rendering combines three separate concerns: recognizing Markdown delimiters beside Chinese, Japanese, or Korean punctuation; adding optional spaces at mixed-script boundaries; and laying out the result with an appropriate font and line height. The library supplies parser extensions and default typography, while your application chooses language, fonts, and editorial spacing policy.

This guide distinguishes those responsibilities so that a punctuation problem is not treated as a CSS problem, and a line-break policy is not attributed to the wrong plugin. It also documents the limits of `==highlight==`, which does not use the CJK emphasis extension's delimiter rules.

## What works out of the box

| Feature                                                             | Plugin                                       | Default                      |
| ------------------------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| Emphasis delimiter recognition beside CJK punctuation               | `remark-cjk-friendly`                        | ✅ Always on                 |
| GFM strikethrough delimiter recognition beside CJK punctuation      | `remark-cjk-friendly-gfm-strikethrough`      | ✅ Always on                 |
| Auto-insert spaces between CJK and half-width characters (pangu)    | `remark-pangu`                               | ✅ On by default; toggleable |
| Smart punctuation (SmartyPants) — curly quotes, em-dashes, ellipses | `remark-smartypants`, after a CJK quote pass | ✅ On by default; toggleable |
| HTML comment removal                                                | built into the engine (`removeComments`)     | ✅ On by default; toggleable |

The parser extensions are installed through their `parseOnly` entry points. They affect how Markdown is recognized and do not themselves remove soft line breaks. The selected transforms run when the relevant source is parsed or transformed; incremental parsing can reuse the settled prefix, so this is not necessarily a full-document plugin run on every React render.

---

## What pangu spacing does

CJK characters are full-width; Latin letters and digits are half-width. Without a separator, mixed-script text looks visually cramped:

```text
今天我用React19重构了项目             ← source
今天我用 React19 重构了项目           ← mixed-script spacing
```

`remark-pangu` (controlled by the `pangu` engine plugin) applies its mixed-script spacing rules, inserting regular ASCII spaces at supported CJK/Latin boundaries. The space appears in the rendered HTML; it's not a CSS visual hack, so it survives copy-paste, screen readers, and downstream processing.

### Turning pangu off

```tsx
import { defaultEnginePlugins, pangu } from '@ai-markdown/react/plugins';

// Module scope — stable reference. pangu filtered out → spacing disabled.
const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);

<AIMarkdown content="今天我用React19重构了项目" enginePlugins={PLUGINS} />;
```

> Note that a passed `enginePlugins` array **replaces** the default selection wholesale (it isn't merged). The `filter` idiom above is the recommended way to turn off exactly one plugin while keeping the rest.

### When to keep pangu off

- Content that's **already pre-spaced** by an upstream pipeline. Pangu normally preserves existing separation rather than adding a second space, so this may simply be redundant work.
- Content where the model is mid-token-streaming and intermediate states would be jarring — though in practice pangu is fast enough that this rarely matters.
- Tests that need to assert exact byte-for-byte content match without pangu's added whitespace.

Keep the default when its output matches your editorial rules. Japanese and Korean applications may choose a different spacing convention; compare representative sentences and punctuation before deciding.

---

## Quotes beside CJK text

The `smartypants` plugin is two transformers. SmartyPants decides whether a straight quote opens or closes from the token before it, and a Han, kana or hangul character is a word to it, so on its own it made both quotes of `中文"引号"中文` closers. A CJK-aware pass therefore runs first: a straight `"` or `'` with a CJK character (Han, hiragana, katakana, hangul, CJK punctuation or a fullwidth form) directly before or after it is curled by pairing within its text run, and SmartyPants only sees the quotes that have no CJK neighbour. Pangu runs after both and pads curly double quotes by its own rule; it leaves curly single quotes alone.

| Source                 | Rendered text            |
| ---------------------- | ------------------------ |
| `中文"引号"中文`       | `中文 “引号” 中文`       |
| `中文'引号'中文`       | `中文‘引号’中文`         |
| `中文 '引号' 中文`     | `中文 ‘引号’ 中文`       |
| `中文"English"中文`    | `中文 “English” 中文`    |
| `中文"多"个"引号"了`   | `中文 “多” 个 “引号” 了` |
| `他说："你好。"`       | `他说：“你好。”`         |
| `English "quote" 中文` | `English “quote” 中文`   |
| `it's`, `'90s`         | `it’s`, `’90s`           |

The pairing rules, in order: a quote at the start of a text run, after whitespace or after an opening bracket opens; a quote at the end of a run, before whitespace or before closing punctuation (`）」，。！？；：`) closes; a quote directly after a non-CJK letter or digit closes; a quote between two other characters opens when no quote of that kind is open and closes otherwise. Pairing is per text run, so emphasis or a link inside the quoted span starts a new run: `"引号**强调**"` opens both quotes. An unclosed quote (`中文"引号`) stays an opening quote until the closer arrives, which is the normal state of a streaming frame.

Code spans, fenced code, raw HTML and math keep their straight quotes; the pass only touches text nodes and never moves a position, so incremental parsing can reuse a settled prefix.

---

## Line-breaking semantics

The production chain always includes `remark-breaks`. Within a paragraph, a source line ending therefore becomes a rendered `<br>`; the CJK plugins do not join the lines. Both CJK extensions use their parsing-only entry points, which patch delimiter recognition without installing a soft-break removal transform.

| Source inside a paragraph       | Resulting structure                       |
| ------------------------------- | ----------------------------------------- |
| `这是一段\n中文内容`            | `这是一段<br>中文内容`                    |
| `English with\na soft break`    | `English with<br>a soft break`            |
| `中文 mixed with\nEnglish text` | A line break between the two source lines |

Here `\n` denotes an actual newline in the input. A blank line still separates blocks, and code blocks retain their own whitespace semantics. Browser wrapping caused by a narrow container is different again: it depends on CSS, font metrics, and available width.

The CJK extensions matter for examples such as `前面**「重点」**后面` and the corresponding `~~…~~` form. They let the parser recognize emphasis or strikethrough around punctuation in places where the unpatched delimiter rules would leave literal markers. They do not provide fonts, change East Asian glyph widths, or define a browser line-wrapping algorithm.

There is no public switch for the always-on break or CJK parser plugins. If an upstream source inserts editorial newlines that should not be displayed, normalize that source before rendering using a rule appropriate to its format. Do not remove all newlines indiscriminately: fences, tables, lists, and block boundaries depend on them.

## Fonts and CSS

The default typography variant doesn't pin a specific CJK font — it lets the OS pick from your system fallback chain. This is intentional: rendered Chinese text looks best when it uses each user's preferred system font (e.g. PingFang on macOS, Microsoft YaHei on Windows, Source Han Sans on Linux).

If you want a specific CJK font, override the font-family tokens:

```css
.aim-typography-root.default {
  --aim-font-family-headings: 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif;
  /* The body font isn't a separate token — set it on the typography root directly: */
  font-family: 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif;
}
```

For monospace inside code blocks, the existing `--aim-font-family-monospace` token handles it — but if you want CJK characters inside `<code>` to use a different fallback than Latin chars, browsers handle this automatically via the font's CJK glyphs. The token only matters when your monospace font has no CJK glyphs and you want a CJK-capable fallback:

```css
.aim-typography-root.default {
  --aim-font-family-monospace: 'Fira Code', 'Noto Sans Mono CJK SC', monospace;
}
```

See [Design tokens](design-tokens.md) for the full token surface.

---

## Line height for CJK

CJK characters are visually denser than Latin — at the same nominal line-height, CJK text looks tighter and harder to read. The default `--aim-line-height` is tuned for mixed-script content; for **CJK-dominant** layouts (e.g. a Chinese-only blog rendered through `<AIMarkdown>`), bump it slightly:

```css
.aim-typography-root.default {
  --aim-line-height: 1.8; /* shipped default: 1.55; choose the value for your actual font */
}
```

This is a personal/brand decision; there's no "correct" value.

---

## Ruby annotations (furigana / zhuyin)

`<ruby>`, `<rt>`, and `<rp>` are in `rehype-sanitize`'s `defaultSchema.tagNames`, so they survive the library's sanitization without any extra configuration. Inline HTML in your markdown just works:

```markdown
<ruby>漢<rt>kan</rt></ruby>字
```

The default schema also has shared attribute rules; tag support and attribute support are separate decisions. If you need attributes (e.g. `lang` on `<rt>` for screen readers, `class` for styling), extend the schema explicitly:

```ts
import { extendSanitizeSchema } from '@ai-markdown/react';

const SCHEMA = extendSanitizeSchema((s) => {
  s.attributes ??= {};
  for (const tag of ['ruby', 'rt', 'rp']) {
    s.attributes[tag] = [...(s.attributes[tag] ?? []), 'lang', 'className'];
  }
});
```

> Browsers without ruby layout support (rare) fall back to the `<rp>` content (`(` / `)` parentheses). This is the HTML spec's intended degradation path — the library doesn't override it.

---

## What's intentionally NOT done

The library does **not**:

- **Vertical writing (`writing-mode: vertical-rl`)** — supported by CSS, but `<AIMarkdown>` doesn't set it. If you want vertical Chinese/Japanese text, apply `writing-mode: vertical-rl` to a parent container (or to the typography root via your own CSS). All the spacing tokens stay valid.
- **CJK-specific syntax extensions** (e.g. 「」 as quote delimiters) — these would diverge from CommonMark and aren't on the roadmap.
- **CJK flanking for `==highlight==`** — `remark-cjk-friendly` patches emphasis (`*`, `_`) and its companion patches GFM strikethrough (`~~`), but nothing patches `==`, so it keeps CommonMark's unpatched delimiter rules. Where full-width punctuation sits immediately inside the delimiters, `**` and `~~` pair and `==` does not: `前面**「重点」**后面` renders bold, `前面==「重点」==后面` renders literal `==`. This is deliberate. `==` is neither CommonMark nor GFM — it is an extension whose value is that the same source renders the same way in Obsidian, VitePress and the rest, and relaxing it here would break exactly that. Two shapes do pair, if you need `==` specifically: put the punctuation outside the delimiters (`前面「==重点==」后面`, `前面==重点==。后面`), or put a space on **both** sides of the delimiters (`前面 ==「重点」== 后面` — one side is not enough). Otherwise use `**` or `~~`, which are patched.
- **Bidi text for Arabic/Hebrew** — unrelated to CJK; bidi is handled by the browser's standard layout rules. Mixing RTL with CJK works at the layout level; the library makes no special accommodation.

If you have a concrete CJK rendering need that's not covered here, opening an issue with the markdown sample is the fastest path to a fix or workaround.

---

## Quick recipe: Chinese-first layout

A complete config for a Chinese-language site, using brand fonts and slightly looser line-height:

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import './my-cjk-overrides.css'; // contains the CSS below

function Article({ content }: { content: string }) {
  return <AIMarkdown content={content} fontSize="1rem" />;
}
```

```css
/* my-cjk-overrides.css */
.aim-typography-root.default {
  font-family: 'PingFang SC', 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif;
  --aim-font-family-headings: 'PingFang SC', 'Source Han Serif SC', serif;
  --aim-font-family-monospace: 'Fira Code', 'Noto Sans Mono CJK SC', monospace;
  --aim-line-height: 1.8;
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.15);
}
```

That's the whole setup. The parser extensions, `remark-breaks`, SmartyPants (with its CJK quote pass), and pangu spacing remain active, so a quoted word in CJK prose (`中文"引号"中文`, `中文'引号'中文`) gets an opening and a closing quote rather than two closers. Font loading and the page's `lang` attribute are application responsibilities.

---

## Footguns

### Disabling pangu when content is already pre-spaced

Some content pipelines insert their own CJK/Latin spacing upstream. Running pangu on that content **doesn't double-space** (it's idempotent and won't insert a second space where one already exists) — but it still walks the tree, which is wasted work on every render. If your content is reliably pre-spaced, filter `pangu` out of `enginePlugins` to skip the walk entirely. The optimization disappears once you mix in any un-pre-spaced source.

### Asserting on exact byte content in tests

Pangu inserts characters into the rendered text. Test snapshots that assert byte-for-byte equality with the source markdown will fail because `今天用React` becomes `今天用 React` after pangu. Either:

- Disable pangu in the test setup (`enginePlugins` without `pangu` — the `filter` idiom above).
- Use a semantic matcher (`textContent.includes('React')`) instead of strict equality.

The same applies to SmartyPants — and more than quotes: with the pinned `remark-smartypants`, straight quotes curl, `--` becomes an em-dash, and `...` becomes an ellipsis. Assertions on raw CLI-style strings (`--verbose`) will not survive it — both plugins run on by default.

### `enginePlugins` replaces the array

When you pass `enginePlugins={[...]}`, your array **replaces** the default selection wholesale; it isn't merged. To disable just pangu, keep the rest:

```tsx
import { defaultEnginePlugins, pangu } from '@ai-markdown/react/plugins';

// ⚠️ Disables ALL engine plugins (loses comment removal + SmartyPants +
// highlight + definition lists too).
enginePlugins={[]}

// ✅ Keep everything except pangu (module scope — stable reference).
const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
enginePlugins={PLUGINS}
```

### Hair-space vs ASCII space confusion

Pangu in this library inserts a **regular ASCII space** (`U+0020`), not a typographic hair-space (`U+200A`). This is the upstream `pangu` package's behavior. The visible output may look identical, but tools doing byte-level diff or content-equality checks will see a single regular space, not a thin one. If you actually want a hair-space rendering, override the wrapper or post-process the output downstream.

### Font-family override forgetting `font-family` on the root

The `--aim-font-family-headings` token controls heading fonts. There's no equivalent body-font token; body text inherits from the typography root. So if you want a different body font for a CJK layout, set `font-family` on `.aim-typography-root.default` directly (as shown in the Quick recipe above) — overriding only `--aim-font-family-headings` will leave body text using the system fallback.

## Diagnosing multilingual output

Start with the smallest source that reproduces the issue and classify the difference:

1. Literal `**` or `~~` beside punctuation indicates delimiter recognition. Compare emphasis and strikethrough separately; `==` has a distinct parser.
2. Extra spaces between scripts usually come from pangu. Remove only `pangu` from the selection and compare `textContent`.
3. Curly quotes or changed dashes come from the `smartypants` plugin (the CJK quote pass for quotes touching CJK text, SmartyPants for the rest). Put command-line examples in code spans or fenced blocks when they must retain punctuation.
4. Visible source newlines come from `remark-breaks`; wrapping at the viewport edge comes from CSS.
5. Missing glyphs or mismatched character heights are font fallback issues. Inspect the font actually used, not just the first family in the CSS declaration.

Use `lang="zh-Hans"`, `lang="zh-Hant"`, `lang="ja"`, or `lang="ko"` on an application container when appropriate to the content. This conveys language to browsers and assistive technology; it does not change the library's plugin selection. Mixed-language messages may need language annotations at a finer level.

For verification, include source with Chinese punctuation next to emphasis, Japanese brackets, Korean/Latin identifiers, currency next to math, inline code, table cells, and ruby annotations. Check both a completed string and prefixes that stop inside a delimiter. A final snapshot alone does not show how intermediate source is interpreted.

The implementation reference is [`pluginChain.ts`](../../../../packages/engine/src/components/pluginChain.ts); default CSS lives in [`default.scss`](../../../../packages/react/src/components/typography/variants/default.scss). These files separate parser configuration from typography rules.
