# URL Sanitization & Custom Schemes

`<AIMarkdown>` filters URLs in `href`, `src`, and similar attributes through **two independent gates** (defense in depth). Anything that's not on both allowlists is rewritten to `''` and rendered as a dead link/image. This protects against XSS in LLM-generated markdown — but it also means private schemes (`myapp://`, `tel:`, `web+share:`, …) need explicit opt-in.

This document covers what each gate does, how to safely extend them, and the subtle reference-stability rules that make the difference between a working override and one that silently breaks block-level memoization.

---

## The two-gate model

```text
LLM-emitted URL string
        │
        ▼
┌────────────────────────────────────┐
│ Gate 1: rehype-sanitize schema      │  Per-protocol allowlist
│  • protocols.href / .src / .cite    │
│  • runs FIRST (in the rehype chain, │
│    during parseStage)               │
│  • drops the URL if its protocol    │
│    isn't on the allowlist           │
└────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────┐
│ Gate 2: urlTransform                │  Per-attribute rewriter
│  • receives (url, key, node)         │
│  • runs SECOND (at render time, in   │
│    renderHastSubtree)                │
│  • returns the rewritten URL, or     │
│    '' / null / undefined to drop     │
└────────────────────────────────────┘
        │
        ▼
  Rendered <a>/<img>/etc.
```

**Both** gates must permit a URL for it to render. Allowing only one is the most common mistake — see [Footguns](#footguns).

> The ordering above is the **actual execution order** inside the pipeline: `rehype-sanitize` runs as part of the rehype plugin chain (`MarkdownContent.tsx`), and `urlTransform` runs later, during per-attribute traversal in `renderHastSubtree`. The numbering reflects the order URLs actually traverse, not just a conceptual layering.

### Default allowlist

Mirrors `react-markdown` / GitHub:

```text
http  https  irc  ircs  mailto  xmpp
```

Anything else — `javascript:`, `data:`, `vbscript:`, `file:`, your own scheme — is stripped.

---

## Allowing a custom scheme

The recommended pattern is **both gates extended at module scope** so identity is stable across renders (the block-memo cache depends on this).

```tsx
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema } from '@ai-react-markdown/core';

// Gate 1: extend the library schema so it permits the scheme on href + src.
// This is the per-protocol allowlist that runs in the rehype chain.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
  s.protocols!.src!.push('myapp');
});

// Gate 2: compose with default so https/mailto/etc. still pass.
// This is the per-attribute rewriter that runs at render time.
const ALLOWED = /^myapp:/i;
const URL_TRANSFORM = (url: string, key: string, node: unknown) =>
  ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node);

function App({ content }: { content: string }) {
  return <AIMarkdown content={content} urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />;
}
```

Both `URL_TRANSFORM` and `SCHEMA` are defined **once** at module load. Pass the same references to every `<AIMarkdown>` in the app.

---

## `urlTransform` (Gate 2)

A function receiving the URL plus contextual metadata; returns the rewritten URL (or `''` to drop).

```ts
import type { Element } from 'hast';

type UrlTransform = (url: string, key: string, node: Readonly<Element>) => string | null | undefined;
```

| Parameter | Meaning                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `url`     | The raw URL string as it appears in the markdown                                                                               |
| `key`     | Attribute name — `'href'`, `'src'`, `'cite'`, etc.                                                                             |
| `node`    | The hast `Element` carrying the attribute, frozen as `Readonly` — useful when policy depends on tag name or sibling attributes |

The return value can be:

- The rewritten URL (a non-empty string) — used as-is.
- `''`, `null`, or `undefined` — treated as "drop"; the attribute is removed.

`null` and `undefined` are convenient when composing with a default — e.g. returning the default transform's verdict directly without coercing through `String(…)`.

### Key-aware policies

A common need: permit `myapp:` on `<a href>` but not on `<img src>` (which would let an LLM embed a tracker pixel). The `key` parameter is exactly for this:

```ts
const URL_TRANSFORM = (url, key, node) => {
  if (key === 'href' && /^myapp:/i.test(url)) return url;
  // src/cite paths still go through the default allowlist
  return defaultUrlTransform(url, key, node);
};
```

### Composing with `defaultUrlTransform`

`defaultUrlTransform` is the library's built-in safe transform — applying the GitHub allowlist. Compose with it rather than reimplementing:

```ts
// ✅ Whitelist your scheme; defer everything else to the default.
const URL_TRANSFORM = (url, key, node) => (/^myapp:/i.test(url) ? url : defaultUrlTransform(url, key, node));

// ⚠️ Reimplementing the safe set yourself — easy to miss a scheme.
const URL_TRANSFORM = (url) => {
  if (/^(myapp|https?|mailto):/i.test(url)) return url; // forgot irc, ircs, xmpp
  return '';
};
```

### Setting `urlTransform={null}`

Passing `null` is equivalent to omitting the prop entirely — `<AIMarkdown>` falls back to `defaultUrlTransform` (`||` semantics in the vendored Markdown wrapper). There is no "disable the per-attribute pass" mode; the urlTransform stage always runs. If you need to widen the allowlist, compose with `defaultUrlTransform` as shown above.

---

## `sanitizeSchema` (Gate 1, via `extendSanitizeSchema`)

`extendSanitizeSchema` hands you a deep clone of the library default. Mutate it freely or return a replacement — the clone never aliases the singleton.

```ts
import { extendSanitizeSchema } from '@ai-react-markdown/core';

// Mutate-style (recommended for additive changes).
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
  s.protocols!.src!.push('myapp');
  s.tagNames!.push('my-widget');
  s.attributes!['my-widget'] = ['data-id', 'data-mode'];
});

// Return-style (when you need a wider replacement).
const SCHEMA = extendSanitizeSchema((s) => ({
  ...s,
  tagNames: [...(s.tagNames ?? []), 'my-widget'],
}));
```

> ⚠️ **Return-style does no merging.** Whatever object you return is used as the schema verbatim. If you write `({ ...s, protocols: { href: ['myapp'] } })` thinking "I'll add one protocol", you'll actually **replace the entire `protocols` object** — losing `https`, `mailto`, `ircs`, the `src` allowlist, and so on. Mutate-style is safer for additive changes (push to existing arrays); reserve return-style for the rare case where you genuinely want to replace the whole schema and you accept the responsibility of re-supplying every field.

### Why use the helper instead of building a schema from scratch?

The library default extends `rehype-sanitize`'s `defaultSchema` with three additions that the renderer relies on:

| Addition                                                                                | Why it's needed                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<mark>` tag + class allowlist                                                          | For `==highlight==` syntax to render                                                                                                                                                                                                                                                         |
| Math className allowlist on `<code>` (`math-inline`, `math-display`)                    | For `remark-math` to mark code spans as math before `rehype-katex` consumes them. KaTeX's own output classes (`katex`, `katex-html`, …) are not in this allowlist — they survive because `rehype-katex` runs _after_ `rehype-sanitize`, so those classes aren't yet present at sanitize time |
| Cross-chunk coordination tags (`cross-chunk-link`, `cross-chunk-image`, `footnote-sup`) | For [cross-chunk references](./cross-chunk-coordination.md) to resolve correctly                                                                                                                                                                                                             |

Hand-rolling a schema (`{ ...defaultSchema, … }`) **silently drops these** — `==highlight==` becomes plain text, math disappears, cross-chunk footnotes fail. `extendSanitizeSchema` always works on a clone of the **library**'s default (not `rehype-sanitize`'s), so these survive.

### Inspecting the default schema

The helper itself is the cleanest introspection path:

```ts
extendSanitizeSchema((s) => {
  console.log('library default sanitize schema:', s);
});
```

`s` is the deep clone — log it once at module load to learn what's allowed, then write your real override.

### Why isn't the default schema exported as a value?

Because the obvious extension pattern — `{ ...sanitizeSchema, protocols: { ...sanitizeSchema.protocols, href: [...] } }` — is a shallow spread. Nested arrays (`protocols.href`, `attributes.a`, `ancestors.*`) stay aliased to the singleton; `.push(...)` mutates it, and the mutation leaks into every other `<AIMarkdown>` in the app that doesn't override `sanitizeSchema`. `extendSanitizeSchema` always works on a deep clone, so this entire class of bug is impossible by construction.

---

## Reference stability — asymmetric handling

Both props participate in the block-memo cache, but they are stabilized **differently**:

| Prop             | Tracked by                                 | Library safety net                                                |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `urlTransform`   | Identity only                              | None — a new function reference flushes the entire markdown cache |
| `sanitizeSchema` | Identity AND deep-equal (`useStableValue`) | A new-but-deep-equal schema collapses to the previous reference   |

Why asymmetric: function identity can't be deep-compared (two closures with identical bodies are always non-equal), so `urlTransform` _cannot_ have a safety net. Schemas are plain data, so deep-equal is meaningful.

**Implication**: defining `urlTransform` inline `urlTransform={(url) => …}` discards the block-memo cache on every render. Defining `sanitizeSchema` inline doesn't flush the cache, but pays a per-render cost: each `extendSanitizeSchema((s) => …)` call does a `cloneDeep` of the library default schema _plus_ the subsequent `useStableValue` runs a deep-equal against the prior value. Both passes walk the entire schema (protocols / attributes / ancestors / tagNames). Module-scope avoids both.

```tsx
// ⚠️ Anti-pattern — discards the entire markdown cache every render.
<AIMarkdown
  urlTransform={(url, k, n) => /* … */}
  sanitizeSchema={extendSanitizeSchema((s) => /* … */)}
/>

// ✅ Module-scope, no per-render overhead.
const URL_TRANSFORM = (url, k, n) => /* … */;
const SCHEMA = extendSanitizeSchema((s) => /* … */);

<AIMarkdown urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
```

In development the library `console.warn`s after detecting 3+ identity flips on either prop. The warning compiles to dead code in production builds.

---

## Cross-chunk symmetry

When chunks are wrapped in `<AIMarkdownDocuments>`, references that resolve **across chunks** (chunk A defines `[evil]: javascript:…`, chunk B writes `[click][evil]`) go through both gates **at render time** in the consuming chunk. The same `urlTransform` and `sanitizeSchema` you pass to `<AIMarkdown>` apply to cross-chunk references. The per-attribute `key` is honored: a key-aware policy that permits a scheme on `<a>` but not `<img>` will produce identical behavior whether the reference is in-chunk or cross-chunk.

This means **a permissive `urlTransform` in one chunk does not leak across chunks** — every consumer applies its own policy independently. This is intentional; an attacker who controls one chunk should not be able to inject URLs that bypass another chunk's policy.

---

## Regex-escaping for scheme names

Per RFC 3986, scheme names may contain `+`, `-`, and `.` — all regex metacharacters. Write `/^web\+app:/i`, **not** `/^web+app:/i`:

```ts
// ⚠️ Silently broadens the allowlist — matches we, wee, weee, ...
const ALLOWED = /^web+app:/i;

// ✅ Literal `+`.
const ALLOWED = /^web\+app:/i;
```

Real-world schemes that need escaping: `web+share`, `coap+tcp`, `application+xml` (in some MIME-like contexts), domain-specific dotted schemes.

---

## Footguns

### Allowing only one gate

```ts
// ⚠️ Gate 2 (urlTransform) permits 'myapp:', but Gate 1 (sanitize schema) still drops it.
const URL_TRANSFORM = (url) => (/^myapp:/.test(url) ? url : defaultUrlTransform(url, ...));
// No matching extendSanitizeSchema → URL silently disappears in the rendered output.
```

Symptom: the link/image is in your markdown, the consumer's URL transform clearly allows it, but the final `href`/`src` is empty.

```ts
// ⚠️ Gate 1 (sanitize schema) permits 'myapp', but Gate 2 (urlTransform) still rewrites to ''.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
});
// No urlTransform override → defaultUrlTransform rewrites 'myapp:…' to ''.
```

Same symptom. Always extend both gates in lockstep.

### Reassigning the local schema parameter inside `extendSanitizeSchema`

```ts
// ⚠️ Does nothing — JS only rebinds the local variable.
const SCHEMA = extendSanitizeSchema((s) => {
  s = { ...completelyNewSchema }; // ← local rebind, not a mutation
});
// SCHEMA === the unmodified clone.

// ✅ Either mutate the original draft …
const SCHEMA = extendSanitizeSchema((s) => {
  s.tagNames!.push('my-tag');
});

// ✅ … or return the new object explicitly.
const SCHEMA = extendSanitizeSchema((s) => ({ ...s, ...overrides }));
```

### Trusting `def.url` from `useDocumentRegistry` without re-sanitizing

The `Registry.resolveLinkDef(label).url` returns the URL produced by the **contributing chunk's** `urlTransform`. That's already filtered, but only with the `'href'` key against a synthetic `<a>` node. If you're rendering that URL as an `<img src>` or feeding it to analytics that treat it as `cite`, the per-attribute key may yield a different decision under a key-aware policy.

Defensive pattern:

```ts
// Synthesize a minimal hast Element for the call — urlTransform's signature
// requires a node, and most policies only read `node.tagName` / `node.properties`.
const syntheticNode = { type: 'element', tagName: 'img', properties: {}, children: [] } as const;

const def = registry?.resolveLinkDef(label);
if (def) {
  const safeUrl = myUrlTransform(def.url, 'src', syntheticNode); // re-run with the correct key
  // …use safeUrl
}
```

### Throwing inside the `extendSanitizeSchema` modifier

The helper has no try/catch. A throw propagates uncaught to the call site. This is intentional — module-scope use means a thrown error surfaces at startup, which is the correct failure mode. But if you call `extendSanitizeSchema` from a render path (don't), a throw will crash the component.

### Forgetting that arrays in the schema are `readonly`-typed but mutable at runtime

```ts
// TypeScript will complain about this:
extendSanitizeSchema((s) => {
  s.protocols.href.push('myapp'); // ts(2540) Cannot assign to '0' because it is a read-only property
});

// The runtime is fine with `.push` — the readonly-ness is only at the TypeScript level
// because `rehype-sanitize`'s upstream types declare them as such. Use non-null assertions
// or cast as needed:
extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
});
```

The helper's signature can't relax upstream types without losing accuracy, so the consumer-side `!` is unavoidable.
