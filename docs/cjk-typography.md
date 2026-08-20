# CJK Typography

`ai-react-markdown` is **CJK-first** in a way most React markdown libraries aren't. The rendering pipeline is configured out of the box for the line-breaking rules, mixed-script spacing, and punctuation conventions of Chinese, Japanese, and Korean text — which matters because LLM output is increasingly multilingual and increasingly mixes scripts within a single paragraph.

This document covers what the library does for CJK content, what you can tune, and what's intentionally **not** done.

---

## What works out of the box

| Feature                                                             | Plugin                                  | Default                      |
| ------------------------------------------------------------------- | --------------------------------------- | ---------------------------- |
| Proper line-breaking between CJK characters and Latin words         | `remark-cjk-friendly`                   | ✅ Always on                 |
| GFM strikethrough that respects CJK width                           | `remark-cjk-friendly-gfm-strikethrough` | ✅ Always on                 |
| Auto-insert spaces between CJK and half-width characters (pangu)    | `remark-pangu`                          | ✅ On by default; toggleable |
| Smart punctuation (SmartyPants) — curly quotes, em-dashes, ellipses | `remark-smartypants`                    | ✅ On by default; toggleable |
| HTML comment removal                                                | `remark-remove-comments`                | ✅ On by default; toggleable |

These plugins run on every render. They're enabled by default precisely because LLM output for Chinese/Japanese/Korean users routinely needs them — turning them on by default means you don't think about typography until you specifically want different behavior.

---

## What pangu spacing does

CJK characters are full-width; Latin letters and digits are half-width. Without a separator, mixed-script text looks visually cramped:

```text
今天我用 React19 重构了项目             ← no spacing applied
今天我用 React 19 重构了项目            ← natural reading
```

`remark-pangu` (controlled by the `pangu` engine plugin) automatically inserts a regular ASCII space between any CJK boundary and an adjacent half-width character. The space appears in the rendered HTML; it's not a CSS visual hack, so it survives copy-paste, screen readers, and downstream processing.

### Turning pangu off

```tsx
import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';

// Module scope — stable reference. pangu filtered out → spacing disabled.
const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);

<AIMarkdown content="今天我用React19重构了项目" enginePlugins={PLUGINS} />;
```

> Note that a passed `enginePlugins` array **replaces** the default selection wholesale (it isn't merged). The `filter` idiom above is the recommended way to turn off exactly one plugin while keeping the rest.

### When to keep pangu off

- Content that's **already pre-spaced** by an upstream pipeline (you'd get double spaces — pangu is conservative and won't insert a second space, but it's still a no-op cost).
- Content where the model is mid-token-streaming and intermediate states would be jarring — though in practice pangu is fast enough that this rarely matters.
- Tests that need to assert exact byte-for-byte content match without pangu's added whitespace.

For 99% of LLM-output use cases involving Chinese/Japanese/Korean users, **leave it on**.

---

## Line-breaking semantics

Standard CommonMark / GFM treats a soft line break (single `\n` inside a paragraph) as a space. In CJK text, that's wrong — there's no space between adjacent CJK characters, so a soft line break should produce _no whitespace_ at all.

`remark-cjk-friendly` rewrites the line-break behavior so:

| Markdown                        | Renders as                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `这是一段\n中文内容`            | `这是一段中文内容` (no space)                                                  |
| `English with\na soft break`    | `English with a soft break` (one space)                                        |
| `中文 mixed with\nEnglish text` | `中文 mixed with English text` (one space — the soft break sits next to Latin) |

This is enabled unconditionally; there's no config flag to disable it because turning it off produces visibly broken CJK paragraphs.

`remark-cjk-friendly-gfm-strikethrough` extends the same idea to GFM's `~~strikethrough~~` syntax — without it, `~~中文~~` may not strike correctly because GFM's strikethrough delimiter matching assumes Latin word boundaries.

---

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

See [Design tokens](./design-tokens.md) for the full token surface.

---

## Line height for CJK

CJK characters are visually denser than Latin — at the same nominal line-height, CJK text looks tighter and harder to read. The default `--aim-line-height` is tuned for mixed-script content; for **CJK-dominant** layouts (e.g. a Chinese-only blog rendered through `<AIMarkdown>`), bump it slightly:

```css
.aim-typography-root.default {
  --aim-line-height: 1.8; /* default is around 1.6; CJK reads better at 1.7-1.9 */
}
```

This is a personal/brand decision; there's no "correct" value.

---

## Ruby annotations (furigana / zhuyin)

`<ruby>`, `<rt>`, and `<rp>` are in `rehype-sanitize`'s `defaultSchema.tagNames`, so they survive the library's sanitization without any extra configuration. Inline HTML in your markdown just works:

```markdown
<ruby>漢<rt>kan</rt></ruby>字
```

The default schema allows the tags but doesn't allow attributes on them. If you need attributes (e.g. `lang` on `<rt>` for screen readers, `class` for styling), extend the schema explicitly:

```ts
import { extendSanitizeSchema } from '@ai-react-markdown/core';

const SCHEMA = extendSanitizeSchema((s) => {
  s.attributes!['ruby'] = ['lang', 'class'];
  s.attributes!['rt'] = ['lang', 'class'];
  s.attributes!['rp'] = ['class'];
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
import AIMarkdown from '@ai-react-markdown/core';
import '@ai-react-markdown/core/typography/default.css';
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

That's the whole setup. The rest — `remark-cjk-friendly`, pangu spacing, SmartyPants — runs automatically.

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
import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';

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
