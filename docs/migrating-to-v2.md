# Migrating from 1.x to 2.0

This is the historical React 1.x → 2.x API migration. To adopt the current stable 3.0 packages, also follow [From ai-react-markdown to ai-markdown](./framework-transition.md); the old React core package is now `@ai-markdown/react`, while `@ai-markdown/core` is framework-independent.

The 2.0 migration replaces `config` and `defaultConfig` with flat component props, a sealed engine-plugin selection, and separate contexts for document identity, metadata, state, theme, and behaviors. The old config types and render-state hooks were removed; upgrading requires updating imports and call sites rather than enabling a compatibility flag.

Use the mapping tables below to preserve your selections, then migrate custom renderers and wrapper defaults. The before snippets intentionally use removed 1.x APIs; only the after snippets target 2.x. Template values such as `content`, `MY_SCHEMA`, and application wrapper types stand for code in your project.

The original 2.0 change was designed to preserve the 1.8.x rendering pipeline for equivalent selections. That historical compatibility statement is not a promise that every later 2.x release emits identical HTML: later versions include parser, sanitization, coordination, and rendering fixes. When moving directly to the current release, read the subsequent [release highlights](./release-highlights.md) and verify your custom output semantically.

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

For core-resolved flat fields, precedence in v2 has two levels: an explicitly passed prop
(`v != null`) overrides the shipped default; an absent prop falls to the
shipped default. Passing `null` counts as absent — this guards against
serialization boundaries (RSC, persistence) materializing "not passed" as
`null` and punching through defaults. Wrapper slot defaults and fields inside extension groups have their own policy: JavaScript destructuring defaults apply to undefined, and group defaults are owned by the wrapper hook. Do not generalize core’s null handling to every nested field.

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
import { useMemo } from 'react';
import AIMarkdown, {
  AIMarkdownBehaviorsProvider,
  useAIMarkdownBehaviors,
  useStableRecord,
  AIMarkdownStabilityPolicy,
  type AIMarkdownProps,
  type AIMarkdownBehaviorGroups,
  type AIMarkdownStabilityTable,
} from '@ai-react-markdown/core';

interface PanelOptions {
  compact: boolean;
}
const PANEL_DEFAULTS: Readonly<PanelOptions> = Object.freeze({ compact: false });

interface MyMarkdownProps extends AIMarkdownProps {
  panel?: Partial<PanelOptions>;
}

const TABLE: AIMarkdownStabilityTable<{ panel: Partial<PanelOptions> | undefined }> = {
  panel: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

export function MyMarkdown({ panel, ...rest }: MyMarkdownProps) {
  const stable = useStableRecord({ panel }, TABLE);
  // Absent prop → contribute NO group, so an outer app-level Provider's
  // `panel` group stays visible; a present prop wins via inner-wins.
  const groups = useMemo<AIMarkdownBehaviorGroups>(
    () => (stable.panel != null ? { panel: stable.panel } : NO_GROUPS),
    [stable.panel]
  );
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
  return useMemo(() => ({ compact: group?.compact ?? PANEL_DEFAULTS.compact }), [group]);
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

Factories return the same input with types and a shallow `Object.freeze`; they do not recursively freeze nested groups or resolve defaults — bare flat
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
  [core README](../packages/react/README.md#props-api-reference)) before
  adding fields; collisions are compile errors for TS consumers but
  silent overrides for plain-JS consumers.

## A practical migration sequence

1. Upgrade core and the Mantine integration together, satisfy their React and UI-library peers, and rebuild your lockfile. Do not add an independent engine version to a React application; core already installs its matching supplier.
2. Search source and wrapper packages for `defaultConfig`, `config=`, removed enum names, and both old render-state hooks. Include exported prop aliases and explicit component type arguments, not just JSX.
3. Translate the two old plugin selections into one complete `enginePlugins` array. Passing only a highlight selection also removes the other optional plugins; start from `defaultEnginePlugins` when disabling just one feature.
4. Move lifecycle, theme, and behavior reads to the corresponding narrow hooks. Preserve metadata as its own generic parameter. Keep all hooks unconditional in custom renderers.
5. Replace wrapper config snapshots with prop defaults and a typed behavior group. Verify absent groups inherit outer providers and present groups replace them atomically. Apply group defaults in one hook, with a stated policy for explicit undefined fields.
6. Check standalone and coordinated output, custom URL schemes, math, copied code, and streaming completion. Compare semantic structure and behavior; auto-generated namespaces and later correctness fixes can change literal HTML.

If compilation passes but performance changes, inspect `incrementalParse` first: the omitted-field behavior intentionally changed from a possible 1.x opt-out to the shipped 2.x default. Then check function identities for `urlTransform`, preprocessors, and slots. Factories are optional; stable module constants or correctly memoized dynamic values express the same configuration.

For a newly written wrapper, use the current [subpackage guide](./extending-via-subpackage.md) as the implementation template. This page retains the old-to-new mapping so a migration can be audited without reconstructing the removed API.
