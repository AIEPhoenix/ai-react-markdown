# @ai-markdown/remark-mark-highlight

[![@ai-markdown/remark-mark-highlight latest](https://img.shields.io/npm/v/@ai-markdown/remark-mark-highlight/latest?label=npm%20latest&color=blue)](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight?activeTab=versions)
[![@ai-markdown/remark-mark-highlight monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/remark-mark-highlight?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/remark-mark-highlight)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/packages/remark-mark-highlight/LICENSE)

A [remark](https://github.com/remarkjs/remark) syntax plugin for highlighted text. `==text==` becomes an mdast `mark` node whose `data.hName` tells remark-rehype to produce `<mark>text</mark>`. The package registers both parsing and Markdown serialization extensions; it does not provide CSS or an HTML sanitizer.

Use the named `remarkMarkHighlight` export with unified. The alias `remarkMark` retains the upstream export name, and lower-level micromark/mdast extensions are available for custom pipelines. Both framework adapters enable this capability through the engine’s sealed `highlight` plugin by default, so React and Vue applications do not need to install or register this package separately.

First-party continuation of the unmaintained [`remark-mark-highlight`](https://www.npmjs.com/package/remark-mark-highlight), used internally by [`@ai-markdown/react`](https://github.com/ai-markdown/ai-markdown/blob/main/packages/react)'s sealed `highlight` engine plugin — published standalone because it is useful outside this repo, and because the upstream's ESM-only exports map broke bare-Node CJS `require()` consumers.

## Install

```bash
npm install @ai-markdown/remark-mark-highlight
```

Dual ESM/CJS build: both `import` and `require` work, types included for both.

## Use

A parse-only processor produces an mdast tree. Call `parse` and `run` rather than `process`, since there is no compiler in this first pipeline:

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkMarkHighlight } from '@ai-markdown/remark-mark-highlight';

const processor = unified().use(remarkParse).use(remarkMarkHighlight);
const tree = processor.runSync(processor.parse('==hi=='));
// tree contains: { type: 'mark', data: { hName: 'mark' }, children: [...] }
```

To render HTML, add the conversion and serialization stages (install their packages alongside unified and remark-parse):

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { remarkMarkHighlight } from '@ai-markdown/remark-mark-highlight';

const html = unified()
  .use(remarkParse)
  .use(remarkMarkHighlight)
  .use(remarkRehype)
  .use(rehypeStringify)
  .processSync('==**bold** inside==');

console.log(String(html));
// <p><mark><strong>bold</strong> inside</mark></p>
```

No custom mdast-to-hast handler is required. If your full application pipeline uses rehype-sanitize, include `mark` in its allowed tags; the React adapter's default schema already does. For Markdown output, replace the HTML stages with remark-stringify. The plugin supplies the corresponding `==` serialization rules, including the escaping behavior described below.

## Syntax at a glance

| Markdown                    | mdast                                                        | HTML                                        |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `==text==`                  | `{ type: 'mark', children: [text] }`                         | `<mark>text</mark>`                         |
| `==**bold** inside==`       | `mark` → `strong` → `text` (nesting follows attention rules) | `<mark><strong>bold</strong> inside</mark>` |
| `\==not a mark==`           | plain text                                                   | `==not a mark==`                            |
| `` `==code==` ``            | `inlineCode` (code spans win)                                | `<code>==code==</code>`                     |
| `=single=` / `===triple===` | plain text (exactly two `=` open/close)                      | unchanged                                   |

Works with `remark-rehype` out of the box (`data.hName = 'mark'`); no custom handler needed. If you sanitize with `rehype-sanitize`, allow the `mark` tag (the `@ai-markdown/react` default schema already does).

## Compatibility

|                  |                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| unified / remark | remark 15+ (micromark 4, mdast-util-from-markdown 2, mdast-util-to-markdown 2)                                                          |
| Node             | `^20.19.0 \|\| >=22.12.0`                                                                                                               |
| Module formats   | ESM and CJS with types for both — the upstream's ESM-only exports map broke bare-Node `require()`, which is one reason this fork exists |
| Types            | `Mark` is registered in mdast's `PhrasingContentMap` and `RootContentMap`, so `mark` nodes type-check inside paragraphs                 |

## Behavior contract

- Attention-style tokenizer (same family as GFM strikethrough): exactly two `=`, standard flanking rules, nesting with emphasis/strong, escapes and code spans respected, spans may contain line endings. Interplay with other attention extensions (e.g. GFM strikethrough) follows micromark's shared attention machinery but is not part of the pinned corpus, which runs the plugin without GFM.
- **Byte-compatible with `remark-mark-highlight@0.1.1`**: a 50-case parity corpus (mdast with positions + hast), generated against the upstream before this package replaced it, runs in CI. Behavior changes would be a semver-major of this package.

## Footguns

- **Loading the plugin changes how `remark-stringify` escapes `=`.** The serializer registers `=` as unsafe in phrasing content (so `==` spans survive round-trips), which escapes _every_ phrasing `=` — `let a = b` serializes as `let a \= b`. This matches the upstream's behavior and only affects stringify output, never parsing or rendering.

## API

| Export                                                  | What                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `remarkMarkHighlight`                                   | The remark plugin (also aliased as `remarkMark`, the upstream's export name)           |
| `markHighlight()`                                       | The raw micromark extension                                                            |
| `markHighlightFromMarkdown` / `markHighlightToMarkdown` | The mdast from/to-markdown extensions                                                  |
| `Mark` (type)                                           | The mdast node interface (`type: 'mark'`), registered in mdast's phrasing-content maps |

## Versioning

This package versions independently of the `@ai-markdown/react` release train — `@ai-markdown/engine` depends on it through a normal semver range. Shared core and the React/Vue adapters receive it transitively.

## Integration boundaries and verification

The delimiter must be exactly two equals signs with valid attention-style flanking. A single or triple run remains text; code spans and escapes take precedence, and nested strong/emphasis can appear inside a mark. This package does not itself relax delimiter flanking for CJK text or replace the separate CJK plugins used by engine.

Importing the plugin's types registers `Mark` in mdast's content maps. The resulting node is phrasing content with children, so a tree visitor should recurse rather than assume a single text child. `data.hName` carries the HTML element mapping; removing that data in an intervening transform changes how the next stage renders the node.

The pinned 50-case parity corpus compares positional mdast and hast with `remark-mark-highlight@0.1.1`. It covers this plugin's standalone behavior; interactions with additional attention extensions such as GFM are not implied by that parity claim. Test your complete plugin combination if you depend on a particular nesting rule.

For repository work, run `pnpm --filter @ai-markdown/remark-mark-highlight test` and the package build. When changing syntax or serialization, include both a parsed-tree example and a round-trip example: escaping every phrasing equals sign is an existing serializer contract, even where the source is not a highlight span. This package has independent semver, so its behavior changes are not automatically governed by the React adapter's version number.

## License

MIT. Derived from the MIT-licensed `remark-mark-highlight` and `micromark-extension-highlight-mark` / `mdast-util-highlight-mark`; see [LICENSE](https://github.com/ai-markdown/ai-markdown/blob/main/packages/remark-mark-highlight/LICENSE) for attribution.
