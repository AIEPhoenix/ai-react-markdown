# TypeScript Generics

`<AIMarkdown>` accepts two generic type parameters:

```ts
function AIMarkdown<
  TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig,
  TRenderData extends AIMarkdownMetadata = AIMarkdownMetadata,
>(props: AIMarkdownProps<TConfig, TRenderData>): ReactElement;
```

- **`TConfig`** — your extended render config, which must include all fields of `AIMarkdownRenderConfig`.
- **`TRenderData`** — your extended metadata, which must include all fields of `AIMarkdownMetadata` (`Record<string, any>` — so any plain object satisfies it).

Both default to the base library types, so you only opt into generics when you need typed extension.

---

## Extending the config

```tsx
import AIMarkdown, { type AIMarkdownRenderConfig, defaultAIMarkdownRenderConfig } from '@ai-react-markdown/core';

// Step 1: extend the config interface with your new fields.
interface MyConfig extends AIMarkdownRenderConfig {
  showLineNumbers: boolean;
  maxImageWidth: string;
}

// Step 2: provide a matching default config — required so `config` can be partial.
const defaultMyConfig: MyConfig = {
  ...defaultAIMarkdownRenderConfig,
  showLineNumbers: false,
  maxImageWidth: '100%',
};

// Step 3: use the component with explicit generic arguments.
function App({ markdown, lineNumbers }: { markdown: string; lineNumbers: boolean }) {
  return (
    <AIMarkdown<MyConfig>
      content={markdown}
      defaultConfig={defaultMyConfig}
      config={{ showLineNumbers: lineNumbers }}
    />
  );
}
```

`config` is `PartialDeep<TConfig>` — deeply optional, deeply merged with `defaultConfig`. Array fields (like `extraSyntaxSupported`) are **replaced**, not merged by index.

---

## Reading the extended config inside a custom component

```tsx
import { useAIMarkdownRenderState } from '@ai-react-markdown/core';

function LineNumberedCode({ children }: { children: React.ReactNode }) {
  const { config } = useAIMarkdownRenderState<MyConfig>();
  //                                          ^^^^^^^^ caller-asserted
  if (config.showLineNumbers) {
    return <pre className="with-line-numbers">{children}</pre>;
  }
  return <pre>{children}</pre>;
}
```

The hook's generic is a **caller assertion**, not a derived type. TypeScript can't verify that the `<AIMarkdown>` provider above was actually configured with `MyConfig`. If you assert wrong, `config.showLineNumbers` looks fine at compile time but evaluates to `undefined` at runtime.

The library has no way to catch this mismatch automatically — the provider's `defaultConfig` is a render-time value, and TS only sees the static type of the consumer's `useAIMarkdownRenderState` call.

---

## The wrapper-hook pattern (recommended)

Don't sprinkle `<MyConfig>` generics across your codebase. Pin the assertion **once**, next to the provider configuration, then export a narrowed hook:

```ts
// my-app/markdown/config.ts
import {
  useAIMarkdownRenderState,
  type AIMarkdownRenderConfig,
  defaultAIMarkdownRenderConfig,
} from '@ai-react-markdown/core';

// 1. Shape:
export interface MyConfig extends AIMarkdownRenderConfig {
  showLineNumbers: boolean;
  maxImageWidth: string;
}

// 2. Default:
export const defaultMyConfig: MyConfig = {
  ...defaultAIMarkdownRenderConfig,
  showLineNumbers: false,
  maxImageWidth: '100%',
};

// 3. Narrowed hook (single assertion site):
export const useMyRenderState = () => useAIMarkdownRenderState<MyConfig>();
```

Now every custom component imports `useMyRenderState()` — the assertion lives in **one** file, not scattered across the codebase:

```tsx
// my-app/markdown/components.tsx
import { useMyRenderState } from './config';

function LineNumberedCode({ children }) {
  const { config } = useMyRenderState();
  // config.showLineNumbers is typed and present at runtime, because the
  // provider above uses defaultMyConfig — verified by the wrapper pattern.
}
```

This is exactly what `@ai-react-markdown/mantine` does — see [Extending via a Sub-package](./extending-via-subpackage.md) for the full pattern applied to a real integration.

---

## Extending metadata

```tsx
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownMetadata } from '@ai-react-markdown/core';

interface ChatMeta extends AIMarkdownMetadata {
  messageId: string;
  onCopyCode: (code: string) => void;
}

function MyCodeBlock({ children }: { children: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  //                                  ^^^^^^^^ caller-asserted
  return (
    <pre>
      <button onClick={() => meta?.onCopyCode(String(children))}>Copy</button>
      {children}
    </pre>
  );
}

function App({ msg, onCopy }: { msg: { id: string; content: string }; onCopy: (c: string) => void }) {
  return (
    <AIMarkdown<AIMarkdownRenderConfig, ChatMeta>
      content={msg.content}
      metadata={{ messageId: msg.id, onCopyCode: onCopy }}
      customComponents={{ pre: MyCodeBlock }}
    />
  );
}
```

The same wrapper-hook pattern applies — define `useChatMeta = () => useAIMarkdownMetadata<ChatMeta>()` in one place.

> Unlike config, metadata has no `defaultConfig`-style fallback. If the provider passes no `metadata`, the hook returns `undefined` regardless of the asserted type. Always optional-chain.

---

## Combining both generics

```tsx
<AIMarkdown<MyConfig, ChatMeta>
  content={c}
  defaultConfig={defaultMyConfig}
  config={{ showLineNumbers: true }}
  metadata={{ messageId: '1', onCopyCode: handleCopy }}
/>
```

Argument order: `<TConfig, TRenderData>`. TS will infer `ChatMeta` from `metadata`'s shape if you pass only the first generic; explicit is safer.

---

## Available type imports

```ts
import type {
  // Component props
  AIMarkdownProps,
  AIMarkdownDocumentsProps,

  // Configuration
  AIMarkdownRenderConfig,
  AIMarkdownMetadata,
  AIMarkdownRenderState,

  // Customization
  AIMarkdownCustomComponents,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,

  // Pipeline
  AIMDContentPreprocessor,

  // Sanitization
  UrlTransform, // tracks react-markdown
  SanitizeSchema, // tracks rehype-sanitize

  // Cross-chunk registry (read-only)
  Registry,
  ChunkData,
  FootnoteDef,
  LinkDef,
  RefRecord,
  RefKind,

  // Utils
  PartialDeep,
} from '@ai-react-markdown/core';
```

Mantine package additionally exports:

```ts
import type {
  MantineAIMarkdownProps,
  MantineAIMarkdownRenderConfig,
  MantineAIMarkdownMetadata,
} from '@ai-react-markdown/mantine';
```

---

## API stability of `UrlTransform` and `SanitizeSchema`

Both types are **aliases** that track their upstream package shapes:

- `UrlTransform` — follows `react-markdown`'s shape.
- `SanitizeSchema` — follows `rehype-sanitize`'s shape (specifically `typeof defaultSchema`).

These types **may change with the upstream packages' major versions**. The library re-exports them so consumers don't need a direct dependency on the upstream packages for type imports; the trade-off is that if `rehype-sanitize` ships a major bump that changes the schema shape, `SanitizeSchema` here changes in lockstep.

Build your sanitize schema via [`extendSanitizeSchema`](./url-sanitization.md#gate-2-sanitizeschema-via-extendsanitizeschema) rather than hand-typing the schema literal — the helper insulates you from most upstream shape changes.

---

## Footguns

### Asserting a wider `TConfig` than the provider supplies

```tsx
// Provider:
<AIMarkdown defaultConfig={defaultAIMarkdownRenderConfig} />; // ← base config

// Consumer:
const { config } = useAIMarkdownRenderState<MyConfig>();
config.showLineNumbers; // undefined at runtime, but TS shows boolean
```

TS won't catch this. The wrapper-hook pattern is the cure.

### Forgetting to provide `defaultConfig`

```tsx
// ⚠️ Provider uses base default, but `config` carries MyConfig-specific fields.
<AIMarkdown<MyConfig>
  content={c}
  config={{ showLineNumbers: true }}
/>
// defaultConfig falls back to defaultAIMarkdownRenderConfig (base shape),
// which has no `showLineNumbers`. After deep-merge, `config.showLineNumbers === true` —
// but any future consumer reading the field via the base type still sees `undefined` at the type level.

// ✅ Always provide a matching defaultConfig:
<AIMarkdown<MyConfig>
  content={c}
  defaultConfig={defaultMyConfig}
  config={{ showLineNumbers: true }}
/>
```

The wrapper-hook pattern paired with a wrapper component (see [Extending via a Sub-package](./extending-via-subpackage.md)) makes this impossible to forget.

### Putting non-serializable fields in config

`config` is deep-merged with lodash `mergeWith`. Functions, class instances, and other non-plain values _can_ travel through, but the merge isn't designed for them — and the library does `useStableValue` deep-equal on the result, which for functions always returns `false` (cache flush).

For non-data extension points (callbacks, factories), use `metadata` — that's exactly what it's for. Keep `config` for primitives, plain objects, and arrays.
