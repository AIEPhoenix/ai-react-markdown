# @ai-react-markdown/remark-mark-highlight

[![npm](https://img.shields.io/npm/v/@ai-react-markdown/remark-mark-highlight)](https://www.npmjs.com/package/@ai-react-markdown/remark-mark-highlight)
[![license](https://img.shields.io/npm/l/@ai-react-markdown/remark-mark-highlight)](../../LICENSE)

[remark](https://github.com/remarkjs/remark) plugin for `==mark==` highlight syntax: `==text==` parses to an mdast `mark` node and renders as `<mark>text</mark>`.

First-party continuation of the unmaintained [`remark-mark-highlight`](https://www.npmjs.com/package/remark-mark-highlight), used internally by [`@ai-react-markdown/core`](../core)'s sealed `highlight` engine plugin — published standalone because it is useful outside this repo, and because the upstream's ESM-only exports map broke bare-Node CJS `require()` consumers.

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

## Behavior contract

- Attention-style tokenizer (same family as GFM strikethrough): exactly two `=`, standard flanking rules, nesting with emphasis/strong/strikethrough, escapes and code spans respected, spans may contain line endings.
- **Byte-compatible with `remark-mark-highlight@0.1.1`**: a 50-case parity corpus (mdast with positions + hast), generated against the upstream before this package replaced it, runs in CI. Behavior changes would be a semver-major of this package.

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

MIT. Derived from the MIT-licensed `remark-mark-highlight` and `micromark-extension-highlight-mark` / `mdast-util-highlight-mark`; see [LICENSE](./LICENSE) for attribution.
