# Migrating from 1.x to 2.0

v2.0.0 is a hard breaking upgrade of the configuration API. The `config` /
`defaultConfig` object channel, its deep-merge machinery, and the
render-state context are **removed outright** — there is no compatibility
layer and no deprecation window. This guide is the complete migration
story: every removed symbol has a one-to-one destination here, each with
runnable before/after code.

What did NOT change: the rendering engine. The produced plugin chain is
byte-equivalent to 1.8.x for equivalent selections, and the block-memo /
incremental-parse machinery is semantically untouched. A migrated app
renders the same bytes.

## Why the break

The 1.x `config` object had four structural defects:

1. **Snapshot rot.** A custom `defaultConfig` was a complete frozen
   snapshot; every optional field core added later was silently absent
   from it. This shipped one real defect: a hand-written `defaultConfig`
   that omitted `incrementalParseEnabled` silently opted out of
   incremental parsing.
2. **Caller-asserted generics.** `useAIMarkdownRenderState<TConfig>()` was
   an `as` assertion TypeScript could not verify.
3. **One object, two change contracts.** Pipeline-tier fields and
   component-preference fields lived in one bag with very different
   re-render costs.
4. **Merge-semantics burden.** Deep merge, wholesale array replacement,
   and no-backfill were three rules living in three places.

v2 replaces the bag with flat props resolved once against shipped
defaults, a sealed engine-plugin catalog, and five per-system contexts.

## Field mapping (exhaustive)

| v1.x                                                         | v2.0.0                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `config.blockMemoEnabled` / `defaultConfig.blockMemoEnabled` | `blockMemo` prop                                                               |
| `config.incrementalParseEnabled`                             | `incrementalParse` prop                                                        |
| `config.preserveOrphanReferences`                            | `preserveOrphanReferences` prop                                                |
| `config.extraSyntaxSupported`                                | `enginePlugins` prop (plugin objects `highlight`, `definitionList`)            |
| `config.displayOptimizeAbilities`                            | `enginePlugins` prop (plugin objects `removeComments`, `smartypants`, `pangu`) |
| `config.codeBlock.*` (mantine)                               | `codeBlock` prop on `MantineAIMarkdown`                                        |
| `defaultConfig` (integrator channel)                         | wrapper destructuring defaults + widened `define*` factories                   |

Precedence in v2 has exactly two levels: an explicitly passed prop
(`v != null`) overrides the shipped default; an absent prop falls to the
shipped default. Passing `null` counts as absent — this guards against
serialization boundaries (RSC, persistence) materializing "not passed" as
`null` and punching through defaults.

### Behavior switches

```tsx
// v1.x
<AIMarkdown
  content={content}
  config={{ blockMemoEnabled: false, incrementalParseEnabled: false }}
/>

// v2.0.0
<AIMarkdown content={content} blockMemo={false} incrementalParse={false} />
```

### ⚠️ Absence-semantics flip: `incrementalParse`

v1.x treated an omitted `incrementalParseEnabled` in a custom
`defaultConfig` as **off** (the snapshot-rot trap). v2.0.0 treats absence
as the shipped default, which is **on**.

```tsx
// v1.x — this custom defaultConfig silently DISABLED incremental parsing
// because the optional field is absent from the snapshot:
<AIMarkdown content={content} defaultConfig={myCompleteConfigWithoutIncrementalField} />

// v2.0.0 — absence means the shipped default (ON). To keep the old
// behavior, opt out explicitly:
<AIMarkdown content={content} incrementalParse={false} />
```

If your 1.x app relied on the trap (never set the field, engine stayed
off), you MUST now write `incrementalParse={false}` to keep that behavior.

### Enums → sealed engine plugins

The two enums are replaced by one prop accepting core-exported sealed
plugin objects. Note that a single prop now covers BOTH former enum
fields — passing an array replaces the whole selection wholesale.

```tsx
// v1.x
import AIMarkdown, {
  AIMarkdownRenderExtraSyntax,
  AIMarkdownRenderDisplayOptimizeAbility,
} from '@ai-react-markdown/core';

<AIMarkdown
  content={content}
  config={{
    extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT],
    displayOptimizeAbilities: [AIMarkdownRenderDisplayOptimizeAbility.PANGU],
  }}
/>;

// v2.0.0
import AIMarkdown from '@ai-react-markdown/core';
import { highlight, pangu } from '@ai-react-markdown/core/plugins';

const PLUGINS = [highlight, pangu]; // module scope — stable reference

<AIMarkdown content={content} enginePlugins={PLUGINS} />;
```

The recommended "turn one off" idiom:

```tsx
import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';

const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
```

Rules worth knowing:

- Omitting `enginePlugins` means `defaultEnginePlugins` (all five —
  parity with the 1.x shipped defaults).
- Each plugin's position in the produced chain comes from its internal
  stage metadata; the order of your array is irrelevant. Duplicates are
  deduplicated with a dev warning.
- The set is **sealed**: only core constructs plugins (the incremental
  engine's boundary scanner must know every construct's syntax; open
  injection would void its verification record). Third-party content
  extension stays open through `contentPreprocessors` + `customComponents`.
- Plugin objects are not serializable. For remote-config scenarios, store
  `plugin.name` strings and map them back to the exported singletons at
  the edge.

### mantine `codeBlock`

```tsx
// v1.x
<MantineAIMarkdown content={content} config={{ codeBlock: { defaultExpanded: false } }} />

// v2.0.0 — group value replaces atomically; omitted fields fall to defaults
<MantineAIMarkdown content={content} codeBlock={{ defaultExpanded: false }} />
```

## Hook replacement: `useAIMarkdownRenderState` is deleted

There is no shim. Each field of the old render state has a narrow-hook
destination; narrow hooks re-render only when their own system changes
(`streaming` flips no longer wake every consumer):

| v1.x read                                                                             | v2.0.0 hook                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `.config.blockMemoEnabled` / `.incrementalParseEnabled` / `.preserveOrphanReferences` | `useAIMarkdownBehaviors()` (same names as the flat props)      |
| `.config.<wrapperField>` (e.g. mantine `codeBlock`)                                   | the wrapper's narrow hook, e.g. `useMantineCodeBlockOptions()` |
| `.streaming`                                                                          | `useAIMarkdownState().streaming`                               |
| `.fontSize` / `.variant` / `.colorScheme`                                             | `useAIMarkdownTheme()`                                         |
| `.documentId` / `.documentIdExplicit` / `.clobberPrefix`                              | `useAIMarkdownDocument()`                                      |

```tsx
// v1.x
import { useAIMarkdownRenderState } from '@ai-react-markdown/core';

function MyCodeBlock() {
  const { streaming, fontSize, config } = useAIMarkdownRenderState();
  return <pre data-streaming={streaming} style={{ fontSize }} data-memo={config.blockMemoEnabled} />;
}

// v2.0.0
import { useAIMarkdownState, useAIMarkdownTheme, useAIMarkdownBehaviors } from '@ai-react-markdown/core';

function MyCodeBlock() {
  const { streaming } = useAIMarkdownState();
  const { fontSize } = useAIMarkdownTheme();
  const { blockMemo } = useAIMarkdownBehaviors();
  return <pre data-streaming={streaming} style={{ fontSize }} data-memo={blockMemo} />;
}
```

For teaching code and low-frequency components there is an aggregate:

```tsx
const { document, metadata, state, theme, behaviors } = useAIMarkdown();
```

It subscribes to all five contexts and re-renders on ANY change (including
every `streaming` flip) — performance-sensitive components should use the
narrow hooks.

`useMantineAIMarkdownRenderState` is likewise deleted; replace it with the
narrow-hook combination above plus `useMantineCodeBlockOptions()` for the
`codeBlock` group.

## Integrator channel: `defaultConfig` → destructuring defaults + factories

A 1.x wrapper that shipped an extended `defaultConfig` now:

1. defaults its own scalar props via destructuring parameters;
2. transports component-parameter groups through
   `AIMarkdownBehaviorsProvider` (stacked OUTSIDE `<AIMarkdown>`), reading
   them back through its own narrow hook — the single place both the type
   assertion and the group defaults live;
3. re-exports a widened `define*` factory for its extension fields.

```tsx
// v1.x wrapper pattern (deleted)
export const myDefaultConfig: MyConfig = { ...defaultAIMarkdownRenderConfig, panel: { compact: false } };
export const useMyRenderState = () => useAIMarkdownRenderState<MyConfig>();

// v2.0.0 wrapper pattern
import AIMarkdown, {
  AIMarkdownBehaviorsProvider,
  useAIMarkdownBehaviors,
  useStableRecord,
  AIMarkdownStabilityPolicy,
  type AIMarkdownStabilityTable,
} from '@ai-react-markdown/core';

interface PanelOptions {
  compact: boolean;
}
const PANEL_DEFAULTS: PanelOptions = { compact: false };

const TABLE: AIMarkdownStabilityTable<{ panel: Partial<PanelOptions> | undefined }> = {
  panel: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

export function MyMarkdown({ panel, ...rest }: MyMarkdownProps) {
  const stable = useStableRecord({ panel }, TABLE);
  const groups = useMemo(() => ({ panel: stable.panel ?? {} }), [stable.panel]);
  return (
    <AIMarkdownBehaviorsProvider value={groups}>
      <AIMarkdown {...rest} />
    </AIMarkdownBehaviorsProvider>
  );
}

// The single assertion site — group defaults applied INSIDE the hook:
export function usePanelOptions(): Required<PanelOptions> {
  const behaviors = useAIMarkdownBehaviors();
  const group = behaviors.panel as Partial<PanelOptions> | undefined;
  return useMemo(() => ({ ...PANEL_DEFAULTS, ...group }), [group]);
}
```

The former third-level extension pattern (an app passing a custom
`defaultConfig` through a wrapper) becomes: pass the wrapper's group props
(or spread a widened `define*` fragment); apps can also stack their own
`AIMarkdownBehaviorsProvider` / `AIMarkdownStateProvider` for app-level
groups. Core keys (`blockMemo`, `incrementalParse`,
`preserveOrphanReferences`; `streaming`) are locked — type-forbidden,
overwritten at the innermost merge, and warned about in dev.

## `define*` factories (new, optional)

Integration-time values can be packaged as frozen, reference-stable
fragments and spread into the component. Runtime-varying fields go AFTER
the spreads (later props win):

```tsx
import { defineTheme, defineBehaviors, definePipeline } from '@ai-react-markdown/core';

const THEME = defineTheme({ fontSize: 15, variant: 'default' });
const BEHAVIORS = defineBehaviors({ blockMemo: false });
const PIPELINE = definePipeline({ sanitizeSchema: MY_SCHEMA });

<AIMarkdown content={content} {...THEME} {...BEHAVIORS} {...PIPELINE} colorScheme={userScheme} />;
```

Factories are identity + types + `Object.freeze`, zero logic — bare flat
props are always equally legal. Core factories accept core fields only;
wrappers re-export widened versions (e.g. `defineMantineBehaviors`, which
adds `codeBlock`).

## Generic-signature mapping (TS users)

Explicit type arguments change positionally:

```tsx
// v1.x
AIMarkdownProps<MyConfig, MyMetadata>;
MantineAIMarkdownProps<MyMantineConfig, MyMetadata>;

// v2.0.0 — TConfig is gone; metadata moves to the FIRST position
AIMarkdownProps<MyMetadata>;
MantineAIMarkdownProps<MyMetadata>;
```

Explicit `<MyConfig, MyMeta>` arguments now fail to compile — drop the
config argument. The `PartialDeep` type export is removed with no
replacement (nothing on the v2 surface is deep-partial).

`useAIMarkdownMetadata<TMetadata>()` is unchanged.

## Removed symbols, complete list

| Removed                                                                 | Destination                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `config` / `defaultConfig` props                                        | flat props (table above)                                    |
| `AIMarkdownRenderConfig`, `defaultAIMarkdownRenderConfig`               | — (shipped defaults live in the resolver)                   |
| `AIMarkdownRenderExtraSyntax`, `AIMarkdownRenderDisplayOptimizeAbility` | `@ai-react-markdown/core/plugins`                           |
| `AIMarkdownRenderState`, `useAIMarkdownRenderState`                     | five narrow hooks + `useAIMarkdown()`                       |
| `PartialDeep` type export                                               | —                                                           |
| `MantineAIMarkdownRenderConfig`, `defaultMantineAIMarkdownRenderConfig` | `MantineCodeBlockOptions`, `defaultMantineCodeBlockOptions` |
| `useMantineAIMarkdownRenderState`                                       | narrow hooks + `useMantineCodeBlockOptions()`               |

## Unchanged contracts, stated for clarity

- `<AIMarkdownDocuments preserveOrphanReferences>`: omitting the prop has
  always equaled an explicit `true`, and the wrapper still unconditionally
  overrides the per-chunk value for all chunks under it. Unchanged in v2.
- The legacy renderer (`blockMemo: false`) still does not participate in
  cross-chunk coordination.
- `metadata` is still deliberately never stabilized by the library — the
  exemption is now a declared `PASS_THROUGH` row in the stability firewall
  table instead of an undocumented absence.

## Footguns

- **Do not re-apply group defaults at read sites.** Wrapper groups apply
  their defaults inside the wrapper's narrow hook exactly once; bare `??`
  fallbacks at multiple read sites will drift.
- **`enginePlugins` arrays belong at module scope.** The prop is
  deep-equal-stabilized as a backstop, but an inline array still pays one
  comparison per render (dev builds warn on high-frequency restores).
- **Wholesale-replacing `sanitizeSchema` without re-including the
  library's schema material** silently disables the features that depend
  on it (cross-chunk placeholders, KaTeX class names). Build schemas with
  `extendSanitizeSchema` — unchanged from 1.x.
- **Flat props share one namespace across core and wrappers.** Wrapper
  authors must check the prop-name registry (the props table in the
  [core README](../packages/core/README.md#props-api-reference)) before
  adding fields; collisions are compile errors for TS consumers but
  silent overrides for plain-JS consumers.
