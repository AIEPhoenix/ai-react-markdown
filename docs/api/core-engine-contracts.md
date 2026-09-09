# Core / engine public API contracts

This guide defines the shared contracts used by framework adapters. The current APIs are beta and may change before stable 3.0.0. Application authors normally use a framework package; adapter authors can use the engine and core interfaces described here. See the package READMEs for installation and the [core testing guide](../core-testing.md) for behavioral validation.

## Layers and consumers

Engine supplies syntax, tree transformations, incremental algorithms, reference registries, and streaming controllers. Core supplies reusable sessions, block planning, contribution preparation/publication, aggregate footnotes, and turn-taking coordination. React and Vue explicitly depend on both core and engine; UI integrations depend on their corresponding framework adapter.

Core does not re-export the entire engine API or accept ReactNode, VNode, DOM elements, or framework lifecycles. Adapters own tree-to-component conversion, subscription/unmount timing, SSR hydration, slots/context, and cursor measurement. See the [Vue README](../../packages/vue/README.md) for implementation and usage.

## API differences from beta.1

| Surface                                                                    | Decision                                                       | Reason                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Engine root `export *`                                                     | Replace all star exports with explicit exports                 | Adding a source helper must not silently expand the supported API                          |
| `PipelineSession` / `PipelineTrees`                                        | Add named types; factories explicitly return `PipelineSession` | Fix the parse/reset contract without letting declarations grow with implementation objects |
| `ContributionSession`                                                      | Add a named publication interface                              | Consumers receive only the commit capability                                               |
| `BlockPlanner`                                                             | Add a named function type                                      | Distinguish the stateful factory from its per-frame planning call                          |
| `isEnginePlugin`                                                           | Add a public configuration guard                               | React/Vue can validate catalog objects without reading internal stages                     |
| `getEnginePluginInternals` / `EnginePluginInternals` / `EnginePluginStage` | Remove from the root; retain internally                        | Stages are pipeline implementation details; the replacement exposes a boolean decision     |
| `codePointSnapshots`                                                       | Remove from the root; development stories import source        | Test/demo frame generation is not a production adapter contract                            |
| `attributeHastChildren`                                                    | Remove from the root; retain inside the algorithm              | Incremental parsing owns HAST attribution                                                  |
| `SENTINEL_FN_CONTENT` / `SENTINEL_LINK_URL`                                | Remove from the root                                           | Adapters should not construct or match phantom protocol constants                          |
| Extra preprocessor array in `preprocessAIMDContent`                        | Accept readonly arrays                                         | The implementation only iterates over inputs and need not require mutability               |
| Block digest/fingerprint helpers                                           | Retain as advanced APIs                                        | React's cache uses them; validity still depends on tree and reference policy               |
| `computeFreezeBoundary` and stage timing                                   | Retain as advanced diagnostics                                 | Development tools use them; no promise of fixed performance values or log bytes            |

These removals narrow the entry surface between beta versions. Existing advanced beta consumers should use supported entries, not private dist paths. React component, hook, plugin, and CSS public paths retain their existing shape. The existing brand string inside plugin objects remains unchanged so an organization rename alone does not change the semantics of deployed configurations.

## Core factories and lifecycles

| Capability                           | Inputs and output                                                  | State and release                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `createPipelineSession`              | `PipelineFrameOptions → PipelineTrees`; synchronous parsing        | One session per chunk; reset discards retained state; dropping the host reference releases it without timers or global registration |
| `createBlockPlanner`                 | Full MDAST/HAST, preprocessed source, phantom hints → plan         | Retains one consumer's previous frame; replacing the planner resets its cache; retained trees must not be mutated                   |
| `derivePhantomTargets`               | Own definitions, registry labels, source → missing targets         | Pure preparation; previous is only a snapshot-identity hint for this consumer                                                       |
| `deriveCoordinationPolicy`           | Coordination, registration, orphan policy → handler/harvest policy | Neither registers nor publishes                                                                                                     |
| `buildContributionChain`             | Pipeline configuration and prefix → identity tuple                 | Covers parse policy; source equality alone cannot establish contribution validity                                                   |
| `createContributionSession().commit` | Committed trees, labels, symbol, write capability, identity tuple  | Call only after host commit; the host owns registration/release                                                                     |
| `buildAggregateTree`                 | Registry, prefix, orphan policy → footer HAST or null              | Render only for the last eligible chunk; never write results into shared bodies                                                     |
| `cloneHastForRender`                 | HAST node → structural clone                                       | Clones nodes/children/properties/data and originalUrls; other nested plugin data remains shared                                     |
| `createSmoothCoordinator`            | Optional onEmpty → `SmoothCoordinator`                             | Pair register/release; defer cleanup to a microtask; done stays sticky within a registration lifetime                               |
| `deriveTailSignal`                   | MDAST and actual preprocessed source length → source-tail facts    | Does not read DOM; the adapter chooses measurement and presentation                                                                 |

Treat parse/preparation results as borrowed readonly values even where underlying HAST types contain mutable arrays. Clone before changing trees or properties. The shared layer neither deep-freezes every node nor promises fresh identity for every object; adapters must not communicate by mutating snapshots.

An incremental-path failure clears retained state and attempts a full parse. If the full pipeline also fails, the error still propagates synchronously; fallback does not swallow all invalid configurations. `incrementalParse=false` also clears retained state and suits one-shot SSR. The server does not need browser detection to make this choice.

Block keys match logical positions; they do not guarantee cache validity. URL policy, registry, component, and tree-identity changes may still require reconversion. Some scanning/planning remains O(blocks) or O(document); updates are not guaranteed to cost only in proportion to newly appended characters.

## Engine registry read/write boundaries

`createRegistry()` returns `RegistryController`. Its read side, `Registry`, exposes versions, readonly index snapshots, global/per-label subscriptions, and resolution selectors. The write side provides paired registration/release and contribution methods. Internal reference counts, subscriber containers, and notification functions do not appear in the public return type.

Every `registerChunk(chunkId, ...)` requires one `releaseSymbol(chunkId)`. A chunk may register again before deferred cleanup, but pairing is still mandatory. `onEmpty` executes in the final-release microtask. A containing map must check that its current entry still points to that registry before deleting it, avoiding removal of a newer instance.

Call receiver-dependent methods as `registry.method()`; wrap or bind them when passing callbacks. Unmount must unsubscribe. Notifications may coalesce changes with no net effect, so consumers read the current snapshot rather than deriving semantics from callback counts. A URL selector alone cannot observe every aggregate-body change.

`ContributionRegistry` deliberately exposes only `contributeChunkData`; the shared publisher cannot take over host lifecycle management. Keep ASTs, registries, and coordinators in shallow Vue references. Deep reactive proxy identity is not the engine's original node identity.

## URLs, placeholders, and extensions

Adapters create one provenance value per session and pass it to both rehype verification and cross-chunk handlers. Forged engine tags originating in Markdown must not be interpreted directly as internal framework components.

Apply `buildTransform`'s final URL policy to ordinary HAST before framework conversion. Cross-chunk references acquire their destinations later and must pass through `resolveCrossChunkReference` for sanitization, hash rebasing, and per-attribute urlTransform. Simply attaching the registry's raw URL is insufficient. `keepChildren` distinguishes sanitizer unwrapping from removal of an element together with its children.

`sanitizeSchema` is a shared readonly default; `extendSanitizeSchema` creates an independent draft. New object/function identity signals configuration changes to adapters. In-place mutation of a schema already in use is unsupported. Custom framework components remain application code: the Markdown sanitizer does not inspect their output again.

## Smooth controllers

The engine controller manages the visible prefix of one source; the core coordinator decides when a chunk receives its turn.

- Initial frames and source replacements snap; confirmed appends reveal by grapheme.
- Finish confirms the final grapheme and drains backlog; later updates can resume streaming.
- Flush still respects active-stream grapheme hold-back.
- The controller options object deliberately provides live configuration. Adapters update pacing while retaining object identity.
- Schedulers must invoke callbacks asynchronously and return cancellation functions. Synchronous invocation violates the contract.
- Dispose cancels frames and clears subscriptions, but later calls can reactivate the controller. Do not call it after actual unmount.
- Coordinator completion is sticky. Use a new registration identity when subsequent messages must queue again.

## Declaration and consumer guards

After building, run `pnpm check:public-api`. The script compares complete declarations, with comments removed, against the [engine](./engine.api.txt), [core](./core.api.txt), and [Vue](./vue.api.txt) snapshots. It rejects private registry/coordinator types, local node_modules paths, and framework dependencies in shared layers, and checks that root entries have no star exports. Review signature changes before running `node scripts/check-public-api.mjs --update`.

Snapshots are not semantic proofs. Unit tests cover lifecycle and immutability contracts; real browsers cover Vue's three complete adapter paths. Packed consumers install tarballs outside the workspace and separately exercise ESM/CJS, dev/prod, SSR, and TypeScript. Engine-impacting releases require validated local soak evidence and manual release approval; see [soak coverage](../soak-coverage.md) for the impact policy and evidence reuse rules. Engine soak coverage must not be mistaken for core or adapter lifecycle coverage.
