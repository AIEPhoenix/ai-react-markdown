# Execution Plan: Props & Config API v2.0.0

- **Status**: Final. Design is closed; this document is the sole execution reference.
- **Date**: 2026-07-31
- **Release policy**: single release **v2.0.0**, hard breaking upgrade. No compatibility layer, no deprecation window. `config` / `defaultConfig` and all merge machinery are removed outright. The migration story is carried entirely by the migration guide (§6).
- **Scope**: public prop surface and context/hook layer of `@ai-react-markdown/core`; integration contract of `@ai-react-markdown/mantine`; milestone plan for a single-release train.
- **Self-containment**: this document inlines every decision, mechanism, and acceptance criterion needed to implement v2.0.0. File paths and line numbers refer to the repository as of v1.8.x and identify work targets, not required reading.

---

## 1. Motivation

Four verified defects in the v1.x configuration API, ranked by severity:

1. **Snapshot rot (a structural bug class).** A custom `defaultConfig` is a complete frozen snapshot written against whatever core version the integrator built against. Every optional field core adds later is silently absent from that snapshot. This shipped one real defect: `incrementalParseEnabled` is optional for source compatibility; absence is coerced to `false` at the engine gate while the shipped default is `true`, so any package with a hand-written complete `defaultConfig` silently opts out of incremental parsing. The ~15-line JSDoc at `packages/core/src/defs.ts:122-136` is the patch documenting the trap. The class reproduces with every future engine flag.
2. **Caller-asserted generic debt.** `useAIMarkdownRenderState<TConfig>()` is an `as` assertion that TypeScript cannot verify, maintained purely by convention (`packages/core/src/context.tsx:34-49`, ~60 lines of JSDoc, plus most of `docs/typescript-generics.md`). The only reason the generic exists is that integrators extend `TConfig` with component-preference fields (`codeBlock.*`). Retiring it is the single largest payoff of this redesign.
3. **One object, two change contracts.** `config` mixes pipeline-tier fields (changing one triggers a full re-parse and block remount) with component-preference fields (changing one costs a leaf re-render). Users cannot tell which is which from the type.
4. **Merge-semantics burden.** Deep merge, wholesale array replacement, and no-backfill are three rules living in three places (README prose, a lodash customizer comment, a field JSDoc).

## 2. Design principles

These principles were used as tie-breakers throughout the design and remain binding for future changes:

- **P1 — Group by semantic domain at the top level; annotate mechanics per field.** A prop's documentation home tells you what it is for; its field-level annotations tell you when it may change and at what cost.
- **P2 — Delta, not snapshot.** Any layer that holds defaults holds an all-optional delta over the runtime core defaults. Snapshots rot; deltas cannot.
- **P3 — Resolve once, consume resolved.** Merging, defaulting, and validation happen at a single point; React consumes the frozen result.
- **P4 — Structure-encoding names for open channels; intent-encoding names only for closed sets.** An extensible channel named for intent gets semantically broken by the first extension member that does not match the intent.
- **P5 — Categories are for humans, structure is for algorithms.** Documentation may group fields; object shapes stay flat wherever merge or destructuring algorithms operate on them.
- **P6 — A switch's home on the implementation axis is where its reading code runs; its home on the presentation axis is its semantics.** Facades translate between the two.
- **P7 — Capability construction follows the verification harness.** Anything whose correctness is certified by a test rig can only be constructed where that rig lives.

## 3. Target architecture

### 3.1 Seven-system taxonomy

The top-level organization of props, docs, and contexts. Mechanics (change contract, reference sensitivity) are per-field annotations, never group boundaries.

| System            | Members                                                                                                            | Change contract                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Document          | `documentId` (derives `documentIdExplicit`, `clobberPrefix`; owns the `AIMarkdownDocuments` cross-chunk machinery) | per message                                                                    |
| Data              | `content`, `metadata`                                                                                              | per frame / per message; absorbed by engine design                             |
| State             | `streaming`, `streamingCursor`                                                                                     | flips per stream start/end; the cursor is the state's visual companion         |
| Theme             | `fontSize`, `variant`, `colorScheme` (value tier) + `Typography`, `ExtraStyles` (carrier tier)                     | value tier runtime-switchable; carrier tier fixed at integration, module scope |
| Engine (payloads) | `contentPreprocessors`, `urlTransform`, `sanitizeSchema`, `customComponents`                                       | fixed at integration; documented in content-flow stage order                   |
| Engine plugins    | `enginePlugins` (sealed plugin array replacing the `extraSyntaxSupported` / `displayOptimizeAbilities` enums)      | fixed at integration                                                           |
| Behaviors         | `blockMemo`, `incrementalParse`, `preserveOrphanReferences` (core) + wrapper groups (e.g. mantine's `codeBlock`)   | runtime-changeable; cost tiered (§3.6)                                         |

Naming rulings (final): English `behaviors` (US spelling); "presentation" was rejected (collides with the theme system and contradicts the output-invariant members); "preferences" was rejected (intent-named open channel, P4 violation). `preserveOrphanReferences` belongs to Behaviors, with a documentation cross-reference to the Document system (its override chain runs through `AIMarkdownDocuments`).

The theme system's internal contract ("protocol + reference implementation") is unchanged from v1.x and out of scope here: the library guarantees _delivery_ of the three values (JS side: context + Typography props; CSS side: only `--aim-font-size-root` is semi-guaranteed via the mandatory style merge), while interpretation belongs to the Typography implementation. Discrete values travel as class names, continuous values as CSS variables.

### 3.2 Public prop surface: flat

**Rule: scalar values are always top-level flat props; object values remain single props; grouping bags do not exist.** There is no `engine` bag, no `behaviors` bag, no `slotProps` bag.

```tsx
<AIMarkdown
  content={content}
  streaming={!done}
  documentId={id}
  metadata={meta}
  fontSize={15}
  colorScheme="dark"
  blockMemo={false}
  incrementalParse={false}
  preserveOrphanReferences={false}
  enginePlugins={MY_PLUGINS}
  contentPreprocessors={PREPROCESSORS}
  sanitizeSchema={SCHEMA}
/>
```

Complete core prop inventory for v2.0.0 (18 props; `config` and `defaultConfig` are deleted):

| Prop                       | Type                                 | Default                           | System         | Notes                                                                                                                                           |
| -------------------------- | ------------------------------------ | --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`                  | `string`                             | —                                 | Data           | grows per frame while streaming                                                                                                                 |
| `metadata`                 | `TMetadata?`                         | `undefined`                       | Data           | own context; three-tier contract (stable container > coarse value > frame-rate value discouraged); deliberately never stabilized by the library |
| `documentId`               | `string?`                            | auto `useId()`                    | Document       | explicit value enables cross-chunk coordination                                                                                                 |
| `streaming`                | `boolean?`                           | `false`                           | State          |                                                                                                                                                 |
| `streamingCursor`          | `ComponentType?`                     | `undefined`                       | State          | mounts only while `streaming`; module scope required                                                                                            |
| `fontSize`                 | `string \| number?`                  | `'0.9375rem'`                     | Theme          | number → `px`                                                                                                                                   |
| `variant`                  | `'default' \| string`                | `'default'`                       | Theme          | interpreted by the Typography implementation                                                                                                    |
| `colorScheme`              | `'light' \| 'dark' \| string`        | `'light'`                         | Theme          | dual delivery: class name (CSS) + context (JS, e.g. mermaid)                                                                                    |
| `Typography`               | `ComponentType?`                     | built-in                          | Theme          | must merge injected `style`; module scope                                                                                                       |
| `ExtraStyles`              | `ComponentType?`                     | `undefined`                       | Theme          | module scope                                                                                                                                    |
| `contentPreprocessors`     | `Preprocessor[]?`                    | `undefined`                       | Engine         | full-content string transforms, pre-parse                                                                                                       |
| `urlTransform`             | `UrlTransform?`                      | built-in                          | Engine         | must be a stable function reference                                                                                                             |
| `sanitizeSchema`           | `SanitizeSchema?`                    | built-in                          | Engine         | atomic replacement; no library-side merging                                                                                                     |
| `customComponents`         | `Components?`                        | `undefined`                       | Engine         | render-stage node overrides                                                                                                                     |
| `enginePlugins`            | `readonly AIMarkdownEnginePlugin[]?` | `defaultEnginePlugins` (all five) | Engine plugins | sealed set; passing an array replaces wholesale                                                                                                 |
| `blockMemo`                | `boolean?`                           | `true`                            | Behaviors      | output-invariant                                                                                                                                |
| `incrementalParse`         | `boolean?`                           | `true`                            | Behaviors      | output-invariant                                                                                                                                |
| `preserveOrphanReferences` | `boolean?`                           | `true`                            | Behaviors      | affects output; see override chain §3.8                                                                                                         |

Three binding caveats:

1. "Flat" means "no bags", not "no objects". `enginePlugins`, the three payloads, `customComponents`, `metadata`, and wrapper groups (`codeBlock={...}`) have inherently object-shaped values and remain single props.
2. Flat props share one namespace across core and all wrapper layers. Core maintains a prop-name registry in its docs; wrappers must check it before adding fields. Collisions surface as compile errors at the `extends` site for TS users but are silent overrides for untyped users — the registry is a necessary governance artifact.
3. The flat choice is bound to the current scale (~20 core props; the sealed plugin set prevents field explosion). If integration-time options ever grow to hundreds of fields, re-evaluate a single-options-object, resolve-once shape.

### 3.3 `define*` factories

The packaging unit for integration-time configuration. Factory output is a frozen, fully typed, reference-stable flat fragment, spread into the component:

```tsx
const THEME = defineTheme({ fontSize: 15, variant: 'default' });
const BEHAVIORS = defineBehaviors({ blockMemo: false });
const PIPELINE = definePipeline({ contentPreprocessors: [...], sanitizeSchema: mySchema });

// runtime-varying fields go AFTER the spreads; later props win
<AIMarkdown
  content={content} streaming={s}
  {...THEME} {...BEHAVIORS} {...PIPELINE}
  colorScheme={userScheme}
/>
```

Three disciplines:

1. `define*` is identity + types + `Object.freeze`, zero logic. No default-filling (defaults live only in the component's destructuring), no merging, no side effects. The `define` naming (vs `create`) signals "declares data" vs "manufactures a live object".
2. Factories package **values decided at integration time**, not "all fields of a system". Data, State, and Document members change per frame/message and get no factory. Runtime-switchable fields (theme values, behavior groups) may enter a factory as initial values; runtime overrides use post-spread props (see `colorScheme` above).
3. Factories are sugar, not gates. Passing bare flat props is always legal.

Core factories accept core prop types only. Wrappers re-export widened factories for their extension fields (e.g. `defineMantineBehaviors` — still identity + own types + freeze, one line); see §4 item 8.

### 3.4 Context and hook layer

Props are the input surface; contexts are the output surface. A single-point resolver consumes the flat props and produces the payloads of five contexts:

| Context   | Payload                                                      | Narrow hook                  |
| --------- | ------------------------------------------------------------ | ---------------------------- |
| document  | `documentId`, `documentIdExplicit`, `clobberPrefix`          | `useAIMarkdownDocument()`    |
| metadata  | metadata (generic kept: `useAIMarkdownMetadata<T>()`)        | `useAIMarkdownMetadata<T>()` |
| state     | `streaming` + extension state groups (via additive Provider) | `useAIMarkdownState()`       |
| theme     | `fontSize`, `variant`, `colorScheme`                         | `useAIMarkdownTheme()`       |
| behaviors | core three switches + wrapper groups (via additive Provider) | `useAIMarkdownBehaviors()`   |

Aggregate hook: `const { document, metadata, state, theme, behaviors } = useAIMarkdown()`.

Binding conventions:

- All narrow hooks carry the `AIMarkdown` prefix. Bare short names (`state`, `theme`) exist only in the aggregate destructure — no collision with `React.useState`.
- The aggregate hook subscribes to all five contexts and re-renders on any change. Its JSDoc must state the price: performance-sensitive components use narrow hooks; the aggregate serves teaching and low-frequency components.
- The direct payoff of the split: `streaming` is the most frequently flipping field in the library. Under v1.x's single render-state context, every flip re-rendered every consumer; after the split it only wakes `useAIMarkdownState()` subscribers.
- `useAIMarkdownBehaviors()` is non-generic and returns the core shape plus an opaque extension record. Type assertions occur exactly once, inside wrapper narrow hooks (e.g. `useMantineCodeBlockOptions()`). This retires the public caller-asserted generic; the residual assertion is a wrapper implementation detail.
- Payloads and plugins do **not** enter any _public_ context (an internal cross-chunk context carries the url/sanitize policy; it is not public API). Their only reader is the core pipeline; resolved values flow to `MarkdownContent` as internal props, read field-by-field by name. Never enumerate keys of, or place whole resolved objects into, any cache identity or deps key.

**Extension-group transport: additive (stackable) Providers.** Core exports named Providers; a wrapper or an application stacks its groups (firewall output used directly as the value) _outside_ `<AIMarkdown>`; core's innermost provider reads the outer same-named context and provides `{ ...outer, ...coreResolved }` downward. Consumers see exactly one context. Multi-level wrappers stack naturally; for a duplicated group key the inner layer wins (the exported Provider itself also merges its own outer context). Three locks prevent outer layers from touching core keys — otherwise hook reads would diverge from actual behavior:

1. Type level: the Provider `value` is typed `{ [group: string]: object } & { <coreKey>?: never }`.
2. Runtime: core keys are unconditionally overwritten by the prop-resolved values (guaranteed by spread order).
3. Dev: a warning fires when an outer value carries a core key.

Implementation note: the innermost merge `{ ...outer, ...coreResolved }` must be memoized on `[outer, coreResolved]`, otherwise the context value gets a fresh identity every render.

Known cost: within one context, group invalidation is not isolated — one group change leaf-re-renders all subscribers of that context. Acceptable at current scale; a party needing isolation may run a private context as an escape hatch (both approaches are legal simultaneously).

Additive stacking is ruled per context, not opened globally:

| Context   | Stackable?                          | Rationale                                                                                                                                                                                                                                                                           |
| --------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| behaviors | Open: `AIMarkdownBehaviorsProvider` | wrapper component parameters (`codeBlock`, …); core-key lock = the three behavior switches                                                                                                                                                                                          |
| state     | Open: `AIMarkdownStateProvider`     | extension lifecycle states (aborted, reasoning, tool-call-in-progress, …); core-key lock = `streaming`. **Frequency contract**: group members must be message-lifecycle frequency; frame-rate data (per-token progress etc.) still goes through metadata's stable-container pattern |
| theme     | Reserved                            | the mechanism copies verbatim, but no real demand exists today; enable on first demand, never speculatively                                                                                                                                                                         |
| document  | Closed                              | payload is entirely derived invariants; a forgeable `clobberPrefix` breaks the anchor system                                                                                                                                                                                        |
| metadata  | Not needed                          | the payload is already external data; wrappers merge at the prop layer — no transport gap exists                                                                                                                                                                                    |

The two named Providers share one internal additive factory (merge + key lock + dev warn implemented once). The factory itself is not exported.

### 3.5 Sealed engine plugin system

The two v1.x enums were second-hand descriptions of entries in the unified plugin chain. They become first-class, core-exported, nominally sealed plugin objects:

```ts
import { highlight, definitionList, smartypants, pangu, removeComments,
         defaultEnginePlugins } from '@ai-react-markdown/core/plugins';

<AIMarkdown enginePlugins={[highlight, definitionList, pangu]} />
// absent  → defaultEnginePlugins (all five; parity with v1.x defaults)
// present → wholesale replacement (array-atomic semantics)
```

The five plugins and their v1.x equivalents: `highlight` (== `HIGHLIGHT`), `definitionList` (== `DEFINITION_LIST`), `smartypants`, `pangu`, `removeComments` (== the three `displayOptimize` abilities).

- **Seal**: a `unique symbol` brand; third parties cannot construct the type. The seal is a type-level contract and design declaration, not runtime tamper-proofing — bypassing it voids the engine's verification record, the same guarantee class as `Object.freeze`.
- **Why sealed is mandatory**: the prefix-freeze boundary scanner is syntax-aware (see the `defListEnabled` option of `computeFreezeBoundary`) — it must know the boundary rules of every multiline construct. Open plugin injection voids the incremental engine's entire verification record (50k-sample fuzz, direction batteries, byte equivalence). Principle P7 restated: plugins are born where the certification rig lives (`packages/core`).
- **Rights split**: core constructs + certifies + exports; wrappers **curate** (bundle default sets, filter, facade sugar); consumers select. External packages contribute parse-level capability via upstream PR — an accepted tradeoff priced by incremental-engine correctness, stated plainly in docs.
- **Accepted losses**: plugin objects are not serializable (`plugin.name` is the escape hatch for remote-config scenarios); the prop is named `enginePlugins` and its JSDoc opens with "accepts core-exported sealed plugins only; third-party content extension = `contentPreprocessors` + `customComponents`".
- **Order and duplicates**: each plugin's position in the produced chain is determined by its internal stage metadata, never by the user array's order — required for the byte-equivalence guarantees to be checkable. Duplicate members are deduplicated by identity with a dev warning.
- A plugin that later needs parameters upgrades to factory form (`pangu({...})`); factory results must live at module scope (same discipline as payloads).

### 3.6 Behaviors system: intra-system contract

Core fields and wrapper groups share one semantic system; their differences are carried by field-level annotations:

- Core `blockMemo` / `incrementalParse`: engine execution strategies, **output-invariant** — flipping them changes no rendered byte (backed by the byte-equivalence and splice-equivalence suites). Mid-stream flipping is legal at the cost of one full-rebuild frame. Any future field entering this partition must ship a byte-equivalence test.
- `preserveOrphanReferences`: the engine's policy for incomplete/streaming documents; changes output; override chain in §3.8.
- Wrapper groups (`codeBlock`, …): component behavior parameters; runtime-switchable; cost = leaf re-render. Group values replace atomically; group defaults are applied inside the wrapper's narrow hook (`{ ...defaults, ...group }`); bare `??` at read sites is forbidden (multiple read sites each duplicating defaults will drift).
- Wrapper perf-flavored switches (hypothetical `mermaid.lazyRender`) do not structurally inherit core's byte-equivalence rule; the wrapper self-certifies an equivalence contract in its own docs.

### 3.7 Resolution and precedence

v2.0.0 has no compatibility layer; precedence has exactly two levels:

> An explicitly passed prop overrides the shipped default; an absent prop falls to the shipped default. "Explicit" is defined library-wide as `v != null` — explicitly passing `null` counts as absent, guarding against serialization boundaries (RSC, persistence) materializing "not passed" as `null` and punching through defaults.

Historical note (for the record): the coexistence-era designs "whole-group takeover" and "per-prop fallback to legacy" were both retired — the former lost its premise when bags were dissolved, the latter when the compatibility layer was cut. The v1.x semantics "`incrementalParseEnabled` absent = off" is **not** preserved; absence now falls to the shipped default (`true`). Users relying on the old semantics must write `incrementalParse={false}` explicitly (migration guide, §6).

Resolution happens exactly once, in `<AIMarkdown>`, producing system-organized resolved values. Both the internal pipeline props and the context payloads derive from this single resolution — there is no second resolution point anywhere.

### 3.8 Override chain and cross-chunk contract

- `preserveOrphanReferences` override chain: `AIMarkdownDocuments` prop (component-level default `true`; omission ≡ explicit `true`; unconditionally wins for all chunks under it) > flat prop > shipped default.
- Cross-chunk invariants, two tiers: divergence of `preserveOrphanReferences` across chunks sharing a `documentId` is caught indirectly by the existing G0 deps-key gate (it propagates through `handlers` / `preserveForBodyHarvest`, clearing incremental state and falling back to full parse). Divergence of `blockMemo` / `incrementalParse` is not enforced by code — chunks share the registry but take different render paths; documented as "supported but discouraged". No new fingerprint mechanism.
- The existing footgun "the legacy renderer (`blockMemo: false`) does not participate in cross-chunk coordination" migrates into the v2 docs verbatim.
- `useAIMarkdownRenderState` is **deleted** in v2.0.0, no shim. All consumers migrate to the five narrow hooks; the migration guide provides a field-by-field replacement table (§6).

### 3.9 Stability firewall

Reference stabilization of object-valued props is consolidated from scattered per-prop `useStableValue` calls into a **single boundary, table-driven** mechanism:

```ts
/** Stabilization policy tiers. Publicly exported; wrappers reuse it for their own tables. */
export enum AIMarkdownStabilityPolicy {
  /**
   * Deep-equal backstop: when the reference changed, deep-compare; if contents
   * are deep-equal, reuse the previous reference. For structurally comparable
   * data values. In dev, high-frequency "deep-equal restores" warn (the caller
   * is inlining objects — caught, but paying one comparison per frame).
   */
  DEEP_EQUAL = 'DEEP_EQUAL',
  /**
   * No comparison; dev-mode flip-rate probe only. For function values —
   * deep-comparing closures is meaningless; the contract requires the caller
   * to hold a stable reference.
   */
  WARN_ONLY = 'WARN_ONLY',
  /**
   * Explicit pass-through: no comparison, no probe. For deliberately exempted
   * props (e.g. metadata: opaque shape, potentially huge, unbounded comparison
   * cost — stabilization is the consumer's responsibility). Distinct from "not
   * in the table": exemption is a decision, a missing row is an omission.
   */
  PASS_THROUGH = 'PASS_THROUGH',
}

const STABILITY_TABLE: StabilityTable<CoreObjectProps> = {
  enginePlugins: AIMarkdownStabilityPolicy.DEEP_EQUAL, // elements are module singletons; per-element === short-circuits
  sanitizeSchema: AIMarkdownStabilityPolicy.DEEP_EQUAL,
  customComponents: AIMarkdownStabilityPolicy.DEEP_EQUAL,
  contentPreprocessors: AIMarkdownStabilityPolicy.WARN_ONLY, // function array
  urlTransform: AIMarkdownStabilityPolicy.WARN_ONLY,
  Typography: AIMarkdownStabilityPolicy.WARN_ONLY, // component values: carrier-tier enforcement unified here
  ExtraStyles: AIMarkdownStabilityPolicy.WARN_ONLY, // (previously zero enforcement)
  streamingCursor: AIMarkdownStabilityPolicy.WARN_ONLY,
  metadata: AIMarkdownStabilityPolicy.PASS_THROUGH, // codifies the existing deliberate exemption
};
```

- `useStableRecord(record, table)`: a single hook; the loop lives inside it (static hook count, rules-compliant). The previous-value ref advances in a post-commit layout effect, identical to the existing `useStableValue` concurrent-safety discipline (discarded renders never pollute the cache). When no key changed, the output object itself keeps its identity — it is directly usable as a context value.
- Layering rule: below the firewall, internal code never stabilizes again; reference equality is trusted outright.
- **The table is the complete roster of object-valued props.** `StabilityTable` is `Required<Record<keyof CoreObjectProps, AIMarkdownStabilityPolicy>>`; adding an object prop without registering it is a compile error. Exemption (`PASS_THROUGH`) and omission (missing row) are thereby distinguishable.
- **The firewall follows the terminus, not the layer.** Each prop is stabilized exactly once, at the layer that consumes it. Wrappers build tables only for props they terminate (mantine today: one row, `codeBlock`); forwarded props ride core's firewall untouched; derived values (e.g. merged `customComponents`) are caught by core's wall. Core exports `useStableRecord` for wrapper reuse.

## 4. Integrator (wrapper) contract

1. Own fields: default via destructuring parameters, strip via rest destructuring, forward `{...rest}`. The rest object's identity needs no stabilization — JSX spread flattens to individual props and React compares them individually.
2. Object props terminated in your own machinery go into your own `useStableRecord` table; forwarded ones are never touched.
3. Extension groups travel via additive Providers: component behavior parameters through `AIMarkdownBehaviorsProvider`, extension lifecycle states through `AIMarkdownStateProvider` (values are firewall output used directly; state groups obey the message-lifecycle frequency contract). Group defaults are applied inside your narrow hook; the type assertion appears exactly once, inside that hook.
4. Slot implementations (Typography, customComponents) default via `??` or destructuring.
5. Payload policy, declared per payload: payloads your own features depend on are injected unconditionally and written into your contract (for `contentPreprocessors`, fix and document the injection position — prepend or append; order is semantics). Everything else: the user's value wins wholesale, and you export your raw materials for manual composition. Mantine footgun to document: wholesale-replacing `sanitizeSchema` without re-including mantine's schema material silently disables the dependent features.
6. `enginePlugins`: curation rights only — bundle default sets, filter, facade sugar. New parse-level capability goes through an upstream PR to core.
7. Perf-flavored wrapper switches self-certify their equivalence contract (§3.6).
8. Re-export widened `define*` factories (e.g. `defineMantineBehaviors`): identity + your prop types + freeze. Core factories accept core fields only; passing extension fields to them is a TS error — the widened factory is the wrapper's one-line obligation.

## 5. Implementation milestones

One release; core and mantine ship together (monorepo lockstep). Ordering follows **expand → migrate → contract**: new machinery is built first while legacy paths stay alive as train-internal scaffolding, consumers migrate next, and all deletions happen last in a single contraction sweep. Every milestone must leave the full suite green; no milestone state is ever published on its own.

**Train-internal scaffolding (never published).** During M1–M3 the legacy `config` / `defaultConfig` path remains fully functional. Scaffold precedence, one sentence: _a non-null flat prop wins for its field; otherwise the field resolves through the legacy merge chain._ This scaffold exists only inside the release train — it is deleted in M4 and never appears in any published version, so it does not contradict §8's rejection of coexistence machinery (which concerns the released API).

### 5.1 M1 — Expand: core input surface

**Tasks:**

- Flat behavior props (`blockMemo`, `incrementalParse`, `preserveOrphanReferences`).
- Sealed plugin system: five plugin objects + `defaultEnginePlugins` + brand type; new subpath export `@ai-react-markdown/core/plugins` (mind the existing types-first `exports` map convention).
- Three `define*` factories (`defineTheme`, `defineBehaviors`, `definePipeline`).
- Single-point resolver: explicit prop (`v != null`) over scaffold over shipped default; emits system-organized resolved values.
- **Legacy bridge inside the resolver**: `enginePlugins` is reverse-mapped to the two legacy enum arrays and fed to the existing `buildCoreRemarkPlugins` unchanged — the five↔five mapping is lossless. The `pluginChain.ts` signature refactor is deferred to M4 and accepted there by produced-chain byte equivalence.
- `useStableRecord` firewall: `AIMarkdownStabilityPolicy` enum (three tiers) + `Required` roster table.
- **Nothing is deleted in this milestone.**

**Acceptance:** resolver unit tests (absence → scaffold → shipped default; explicit flat prop wins; `null` punch-through guard); full suite green with zero behavior change.

**Primary files:** `packages/core/src/defs.ts` (additive), `packages/core/src/index.tsx`, new `packages/core/src/plugins/`, new `packages/core/src/hooks/useStableRecord.ts`, `packages/core/package.json` (exports map).

### 5.2 M2 — Expand: core output surface

**Tasks:**

- Five contexts + five narrow hooks + aggregate `useAIMarkdown()`.
- Additive `AIMarkdownBehaviorsProvider` and `AIMarkdownStateProvider` (one shared internal additive factory: merge memoized on `[outer, coreResolved]`, core-key triple lock, dev warn; behaviors locks the three switches, state locks `streaming`).
- The legacy render-state context **coexists**; both layers are fed from the single resolution.
- **Nothing is deleted in this milestone.**

**Acceptance:** narrow-hook payloads correct field-by-field (including frozen-ness); legacy and new layers agree on every shared field; full suite green. (The "streaming flip wakes only state subscribers" assertion belongs to M4 — it cannot hold while the legacy context still has subscribers.)

**Primary files:** `packages/core/src/context.tsx` (additive), `packages/core/src/index.tsx`.

### 5.3 M3 — Migrate: all consumers

Complete read-site inventory to migrate (verified against v1.8.x source):

| File                              | Sites                                                                     | Destination                                             |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| core `MarkdownContent.tsx`        | ~8 `config.*` gate reads; G3 dep sources; depsKey sources                 | resolved values via internal props                      |
| core `crossChunkPlaceholders.tsx` | `:60` / `:138` / `:200` — documentId / documentIdExplicit / clobberPrefix | `useAIMarkdownDocument()`                               |
| mantine `PreCode.tsx`             | `:57` autoDetect; `:89` / `:106` defaultExpanded                          | `useMantineCodeBlockOptions()`                          |
| mantine `PreCode.tsx`             | `:84` / `:95` fontSize (+ memo dep `:115`)                                | `useAIMarkdownTheme()`                                  |
| mantine `MermaidCode/index.tsx`   | `:146` colorScheme; `:147` streaming                                      | `useAIMarkdownTheme()` / `useAIMarkdownState()`         |
| mantine `MermaidCode/index.tsx`   | `:301` fontSize; `:310` codeBlock.defaultExpanded                         | `useAIMarkdownTheme()` / `useMantineCodeBlockOptions()` |
| tests + stories                   | render-state reads and config fixtures                                    | narrow hooks / new props                                |

**Additional tasks:**

- New mantine `codeBlock` prop (registered in mantine's firewall table, `DEEP_EQUAL`); contributed via `AIMarkdownBehaviorsProvider`; `useMantineCodeBlockOptions()` applies defaults inside the hook (the single assertion site).
- Re-export widened factory `defineMantineBehaviors`.
- Storybook controls migration under the repo's three CSF meta hard constraints (literal `title`/`tags`; explicit `: CoreMeta` annotation, otherwise TS2742; autodocs toggled per meta).
- G3/depsKey concrete guidance: the chain arrays (`remarkPlugins`, `rehypePlugins`, `remarkRehypeOptions`) keep holding built-chain identities inside G3's 12 deps and the depsKey six-tuple; the memos that build them switch their deps to the `enginePlugins` identity; no system-bag object ever enters any deps array or cache identity (§3.4 rule).
- Facade switches (`mermaid` etc.) are net-new behavior with no baseline and are **not** bundled into this release.

**Acceptance:** full suite green; mantine tests + Storybook green; against fixed 1.8.x-derived fixtures, identical inputs with `defaultExpanded: false` through the new chain render byte-identical output.

**Primary files:** `packages/core/src/components/MarkdownContent.tsx`, `packages/core/src/components/crossChunkPlaceholders.tsx`, `packages/mantine/src/MantineAIMarkdown.tsx`, `packages/mantine/src/components/customized/PreCode.tsx`, `packages/mantine/src/components/customized/MermaidCode/`, `packages/mantine/src/hooks/`, `packages/mantine/stories/`, tests.

### 5.4 M4 — Contract: deletion sweep + release gate

**Delete in one sweep:** `config` / `defaultConfig` props; the lodash `mergeWith` merger and its array customizer; the `PartialDeep` export; `AIMarkdownRenderConfig`; the two enums `AIMarkdownRenderExtraSyntax` / `AIMarkdownRenderDisplayOptimizeAbility` — refactoring `buildCoreRemarkPlugins` to consume plugin objects directly, accepted by **produced-chain byte equivalence against the bridge path**; the legacy render-state context and `useAIMarkdownRenderState`; mantine's `useMantineAIMarkdownRenderState`, `MantineAIMarkdownRenderConfig`, `defaultMantineAIMarkdownRenderConfig`, and the `defaultConfig` pass-through; the M1 precedence scaffold.

**The red line (semantic, not literal):** the produced plugin chain (membership + order) stays byte-equivalent; freeze-boundary computation, splice, and block-cache identity logic undergo **zero semantic change**. Mechanical signature and naming changes are allowed; test assertions change only by mechanical renames. The three in-repo invariant checklists are walked item-by-item on any PR in this milestone: the block-memo invariant list, the G3 12-dep commentary, and the "depsKey coverage ≥ G3" relation (incremental-parse invariant sets v1/v2/v3 live under `packages/core/src/components/incrementalParse/` and `src/experiments/prefixFreeze/`).

**Acceptance:** the "streaming flip re-renders only state subscribers" behavioral test (moved here from M2); full suite green on the final state; **release gate: a full soak re-run** (50k-sample fuzz + direction batteries + exhaustive K=4 census; scripts exist; overnight under `caffeinate`).

**Primary files:** `packages/core/src/defs.ts`, `packages/core/src/context.tsx`, `packages/core/src/index.tsx`, `packages/core/src/components/pluginChain.ts`, `packages/mantine/src/defs.tsx`, `packages/mantine/src/MantineAIMarkdown.tsx`, `packages/mantine/src/hooks/`, incremental-parse test harness files that construct enum-based configs (`testPluginCatalog.ts`, `spliceExhaustive.test.ts` — mechanical renames only).

### 5.5 M5 — Docs and migration guide

**Tasks:** rewrite the parameter tables of all three READMEs; update affected `docs/` pages (`typescript-generics.md` shrinks drastically; `extending-via-subpackage.md` rewritten around "behavior-system group keys + additive Provider contribution", answering existing third-level-extension users head-on; `streaming-and-performance.md` reference updates); author the 1.x → 2.0 migration guide with the mandatory entries of §6.

**Acceptance:** every mapping in the migration guide ships with runnable before/after code; a 1.8.x sample project is migrated by hand following only the guide, as the smoke test.

## 6. Migration guide: mandatory content (§7 of the shipped docs)

- **Field mapping table**, exhaustive one-to-one:

| v1.x                                                         | v2.0.0                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `config.blockMemoEnabled` / `defaultConfig.blockMemoEnabled` | `blockMemo` prop                                                          |
| `config.incrementalParseEnabled`                             | `incrementalParse` prop                                                   |
| `config.preserveOrphanReferences`                            | `preserveOrphanReferences` prop                                           |
| `config.extraSyntaxSupported`                                | `enginePlugins` (plugin objects `highlight`, `definitionList`)            |
| `config.displayOptimizeAbilities`                            | `enginePlugins` (plugin objects `removeComments`, `smartypants`, `pangu`) |
| `config.codeBlock.*` (mantine)                               | `codeBlock` prop on `MantineAIMarkdown`                                   |
| `defaultConfig` (integrator channel)                         | wrapper destructuring defaults + widened `define*` factories              |

- **Absence-semantics flip**: v1.x treated an omitted `incrementalParseEnabled` in a custom `defaultConfig` as **off**; v2.0.0 treats absence as the shipped default (**on**). Write `incrementalParse={false}` explicitly to keep the old behavior.
- **Enums → plugins**: recommended "turn one off" idiom `enginePlugins={defaultEnginePlugins.filter(p => p !== pangu)}`; call out that one prop now covers both former enum fields.
- **Hook replacement table** (`useAIMarkdownRenderState` is deleted; field-by-field destinations): `.config.*` → `useAIMarkdownBehaviors()`; `.streaming` → `useAIMarkdownState()`; `.fontSize` / `.variant` / `.colorScheme` → `useAIMarkdownTheme()`; `.documentId` / `.clobberPrefix` / `.documentIdExplicit` → `useAIMarkdownDocument()`; `useMantineAIMarkdownRenderState` → narrow-hook combination + `useMantineCodeBlockOptions()`.
- `AIMarkdownDocuments`: omitting `preserveOrphanReferences` has always equaled an explicit `true`; unchanged in v2, stated for clarity.
- The former third-level extension pattern (custom `defaultConfig` through a wrapper) rewritten as: behavior group keys + additive Provider + widened factories.
- **Generic-signature mapping** for TS users passing explicit type arguments: `AIMarkdownProps<TConfig, TMetadata>` → `AIMarkdownProps<TMetadata>` (positional change — explicit `<MyConfig, MyMeta>` arguments now fail to compile); the `PartialDeep` type export is removed with no replacement.

## 7. Timeline and risks

Calendar plan: **2.5–3 weeks** (~7–9 focused days). Time saved by deleting the compatibility machinery partially backfills the internal-representation reshape and the pre-release soak night.

Risks, ranked:

1. **The M3→M4 pair (read-site plumbing migration, then deletion of the legacy representation) is the highest-risk stretch.** Three buffers: the semantic red line (produced chain byte-equivalent, engine semantics zero-change); the three invariant checklists signed item-by-item; the full pre-release soak gate on the final state.
2. **M2/M3 touch every internal consumer.** The train-internal scaffold keeps each milestone green; regression rests on field-by-field narrow-hook comparison tests plus legacy/new layer agreement checks while both are alive.
3. **No coexistence window in the release means the upgrade is a cliff.** The migration guide is the only cushion; its quality is enforced by M5's acceptance (runnable before/after for every mapping + hand-migrated sample project). Keep a 1.8.x maintenance branch for security fixes.
4. **Flat-namespace collision governance is doc-based (weak) enforcement.** TS users get compile-time backstops at `extends` sites; plain-JS users do not.

## 8. Explicitly rejected alternatives (do-not-build list)

- `createAIMarkdown` mega-factory: its value is fully covered by the facade pattern + `define*` factories.
- Open plugin injection: voids the engine verification record; permanently closed. The admission path is an upstream PR into core, certified by the rig.
- Core-level component-parameter machinery (a `slotProps` prop; a `createComponentOptionsContext` helper): superseded by behavior-system group keys + additive Providers + firewall reuse.
- Whole-group takeover precedence: retired with the bags that motivated it.
- The names "preferences" (intent-named open channel — broken by the first non-preference extension member) and "presentation" (collides with the theme system; contradicts the output-invariant members).
- The entire deprecated-coexistence machine: compat snapshot of `renderState.config`, dev getter warnings, resolver-vs-legacy equivalence property tests, dual-path precedence — all retired by the hard-break decision.
- Keeping `AIMarkdownRenderConfig` as an internal representation: internals reshape with the systems; the price is one full soak re-run before release.

## Appendix A — Public API sketch (v2.0.0)

```ts
// ── @ai-react-markdown/core ──────────────────────────────────────────
export interface AIMarkdownProps<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata> {
  // Data
  content: string;
  metadata?: TMetadata;
  // Document
  documentId?: string;
  // State
  streaming?: boolean;                       // default false
  streamingCursor?: ComponentType;           // module scope
  // Theme
  fontSize?: string | number;                // default '0.9375rem'
  variant?: 'default' | (string & {});       // default 'default'
  colorScheme?: 'light' | 'dark' | (string & {}); // default 'light'
  Typography?: AIMarkdownTypographyComponent;     // must merge injected style
  ExtraStyles?: AIMarkdownExtraStylesComponent;
  // Engine payloads
  contentPreprocessors?: AIMDContentPreprocessor[];
  urlTransform?: UrlTransform;               // stable reference required
  sanitizeSchema?: SanitizeSchema;
  customComponents?: AIMarkdownCustomComponents;
  // Engine plugins (sealed)
  enginePlugins?: readonly AIMarkdownEnginePlugin[]; // default: defaultEnginePlugins
  // Behaviors
  blockMemo?: boolean;                       // default true; output-invariant
  incrementalParse?: boolean;                // default true; output-invariant
  preserveOrphanReferences?: boolean;        // default true
}

// Sealed plugin type — constructible only inside core.
declare const enginePluginBrand: unique symbol;
export interface AIMarkdownEnginePlugin {
  readonly name: string;                     // serialization escape hatch
  readonly [enginePluginBrand]: true;
  /* internal: stage metadata, chain entries, incremental-safety certification */
}

// Factories: identity + types + freeze, zero logic.
// (ThemeProps / BehaviorProps / PipelineProps are Pick<> subsets of AIMarkdownProps — sketch names.)
export function defineTheme(v: ThemeProps): Readonly<ThemeProps>;
export function defineBehaviors(v: BehaviorProps): Readonly<BehaviorProps>;
export function definePipeline(v: PipelineProps): Readonly<PipelineProps>;

// Firewall. (String enum — values match §3.9.)
export enum AIMarkdownStabilityPolicy { DEEP_EQUAL = 'DEEP_EQUAL', WARN_ONLY = 'WARN_ONLY', PASS_THROUGH = 'PASS_THROUGH' }
export function useStableRecord<T extends object>(
  record: T, table: Required<Record<keyof T, AIMarkdownStabilityPolicy>>): T;

// Additive Providers (extension-group transport).
export const AIMarkdownBehaviorsProvider: FC<{ value: BehaviorGroups; children: ReactNode }>;
export const AIMarkdownStateProvider: FC<{ value: StateGroups; children: ReactNode }>;
// BehaviorGroups = { [group: string]: object } & { blockMemo?: never; incrementalParse?: never; preserveOrphanReferences?: never }
// StateGroups    = { [group: string]: object } & { streaming?: never }

// Hooks.
export function useAIMarkdownDocument(): { documentId: string; documentIdExplicit: boolean; clobberPrefix: string };
export function useAIMarkdownMetadata<T extends AIMarkdownMetadata = AIMarkdownMetadata>(): T | undefined;
export function useAIMarkdownState(): { streaming: boolean } & Record<string, object | undefined>;   // | undefined: a mistyped group key must not type as present
export function useAIMarkdownTheme(): { fontSize: string; variant: string; colorScheme: string };
export function useAIMarkdownBehaviors(): { blockMemo: boolean; incrementalParse: boolean; preserveOrphanReferences: boolean } & Record<string, object | undefined>;
export function useAIMarkdown(): { document: ...; metadata: ...; state: ...; theme: ...; behaviors: ... };

// ── @ai-react-markdown/core/plugins ─────────────────────────────────
export const highlight: AIMarkdownEnginePlugin;
export const definitionList: AIMarkdownEnginePlugin;
export const smartypants: AIMarkdownEnginePlugin;
export const pangu: AIMarkdownEnginePlugin;
export const removeComments: AIMarkdownEnginePlugin;
export const defaultEnginePlugins: readonly AIMarkdownEnginePlugin[];

// ── @ai-react-markdown/mantine ──────────────────────────────────────
export interface MantineCodeBlockOptions { defaultExpanded: boolean; autoDetectUnknownLanguage: boolean }
// MantineAIMarkdown adds: codeBlock?: Partial<MantineCodeBlockOptions>
export function useMantineCodeBlockOptions(): Required<MantineCodeBlockOptions>;
export function defineMantineBehaviors(v: MantineBehaviorProps): Readonly<MantineBehaviorProps>;
```
