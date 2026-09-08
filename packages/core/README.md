# @ai-markdown/core

Framework-independent orchestration for ai-markdown adapters, published on the **3.0.0-beta.1** train. It supplies pipeline sessions, block planning, cross-chunk contributions, aggregate footnote trees and streaming coordination. React applications install `@ai-markdown/react@beta`; adapter authors can install `@ai-markdown/core@beta` and `@ai-markdown/engine@beta` directly.

This package was the private runtime in the legacy v2.14.1 release. It is now a real external dependency of the React adapter, with an explicit public export list. The old `@ai-react-markdown/core` React package maps to `@ai-markdown/react`, not this package. See the [migration guide](../../docs/framework-transition.md). Beta contracts may change before stable 3.0.0; keep the shared packages at the same exact train version.

## Responsibility and dependency direction

```text
engine ← core ← React adapter ← Mantine integration
   ↑___________________|
```

The adapter may also consume engine primitives directly. Shared core does not duplicate the engine's public barrel or wrap every engine function merely to rename it. It owns reusable orchestration that would otherwise have to be copied into another framework adapter.

| Module                       | Responsibility                                                                                                                                             | State owner                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `coordinationPreparation.ts` | Derive phantom targets, select coordinated/orphan handlers and harvesting policy, build contribution invalidation tuples                                   | Pure decisions; previous snapshots belong to the caller |
| `pipelineSession.ts`         | Merge coordinated parse options, append protected phantom suffixes, select full/incremental parsing, invalidate failed state and fall back to a full parse | One session per rendered chunk                          |
| `blockPlan.ts`               | Associate transformed HAST with source MDAST, produce stable keys, classify reference dependencies and swallowed HTML, compute registry fingerprints       | Pure functions over the supplied trees and registry     |
| `blockPlanner.ts`            | Reuse eligible retained prefix plans while preserving whole-document reference context                                                                     | One planner per rendered chunk                          |
| `contribution.ts`            | Compare source and policy fingerprints, harvest transformed definition bodies, publish changed committed contributions                                     | One publisher per mounted chunk                         |
| `aggregateFootnotes.ts`      | Assemble a document's ordered footnotes and occurrence backrefs as HAST                                                                                    | Returned tree belongs to the caller                     |
| `cloneHastForRender.ts`      | Clone node/children/properties containers before render-time mutation                                                                                      | Returned clone belongs to the caller                    |
| `smoothCoordinator.ts`       | Order chunk reveal, maintain sticky completion, defer cleanup and coalesce notifications                                                                   | One coordinator per logical document                    |
| `tailSignal.ts`              | Classify a source tail that renders inside a footnote or as an invisible link definition                                                                   | Pure function over MDAST                                |

The engine remains responsible for grammar, preprocessing, plugin chains, scanners, incremental parsing algorithms, registry storage/indexing, reference resolution and URL policy primitives. Shared core uses those algorithms to implement reusable rendering decisions.

React retains component construction, `ReactNode` caching, contexts, effects, `useSyncExternalStore`, registration lifetimes, provenance credential allocation, final element conversion and DOM cursor measurement. Shared core's root has no React, Vue, Svelte or DOM dependency. Its production source is typechecked without the DOM libraries. Node types supply declarations for cross-host primitives such as `queueMicrotask`; they do not add a Node runtime dependency.

## A pipeline session is local to one consumer

Create a session once for one logical rendered chunk. Pass preprocessed accumulated content, stable plugin arrays and the current coordination facts to `parse`. The result contains MDAST and HAST; it contains no framework nodes.

```ts
import { createBlockPlanner, createPipelineSession } from '@ai-markdown/core';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  sanitizeSchema,
} from '@ai-markdown/engine';

const pipeline = createPipelineSession();
const planBlocks = createBlockPlanner();
const remarkPlugins = buildCoreRemarkPlugins([]);
const rehypePlugins = buildCoreRehypePlugins(sanitizeSchema, 'example-');
const remarkRehypeOptions = buildCoreRemarkRehypeOptions(false);
const targetPhantoms = { missingFootnotes: new Set<string>(), missingLinks: new Set<string>() };
const content = 'A **framework-neutral** frame.';

const trees = pipeline.parse({
  content,
  targetPhantoms,
  remarkPlugins,
  rehypePlugins,
  remarkRehypeOptions,
  preserveForBodyHarvest: false,
  documentId: 'example',
  provenance: 'standalone-example',
  incrementalParse: false,
  defListEnabled: false,
});
const blocks = planBlocks(trees.mdast, trees.hast, content);
// Convert blocks.plan using the host renderer; use item.key for sibling identity.
```

This is an standalone example using the public package entries. A coordinated adapter must obtain a per-instance provenance credential, pass the same credential to the engine's verifier and coordinated handlers, derive actual phantom targets, and preserve definition bodies while registered. A constant credential from an example is not suitable for that path.

The host chooses `incrementalParse: false` for a one-shot server render. Shared core does not inspect `window` to infer the host. A later incremental frame starts from fresh state after a non-incremental frame. Call `reset()` when the host invalidates retained parse state because render policy changed. Parse-input identities are also checked by the engine's dependency key; phantom suffix changes remain always-tail input rather than invalidating all retained source.

An incremental failure clears the retained state before retrying the full pipeline. A failed full parse still propagates its exception to the host. The fallback is not a substitute for an error boundary, and the shared core does not silently return a stale frame. Each session and planner is mutable local computation state: do not share one across independent chunks or concurrently executing consumers.

## Shared preparation decisions

`coordinationPreparation.ts` contains the rules used by both the React adapter and the [private Vue lifecycle prototype](../../prototypes/vue/README.md):

- `derivePhantomTargets({ content, ownLabels, labels }, previous?)` excludes locally owned definitions, then matches normalized source against external labels. Footnote and link namespaces remain separate. If no candidate exists, it skips source normalization; if the result sets match `previous`, it returns that same object. The matching remains the legacy substring over-approximation, not a new Markdown reference parser.
- `deriveCoordinationPolicy({ coordinated, registered, preserveOrphanReferences }, previous?)` selects all coordinated handlers, only the orphan-footnote handler, or normal standalone behavior. Registration enables body harvesting even when visible orphan rendering is disabled. A harvesting-only change preserves handler identity. The host resolves any wrapper override before calling this function.
- `buildContributionChain(inputs)` names the policy dependencies explicitly: remark/rehype arrays, remark-rehype options, handlers, body-harvest policy, clobber prefix, document id and provenance. Source, phantom sets, registry and symbol remain the publisher's own fingerprint inputs.

These functions do not register, subscribe, publish or mutate their supplied snapshots. Treat label sets and returned objects as immutable; pass a previous result only from the same logical consumer. React retains the previous snapshots in refs and uses memoization; Vue uses local variables behind computed values. The engine and planner still own correctness when a source is replaced or a retained render is discarded.

The Vue prototype validates these decisions with real component lifecycle and SSR execution, while keeping AST/registry objects out of deep reactive proxies. It is not a production Vue renderer and does not yet validate DOM hydration, slots, styling or cursor behavior.

## Preparation and commit have different effects

Parsing, planning and constructing a contribution session do not register chunks or publish document facts. The host registers a chunk in its commit/lifecycle phase, receives a symbol, and calls `createContributionSession().commit(options)` only for a committed render whose symbol belongs to the current registry.

In React, `useRegistryContribution` owns one session and invokes `commit` from an effect. The registration symbol is paired with its registry; switching documents cannot briefly publish a frame under an old document's symbol. SSR does not run that effect, so it retains local footnote semantics. Other adapters must supply the equivalent lifecycle guarantees themselves.

The contribution fingerprint covers ordered refs, definition source, raw link destinations, owned label sets, phantom target sets and the identity tuple of parse policy. Equal source with changed plugins is not an equal contribution. Equal source with a resolved phantom inside a definition body is not an equal contribution either. Only a changed fingerprint/policy triggers the more expensive body harvest from post-pipeline HAST.

The publisher does not sanitize link URLs at contribution time: each consuming element applies its own final URL policy. Harvested footnote bodies retain plugin output. `buildAggregateTree` clones structural containers before appending backrefs, so assembly does not mutate registry-owned bodies. The clone intentionally shares `position`, `data` and individual property values; it is not an unrestricted deep clone for arbitrary consumer mutation.

Cleanup is also the host's responsibility. Release its registry registration and smooth coordinator slot when the chunk unmounts. The coordinator defers removal to a microtask so an immediate cleanup/re-register pair can revive the same slot without reordering it. Completion is sticky while registered; progress heartbeats do not notify every subscriber on each reveal frame.

## Planning and rendering contracts

The plan follows HAST children, because transformations can drop or regroup source nodes. Each item has a neutral `key` and a kind: `block`, `inline` or `synthetic`. Blocks carry source ranges, line/column positions, dependency labels and an optional swallowed-HTML digest. The planner's keys are sibling identities; they are not enough to validate cached output.

A renderer must also compare occurrence within equal-source buckets, dependency fingerprint, position, HTML digest and the decision to strip a swallowed local footnote section. The React adapter keeps this cache in `packages/react/src/components/blockMemo.ts`. It atomically replaces its previous-frame cache so removed blocks release their nodes. Moving that cache wholesale into core would expose React-owned values without establishing a useful cross-framework contract.

The retained-prefix planner reuses only identity-proven eligible nodes. It retains full planning around raw HTML and definitions, and whole-document reference context when planning a tail that follows reference-bearing retained blocks. This is not a promise that every append costs only the number of appended characters: top-level traversal and reference-context work can still scale with the document.

## Build and validation

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @ai-markdown/core typecheck
pnpm exec vitest run --project unit packages/core/src/runtime.test.ts
pnpm preflight
```

Build before running distribution tests: they load the actual ESM/CJS production and development files in separate Node processes, reject UI framework resolution transitively and parse without browser globals. Other tests compare session output with an independent full engine pipeline, exercise resets/fallback, prove explicit contribution timing and check aggregate body immutability. Existing React tests still exercise the adapter's delegation, memoization, byte equivalence, coordination and browser behavior.

`assert-boundary.mjs` checks public-package identity, allowed production dependencies, source import direction and folded environment gates. The React distribution guard requires external core and engine imports. Core's declarations must not expose `RegistryInternal`, `SmoothCoordinatorInternal` or private refcount/subscriber containers.

The release train is engine/core/react/react-mantine at the same version. Core depends on engine through `workspace:*`, which becomes the exact train version in the published manifest. Both ESM and CJS have production and development entries; every build folds environment gates separately. Core has no `use client` directive and does not inline a second engine implementation.

## Public API and write capabilities

The root entry explicitly lists supported beta exports. Session creation, parsing, planning, pure coordination preparation, contribution commit, aggregate construction, structural cloning and source-tail classification are adapter contracts. The existing block digest and fingerprint functions remain available because React consumes them; their source/ownership assumptions above still apply.

`createSmoothCoordinator` returns the read-only state and documented methods of `SmoothCoordinator`, excluding internal refcounts and notification containers. `ContributionOptions.registry` accepts only a `ContributionRegistry` write capability with `contributeChunkData`; it does not require an implementation registry. Create a registry through engine's `createRegistry`, whose `RegistryController` adds registration and publication to the read-only `Registry` contract. Pair every registration with release in the owning adapter.

These are type-level API boundaries, not object freezing or arbitrary deep cloning. Mutating returned sets, tree data or undocumented implementation fields is unsupported. A beta upgrade can refine the contract; stable 3.0.0 will require another signature review and consumer validation.
