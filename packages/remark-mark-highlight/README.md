# @ai-react-markdown/remark-mark-highlight

[![npm version](https://img.shields.io/npm/v/@ai-react-markdown/remark-mark-highlight?logo=npm&color=cb3837)](https://www.npmjs.com/package/@ai-react-markdown/remark-mark-highlight)
[![npm downloads](https://img.shields.io/npm/dm/@ai-react-markdown/remark-mark-highlight?color=blue)](https://www.npmjs.com/package/@ai-react-markdown/remark-mark-highlight)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@ai-react-markdown/remark-mark-highlight?label=minzip)](https://bundlephobia.com/package/@ai-react-markdown/remark-mark-highlight)
[![types](https://img.shields.io/npm/types/@ai-react-markdown/remark-mark-highlight?logo=typescript&logoColor=white&color=3178c6)](https://www.typescriptlang.org/)

[![Node ≥20](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![ESM + CJS](https://img.shields.io/badge/module-ESM%20%2B%20CJS-f7df1e?logo=javascript&logoColor=black)](#installation)
[![remark plugin](https://img.shields.io/badge/remark-plugin-2c1e60?logo=markdown&logoColor=white)](https://github.com/remarkjs/remark)
[![license](https://img.shields.io/npm/l/@ai-react-markdown/remark-mark-highlight?color=green)](https://github.com/AIEPhoenix/ai-react-markdown/blob/main/packages/remark-mark-highlight/LICENSE)

[![CI](https://img.shields.io/github/actions/workflow/status/AIEPhoenix/ai-react-markdown/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white)](https://github.com/AIEPhoenix/ai-react-markdown/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/AIEPhoenix/ai-react-markdown/release.yml?label=release&logo=githubactions&logoColor=white)](https://github.com/AIEPhoenix/ai-react-markdown/actions/workflows/release.yml)
[![part of ai-react-markdown](https://img.shields.io/badge/monorepo-ai--react--markdown-8a2be2?logo=github)](https://github.com/AIEPhoenix/ai-react-markdown)

[remark](https://github.com/remarkjs/remark) plugin for `==mark==` highlight syntax: `==text==` parses to an mdast `mark` node and renders as `<mark>text</mark>`.

First-party continuation of the unmaintained [`remark-mark-highlight`](https://www.npmjs.com/package/remark-mark-highlight), used internally by [`@ai-react-markdown/core`](https://github.com/AIEPhoenix/ai-react-markdown/blob/main/packages/core)'s sealed `highlight` engine plugin — published standalone because it is useful outside this repo, and because the upstream's ESM-only exports map broke bare-Node CJS `require()` consumers.

## Install

```bash
npm install @ai-react-markdown/remark-mark-highlight
```

Dual ESM/CJS build: both `import` and `require` work, types included for both.

## Use

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkMarkHighlight } from '@ai-react-markdown/remark-mark-highlight';

const processor = unified().use(remarkParse).use(remarkMarkHighlight);
// '==hi==' → mdast: { type: 'mark', data: { hName: 'mark' }, children: [...] }
// → hast/HTML: <mark>hi</mark> (via data.hName — no custom handler needed)
```

Serialization back to markdown (`remark-stringify`) is supported; `==` sequences round-trip.

## Syntax at a glance

| Markdown                    | mdast                                                        | HTML                                        |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `==text==`                  | `{ type: 'mark', children: [text] }`                         | `<mark>text</mark>`                         |
| `==**bold** inside==`       | `mark` → `strong` → `text` (nesting follows attention rules) | `<mark><strong>bold</strong> inside</mark>` |
| `\==not a mark==`           | plain text                                                   | `==not a mark==`                            |
| `` `==code==` ``            | `inlineCode` (code spans win)                                | `<code>==code==</code>`                     |
| `=single=` / `===triple===` | plain text (exactly two `=` open/close)                      | unchanged                                   |

Works with `remark-rehype` out of the box (`data.hName = 'mark'`); no custom handler needed. If you sanitize with `rehype-sanitize`, allow the `mark` tag (the `@ai-react-markdown/core` default schema already does).

## Compatibility

|                  |                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| unified / remark | remark 15+ (micromark 4, mdast-util-from-markdown 2, mdast-util-to-markdown 2)                                                          |
| Node             | ≥ 20                                                                                                                                    |
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

This package versions independently of the `@ai-react-markdown/core` release train — core depends on it through a normal semver range.

## License

MIT. Derived from the MIT-licensed `remark-mark-highlight` and `micromark-extension-highlight-mark` / `mdast-util-highlight-mark`; see [LICENSE](https://github.com/AIEPhoenix/ai-react-markdown/blob/main/packages/remark-mark-highlight/LICENSE) for attribution.
