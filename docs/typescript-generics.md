# TypeScript Generics

`<AIMarkdown>` accepts one generic type parameter:

```ts
function AIMarkdown<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>(
  props: AIMarkdownProps<TMetadata>
): ReactElement;
```

- **`TMetadata`** — your extended metadata, which must include all fields of `AIMarkdownMetadata` (`Record<string, any>` — so any plain object satisfies it).

It defaults to the base type, so you only opt into the generic when you need typed metadata.

> **Where did `TConfig` go?** v1.x took two parameters — `AIMarkdownProps<TConfig, TMetadata>` — the first being a caller-asserted extended render config. v2.0.0 deleted the `config` object channel and the generic with it; metadata moved to the **first (and only) position**, so explicit `<MyConfig, MyMeta>` arguments now fail to compile — drop the config argument. Behavior extension travels through typed flat props and behavior groups instead of an asserted config shape. See [Migrating from 1.x to 2.0](./migrating-to-v2.md) for the full mapping, and [the narrow-hook section below](#the-assertion-problem-and-where-it-lives-now) for where the residual assertion lives.

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
    <AIMarkdown<ChatMeta>
      content={msg.content}
      metadata={{ messageId: msg.id, onCopyCode: onCopy }}
      customComponents={{ pre: MyCodeBlock }}
    />
  );
}
```

TS will infer `ChatMeta` from `metadata`'s shape in most positions; explicit is safer for the reasons below.

> Metadata has no default fallback. If the provider passes no `metadata`, the hook returns `undefined` regardless of the asserted type. Always optional-chain.

---

## The assertion problem, and where it lives now

`useAIMarkdownMetadata<T>()` is a **caller assertion**, not a derived type. TypeScript can't verify that the `<AIMarkdown>` provider above was actually given a `ChatMeta`-shaped value — if you assert wrong, `meta.messageId` looks fine at compile time but evaluates to `undefined` at runtime.

The cure is the same **wrapper-hook pattern** as always: pin the assertion once, next to where the value is provided, and export a narrowed hook:

```ts
// my-app/markdown/meta.ts
import { useAIMarkdownMetadata } from '@ai-react-markdown/core';
import type { ChatMeta } from './types';

export const useChatMeta = () => useAIMarkdownMetadata<ChatMeta>();
```

Every custom component imports `useChatMeta()`; the assertion lives in one file.

For **behavior groups** — the v2 successor of the extended config — the same pattern is the _only_ channel, and it's baked into the API shape. `useAIMarkdownBehaviors()` is non-generic: it returns the three core switches plus an opaque extension record, and the single type assertion happens inside the wrapper's narrow hook. This is exactly what `@ai-react-markdown/mantine` ships for its `codeBlock` group:

```ts
// packages/mantine/src/hooks/useMantineCodeBlockOptions.ts (real code)
export function useMantineCodeBlockOptions(): Required<MantineCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this
  // package, contributed by `MantineAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<MantineCodeBlockOptions> | undefined;
  return useMemo(() => ({ ...defaultMantineCodeBlockOptions, ...group }), [group]);
}
```

Group defaults are applied here too — the hook is the one place both the assertion and the defaults live. See [Extending via a Sub-package](./extending-via-subpackage.md) for the full wrapper recipe.

---

## Available type imports

```ts
import type {
  // Component props
  AIMarkdownProps,
  AIMarkdownDocumentsProps,

  // Metadata
  AIMarkdownMetadata,

  // Context payloads (narrow-hook return shapes)
  AIMarkdownDocumentInfo,
  AIMarkdownThemeInfo,
  AIMarkdownStateCore,
  AIMarkdownBehaviorsCore,
  AIMarkdownStateGroups,
  AIMarkdownBehaviorGroups,
  AIMarkdownExtensionGroups,
  AIMarkdownAggregate,

  // Engine plugins (values live in '@ai-react-markdown/core/plugins')
  AIMarkdownEnginePlugin,
  AIMarkdownEnginePluginName,

  // define* factory fragments
  AIMarkdownThemeProps,
  AIMarkdownBehaviorProps,
  AIMarkdownPipelineProps,

  // Stability firewall (wrapper reuse)
  AIMarkdownStabilityTable,

  // Customization
  AIMarkdownCustomComponents,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,

  // Streaming cursor
  AIMarkdownStreamingCursorProps,
  AIMarkdownStreamingIndicatorProps,
  AIMarkdownStreamingIndicatorComponent,

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
} from '@ai-react-markdown/core';
```

Mantine package additionally exports:

```ts
import type {
  MantineAIMarkdownProps, // extends AIMarkdownProps<TMetadata> with `codeBlock`
  MantineAIMarkdownMetadata,
  MantineCodeBlockOptions,
  MantineBehaviorProps, // widened defineMantineBehaviors input
} from '@ai-react-markdown/mantine';
```

---

## API stability of `UrlTransform` and `SanitizeSchema`

Both types are **aliases** that track their upstream package shapes:

- `UrlTransform` — follows `react-markdown`'s shape.
- `SanitizeSchema` — follows `rehype-sanitize`'s shape (specifically `typeof defaultSchema`).

These types **may change with the upstream packages' major versions**. The library re-exports them so consumers don't need a direct dependency on the upstream packages for type imports; the trade-off is that if `rehype-sanitize` ships a major bump that changes the schema shape, `SanitizeSchema` here changes in lockstep.

Build your sanitize schema via [`extendSanitizeSchema`](./url-sanitization.md#sanitizeschema-gate-1-via-extendsanitizeschema) rather than hand-typing the schema literal — the helper insulates you from most upstream shape changes.

---

## Footguns

### Asserting a wider `TMetadata` than the provider supplies

```tsx
// Provider:
<AIMarkdown content={c} metadata={{ messageId: '1' }} />; // ← no onCopyCode

// Consumer:
const meta = useAIMarkdownMetadata<ChatMeta>();
meta?.onCopyCode; // undefined at runtime, but TS shows the function type
```

TS won't catch this. The wrapper-hook pattern doesn't make the assertion _safe_ — it makes the mismatch findable, because provider and assertion live next to each other in one file.

### Passing v1.x-style generic arguments

```tsx
<AIMarkdown<MyConfig, ChatMeta> … /> // ✗ compile error in v2 — one parameter only
<AIMarkdown<ChatMeta> … />           // ✓
```

Same for `MantineAIMarkdownProps<MyMantineConfig, MyMeta>` → `MantineAIMarkdownProps<MyMeta>`. If you're mid-migration, the [migration guide](./migrating-to-v2.md#generic-signature-mapping-ts-users) has the full signature table (including the removed `PartialDeep` export).

### Scattering `as` assertions at read sites

If you find yourself writing `behaviors.myGroup as MyGroupOptions` in more than one file, you've skipped the narrow hook. Centralize: one hook, one assertion, defaults applied inside it (bare `??` fallbacks at multiple read sites will drift — see [Extending via a Sub-package](./extending-via-subpackage.md#footguns)).
