# Extending via a Sub-package

`@ai-react-markdown/mantine` is the reference implementation of a **third-party integration** built on `@ai-react-markdown/core`. If you want to ship your own — Chakra, MUI, Tailwind-themed, Tamagui, your in-house design system — this document is the recipe.

The pattern composes only the public extension points of core: `Typography`, `ExtraStyles`, `customComponents`, the additive Providers (`AIMarkdownBehaviorsProvider` / `AIMarkdownStateProvider`), the stability firewall (`useStableRecord`), and the widened `define*` factories. No internal API access required.

---

## The extension points, at a glance

| Extension point                                    | What it carries                                                                   | Transport                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Wrapper **behavior groups** (e.g. `codeBlock`)     | Component behavior parameters — runtime-switchable, cost = leaf re-render         | Flat prop on your wrapper → `AIMarkdownBehaviorsProvider` → your narrow hook   |
| **State groups**                                   | Extension message-lifecycle states (aborted, reasoning, tool-call-in-progress, …) | `AIMarkdownStateProvider` → read via `useAIMarkdownState()`                    |
| `Typography` / `ExtraStyles` / `customComponents`  | Design-system rendering                                                           | Defaulted via destructuring, forwarded as ordinary props                       |
| `enginePlugins`                                    | **Curation only** — bundle default sets, filter, facade sugar                     | Forwarded prop; new parse-level capability goes through an upstream PR to core |
| Engine payloads (`sanitizeSchema`, preprocessors…) | Pipeline inputs your features may depend on                                       | Forwarded prop; declare an injection policy per payload (see Step 6)           |

Two contracts govern the state-group channel:

- **Frequency contract**: state groups must be message-lifecycle frequency (flips per stream start/end, per abort, per tool call). Frame-rate data (per-token progress etc.) goes through metadata's stable-container pattern instead.
- **Core-key locks**: outer Providers can never touch core keys (`streaming` for state; `blockMemo` / `incrementalParse` / `preserveOrphanReferences` for behaviors). Three locks enforce this: the Provider `value` type marks core keys `never` (compile error), core's innermost merge unconditionally overwrites them (spread order), and dev builds warn when an outer value carries one.

The sealed `enginePlugins` set is a deliberate boundary: the incremental engine's boundary scanner must know every construct's syntax, so open plugin injection would void its verification record. Wrappers curate; core constructs and certifies. Third-party _content_ extension stays open through `contentPreprocessors` + `customComponents`.

---

## The Mantine model

```text
@ai-react-markdown/mantine
├── MantineAIMarkdown (wrapper component)
│   ├── Typography = MantineAIMarkdownTypography     ← Mantine <Typography> wrapper
│   ├── ExtraStyles = MantineAIMDefaultExtraStyles   ← CSS scoping for em-based tokens
│   ├── customComponents.pre = MantineAIMPreCode     ← CodeHighlight + Mermaid + JSON pretty-print
│   ├── codeBlock prop → AIMarkdownBehaviorsProvider ← the wrapper's behavior group
│   └── colorScheme = Mantine's useComputedColorScheme (when not overridden)
│
├── defs.tsx
│   ├── MantineCodeBlockOptions + defaultMantineCodeBlockOptions
│   └── MantineAIMarkdownMetadata (extends AIMarkdownMetadata)
│
├── define.ts
│   └── defineMantineBehaviors (widened factory: core behavior fields + codeBlock)
│
└── hooks/
    ├── useMantineCodeBlockOptions   (THE single assertion + defaults site for the group)
    └── useMantineAIMarkdownMetadata
```

Every piece composes existing core APIs — there's no special "extension API." Your sub-package can follow the same shape, swapping Mantine for your design system.

---

## Step 1: Define your behavior group

A group is a plain interface plus frozen defaults. No config-object extension, no core defaults spread in — the group is self-contained:

```ts
// packages/your-integration/src/defs.ts
import type { AIMarkdownMetadata } from '@ai-react-markdown/core';

export interface YourCodeBlockOptions {
  showCopyButton: boolean;
  defaultLanguage: string;
}

/** Shipped defaults — applied inside the narrow hook (Step 3), nowhere else. */
export const defaultYourCodeBlockOptions: Readonly<YourCodeBlockOptions> = Object.freeze({
  showCopyButton: true,
  defaultLanguage: 'plaintext',
});

export interface YourAIMarkdownMetadata extends AIMarkdownMetadata {
  // Extension point — keep empty or add integration-specific fields.
}
```

Before naming group _prop_ fields, check the prop-name registry — the props table in the [core README](../packages/core/README.md#props-api-reference): flat props share one namespace across core and all wrapper layers (see [Footguns](#footguns)).

---

## Step 2: Build the wrapper component

The wrapper does four jobs: default the slot components, merge `customComponents`, run its own stability firewall for the props it terminates, and contribute its group through the additive Provider. This mirrors `packages/mantine/src/MantineAIMarkdown.tsx`:

```tsx
// packages/your-integration/src/YourAIMarkdown.tsx
import { memo, useMemo } from 'react';
import AIMarkdown, {
  type AIMarkdownProps,
  type AIMarkdownCustomComponents,
  type AIMarkdownStabilityTable,
  AIMarkdownBehaviorsProvider,
  AIMarkdownStabilityPolicy,
  useStableRecord,
  useStableValue,
} from '@ai-react-markdown/core';

import YourTypography from './components/Typography';
import YourExtraStyles from './components/ExtraStyles';
import YourPreCode from './components/PreCode';
import type { YourAIMarkdownMetadata, YourCodeBlockOptions } from './defs';

export interface YourAIMarkdownProps<
  TMetadata extends YourAIMarkdownMetadata = YourAIMarkdownMetadata,
> extends AIMarkdownProps<TMetadata> {
  /** Your behavior group. Atomic replacement; defaults applied inside the narrow hook. */
  codeBlock?: Partial<YourCodeBlockOptions>;
}

/** Stable empty group for the absent-prop case (identity-stable context value). */
const EMPTY_CODE_BLOCK: Partial<YourCodeBlockOptions> = Object.freeze({});

/**
 * Your stability-firewall table — rows ONLY for object props this wrapper
 * TERMINATES (consumes in its own machinery). Forwarded object props ride
 * core's firewall untouched; derived values (the merged `customComponents`
 * below) are caught by core's wall.
 */
const STABILITY_TABLE: AIMarkdownStabilityTable<{
  codeBlock: Partial<YourCodeBlockOptions> | undefined;
}> = {
  codeBlock: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

const DEFAULT_COMPONENTS: AIMarkdownCustomComponents = {
  pre: YourPreCode,
  // …add more if your integration overrides other elements
};

const YourAIMarkdownComponent = <TMetadata extends YourAIMarkdownMetadata = YourAIMarkdownMetadata>({
  Typography = YourTypography,
  ExtraStyles = YourExtraStyles,
  customComponents,
  codeBlock,
  ...rest
}: YourAIMarkdownProps<TMetadata>) => {
  const stableCustomComponents = useStableValue(customComponents);

  // Merge: caller overrides win over your defaults.
  const usedComponents = useMemo(
    () => (stableCustomComponents ? { ...DEFAULT_COMPONENTS, ...stableCustomComponents } : DEFAULT_COMPONENTS),
    [stableCustomComponents]
  );

  // Your firewall: `codeBlock` is terminated here (it feeds the Provider
  // below, not the core prop surface).
  const stable = useStableRecord({ codeBlock }, STABILITY_TABLE);

  // Contribute the group through the additive behaviors Provider — firewall
  // output used directly (`null` ≡ absent → empty group; the narrow hook
  // fills the defaults), record identity memoized so the context value
  // stays stable across unrelated re-renders.
  const behaviorGroups = useMemo(() => ({ codeBlock: stable.codeBlock ?? EMPTY_CODE_BLOCK }), [stable.codeBlock]);

  return (
    <AIMarkdownBehaviorsProvider value={behaviorGroups}>
      <AIMarkdown<TMetadata>
        Typography={Typography}
        ExtraStyles={ExtraStyles}
        customComponents={usedComponents}
        {...rest}
      />
    </AIMarkdownBehaviorsProvider>
  );
};

export const YourAIMarkdown = memo(YourAIMarkdownComponent);
YourAIMarkdown.displayName = 'YourAIMarkdown';
export default YourAIMarkdown as typeof YourAIMarkdownComponent;
```

**Key points**:

- The Provider stacks **outside** `<AIMarkdown>`. Core's innermost provider reads your outer context and provides `{ ...outer, ...coreResolved }` downward — consumers see exactly one behaviors context, and core keys always win.
- Own scalar props default via destructuring parameters, strip via rest destructuring, forward `{...rest}`. The rest object's identity needs no stabilization — JSX spread flattens to individual props and React compares them individually.
- Firewall rule: your `useStableRecord` table holds **only props you terminate** (mantine today: one row, `codeBlock`). Forwarded props are never touched — each prop is stabilized exactly once, at the layer that consumes it.
- Wrap with `memo`; merge `customComponents` with caller-wins spread order (`{ ...DEFAULT_COMPONENTS, ...callerComponents }`).

---

## Step 3: The narrow hook — the single assertion + defaults site

`useAIMarkdownBehaviors()` is non-generic and returns the core switches plus an opaque extension record. Your narrow hook is where the type assertion happens (exactly once) and where group defaults are applied (exactly once):

```ts
// packages/your-integration/src/hooks/useYourCodeBlockOptions.ts
import { useMemo } from 'react';
import { useAIMarkdownBehaviors } from '@ai-react-markdown/core';
import { defaultYourCodeBlockOptions, type YourCodeBlockOptions } from '../defs';

export function useYourCodeBlockOptions(): Required<YourCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this package,
  // contributed by `YourAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<YourCodeBlockOptions> | undefined;
  return useMemo(() => ({ ...defaultYourCodeBlockOptions, ...group }), [group]);
}
```

Group values replace atomically at the transport layer; a partial group (`codeBlock={{ showCopyButton: false }}`) resolves its omitted fields to the shipped defaults here. Read sites must consume this hook and never re-apply defaults with bare `??` (see [Footguns](#footguns)).

The metadata hook is the same one-liner it always was:

```ts
// packages/your-integration/src/hooks/useYourMetadata.ts
import { useAIMarkdownMetadata } from '@ai-react-markdown/core';
import type { YourAIMarkdownMetadata } from '../defs';

export const useYourMetadata = () => useAIMarkdownMetadata<YourAIMarkdownMetadata>();
```

---

## Step 4: The widened `define*` factory

Core factories accept core fields only — passing `codeBlock` to core's `defineBehaviors` is a TS error. The widened factory is your one-line obligation (mirrors `packages/mantine/src/define.ts`):

```ts
// packages/your-integration/src/define.ts
import type { AIMarkdownBehaviorProps } from '@ai-react-markdown/core';
import type { YourCodeBlockOptions } from './defs';

export interface YourBehaviorProps extends AIMarkdownBehaviorProps {
  codeBlock?: Partial<YourCodeBlockOptions>;
}

/** Identity + your types + freeze; zero logic. */
export function defineYourBehaviors(values: YourBehaviorProps): Readonly<YourBehaviorProps> {
  return Object.freeze(values);
}
```

Consumers spread the frozen fragment; runtime-varying fields go after the spreads (later props win):

```tsx
const BEHAVIORS = defineYourBehaviors({ blockMemo: true, codeBlock: { showCopyButton: false } });

<YourAIMarkdown content={content} {...BEHAVIORS} streaming={!done} />;
```

---

## Step 5: Design-system components

### Typography wrapper

```tsx
// packages/your-integration/src/components/Typography.tsx
import type { AIMarkdownTypographyComponent } from '@ai-react-markdown/core';
import { Box, useTheme } from 'your-design-system';

const YourTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => {
  const theme = useTheme();
  return (
    <Box
      data-variant={variant}
      data-color-scheme={colorScheme}
      style={{
        fontSize,
        fontFamily: theme.fonts.body,
        ...style, // ← MUST spread style for --aim-font-size-root to reach descendants
      }}
    >
      {children}
    </Box>
  );
};

export default YourTypography;
```

See [Custom Typography](./custom-typography.md) for the full Typography contract, including why `style` must be spread.

### Extra-styles wrapper

```tsx
// packages/your-integration/src/components/ExtraStyles.tsx
import type { AIMarkdownExtraStylesComponent } from '@ai-react-markdown/core';

const YourExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="your-integration-scope">{children}</div>
);

export default YourExtraStyles;
```

Ship a corresponding CSS file with selectors under `.your-integration-scope` for any em-based or theme-aware overrides specific to your design system.

### The pre/code component (if you override code blocks)

This is where most of an integration's value lives — syntax highlighting, copy button, expand/collapse, Mermaid, JSON pretty-print. Read the narrow hooks:

```tsx
// packages/your-integration/src/components/PreCode.tsx
import { useAIMarkdownState } from '@ai-react-markdown/core';
import { useYourCodeBlockOptions } from '../hooks/useYourCodeBlockOptions';

interface PreCodeProps {
  node?: any; // hast Element
  children?: React.ReactNode;
}

function YourPreCode({ node, children }: PreCodeProps) {
  const { streaming } = useAIMarkdownState();
  const { showCopyButton, defaultLanguage } = useYourCodeBlockOptions();
  const code = node?.children?.[0];
  if (code?.tagName !== 'code') return <pre>{children}</pre>;

  const className = (code.properties?.className as string[] | undefined) ?? [];
  const language = className.find((c) => c.startsWith('language-'))?.slice('language-'.length);
  const text = (code.children?.map((c: any) => c.value ?? '').join('') ?? '').trimEnd();

  if (language === 'mermaid') return <YourMermaidBlock source={text} />;
  if (language === 'json') return <YourJsonBlock source={text} />;
  return (
    <YourHighlightedBlock
      language={language ?? defaultLanguage}
      source={text}
      showCopy={!streaming && showCopyButton}
    />
  );
}

export default YourPreCode;
```

> Notice this component reads two narrow hooks — `useAIMarkdownState()` for `streaming` and your group hook for the code-block options. Both are valid simultaneously; they subscribe to different contexts, so a `streaming` flip re-renders this component but not consumers that only read behaviors.

---

## Step 6: Payload policy (declare it per payload)

For each engine payload (`contentPreprocessors`, `urlTransform`, `sanitizeSchema`, `customComponents`), pick one of two stances and write it into your package contract:

- **Your features depend on it** → inject unconditionally. For `contentPreprocessors`, fix and document the injection position (prepend or append — order is semantics).
- **Everything else** → the user's value wins wholesale, and you export your raw materials for manual composition.

The mantine example of the second stance: mantine does not inject schema material silently, so a consumer who wholesale-replaces `sanitizeSchema` without rebuilding it via `extendSanitizeSchema` silently disables the features that depend on the default schema's invariants (cross-chunk placeholders, KaTeX class names). Document your equivalent footgun.

If you ship a perf-flavored switch of your own (a hypothetical `mermaid.lazyRender`), it does not inherit core's byte-equivalence guarantee — self-certify an equivalence contract in your own docs.

---

## Step 7: Index / barrel exports

```ts
// packages/your-integration/src/index.ts
export type { YourAIMarkdownProps } from './YourAIMarkdown';
export { default } from './YourAIMarkdown';
export { default as YourTypography } from './components/Typography';
export { default as YourExtraStyles } from './components/ExtraStyles';
export type { YourAIMarkdownMetadata, YourCodeBlockOptions } from './defs';
export { defaultYourCodeBlockOptions } from './defs';
export { useYourCodeBlockOptions } from './hooks/useYourCodeBlockOptions';
export { useYourMetadata } from './hooks/useYourMetadata';
export { defineYourBehaviors } from './define';
export type { YourBehaviorProps } from './define';
```

Match the shape of `@ai-react-markdown/mantine`'s barrel for consistency. Re-export the typography and extra-styles components so consumers can wrap or compose them.

---

## Step 8: Peer dependencies

```jsonc
// packages/your-integration/package.json
{
  "peerDependencies": {
    "@ai-react-markdown/core": "^2.0.0",
    "react": ">=19",
    "react-dom": ">=19",
    "your-design-system": "^1.0.0",
  },
  "dependencies": {
    // Direct deps your integration needs (e.g. a mermaid library, a syntax highlighter)
  },
}
```

Keep `@ai-react-markdown/core` as a **peer** dep — never a direct dep. Otherwise consumers can end up with two copies of core in their bundle, and the React context identity check fails (silent breakage: hooks find no provider).

---

## Step 9: Use it

```tsx
import YourAIMarkdown from '@yourorg/ai-react-markdown-yourds';
import { YourDesignSystemProvider } from 'your-design-system';

function App() {
  return (
    <YourDesignSystemProvider>
      <YourAIMarkdown content="Hello **world**!" codeBlock={{ showCopyButton: false }} />
    </YourDesignSystemProvider>
  );
}
```

Consumers don't need to know about core — they install your package and the Mantine-style "drop in" experience is preserved.

---

## Third-level extension: apps stacking their own Provider

The additive Providers are not wrapper-exclusive. An application built on your wrapper (or on core directly) can stack its own groups outside the component tree it renders:

```tsx
import { AIMarkdownBehaviorsProvider, AIMarkdownStateProvider } from '@ai-react-markdown/core';

// Integration-time groups: module scope.
const APP_BEHAVIORS = { chatPanel: { compactQuotes: true } };

function ChatMessage({ content, aborted, toolCallInProgress }: ChatMessageProps) {
  // Runtime state groups: memoized so the context value keeps its identity.
  const lifecycleGroups = useMemo(
    () => ({ lifecycle: { aborted, toolCallInProgress } }),
    [aborted, toolCallInProgress]
  );
  return (
    <AIMarkdownStateProvider value={lifecycleGroups}>
      <AIMarkdownBehaviorsProvider value={APP_BEHAVIORS}>
        <YourAIMarkdown content={content} />
      </AIMarkdownBehaviorsProvider>
    </AIMarkdownStateProvider>
  );
}
```

Multi-level stacks merge naturally — for a duplicated group key the inner layer wins. The same rules apply at every level: core keys are locked (three locks, above), state groups obey the message-lifecycle frequency contract, values should be firewall/`useMemo` output so the context value keeps its identity, and the app should read its groups through its own narrow hook. Only behaviors and state are stackable; the theme context is reserved (mechanism exists, enabled on first real demand), document is closed (its payload is derived invariants — a forgeable `clobberPrefix` breaks the anchor system), and metadata doesn't need a Provider (wrappers merge at the prop layer).

Known cost: within one context, group invalidation is not isolated — one group change leaf-re-renders all subscribers of that context. Acceptable at current scale; a party needing isolation may run a private context as an escape hatch (both approaches are legal simultaneously).

---

## Tips from the Mantine integration

| Practice                                                                                                | Why                                                                                           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `useStableRecord` with a table for the object props you terminate; `useStableValue` before merging      | A new merged object every render flushes the block-memo cache                                 |
| Auto-detect color scheme from your design system if not overridden                                      | Match the surrounding UI without explicit prop                                                |
| Ship a CSS file that overrides design-system spacing/font tokens to em-based units inside `ExtraStyles` | Markdown should scale with `fontSize` regardless of the design system's absolute tokens       |
| Keep `mermaid` (or whichever heavy lib) as a **direct** dep, not peer                                   | Consumers shouldn't have to install it separately for a feature they enabled via your package |
| Memo the wrapper at the top level                                                                       | Standard React perf hygiene                                                                   |

---

## What to avoid

### Re-implementing the pipeline

Don't fork `MarkdownContent` or the remark/rehype plugin chain. The core's pipeline is the value you're building on; bypassing it loses cross-chunk coordination, block memoization, LaTeX preprocessing, sanitization, and CJK handling. Compose at the public extension points instead.

### Trying to inject engine plugins

`enginePlugins` accepts core-exported sealed plugin objects only — the seal is a `unique symbol` brand you cannot construct. This is deliberate: the incremental engine's verification record (fuzz suites, byte equivalence) covers a closed construct set. Your curation rights: bundle default sets, filter (`defaultEnginePlugins.filter(...)`), facade sugar. If your integration needs a new parse-level construct, open an upstream PR to core — that's the priced tradeoff, stated plainly.

### Pinning to a patch version of `@ai-react-markdown/core`

Use a caret range (`^2.0.0`). Minor and patch versions of core are non-breaking. A strict pin causes resolution headaches for downstream consumers.

### Re-exporting internal core types

Stick to `AIMarkdownProps`, `AIMarkdownCustomComponents`, `AIMarkdownTypographyComponent`, `AIMarkdownStabilityTable`, etc. — the documented public surface. If your integration needs something internal-looking, that's a signal to either request the export upstream or work around it.

### Forgetting to test cross-chunk coordination

`<AIMarkdownDocuments>` works through `<YourAIMarkdown>` transparently — but the test that verifies this should live in your package. The Mantine test suite has equivalents; mirror them.

---

## Footguns

### Re-applying group defaults at read sites

Group defaults live inside your narrow hook, exactly once. A component that reads `behaviors.codeBlock` directly and patches holes with bare `??` duplicates the defaults — and when the shipped default changes, the read sites drift apart silently. Every read goes through the hook.

### Prop-name collisions

Flat props share one namespace across core and all wrapper layers. Check the prop-name registry — the props table in the [core README](../packages/core/README.md#props-api-reference) — before adding a field to your wrapper props. A collision is a compile error at the `extends` site for TS consumers — but a **silent override** for plain-JS consumers. Same discipline for group keys inside the Provider value: prefix or scope them so an app-level group can't shadow yours accidentally.

### Wholesale-replacing `sanitizeSchema`

A consumer (or your wrapper) that passes a hand-built `sanitizeSchema` replaces the library's schema atomically — there is no library-side merging. Without the default schema's material, cross-chunk placeholders and KaTeX class names are silently stripped. Always build schemas with `extendSanitizeSchema` (it starts from a deep clone of the default, invariants included), and say so in your README.

---

## Distribution

Publishing a `@yourorg/ai-react-markdown-…` package is the natural unit of distribution. There's no central "integration registry" — discoverability is through npm keywords, your README, and the broader ai-react-markdown community (link to your package in the parent project's discussion forum or via a PR adding a row to a hypothetical integrations table).

When you publish, consider:

- A README following the structure of `@ai-react-markdown/mantine`.
- A peer-dep statement that's permissive enough (`>=19` for React, `^2.0.0` for core).
- npm keywords: `react`, `markdown`, `ai`, `llm`, `<your-design-system>`, `ai-react-markdown-integration`.
- Bundle size disclosure (bundlephobia badges).

Optionally, propose to add a row to the parent project's "Integrations" section if/when one exists.
