# Vue lifecycle prototype

Private integration experiment for the future `ai-markdown` framework adapters. It consumes the existing engine and public shared-core workspace exports with real Vue 3 reactivity, component mounting/unmounting and server rendering. It is not an npm package or a production Markdown component.

The purpose is to check whether shared preparation decisions work outside React before committing to the new core's public API. No Vue dependency is added to shared core, engine or the published React packages. The workspace is outside `packages/*`, so it does not join the public build/publish train; its tests and typecheck do participate in repository verification.

## What the composable owns

`src/useMarkdownChunk.ts` binds one logical chunk to Vue:

- A local pipeline session, block planner, definition scanner and contribution publisher live for the component instance.
- `computed` tracks accumulated source, policy and document identity. Registry notifications increment a shallow scalar signal. ASTs and registry objects are not placed in deep reactive proxies, preserving the identity checks used by retained-prefix parsing and planning.
- The document id selects stable plugin arrays and clobber prefix. Content-only updates do not rebuild that chain.
- `derivePhantomTargets` computes external definition candidates and preserves equal target snapshots. `deriveCoordinationPolicy` selects handlers and body harvesting. `buildContributionChain` supplies the shared policy invalidation tuple. None of these decisions is reimplemented in Vue.
- Registration starts from `onMounted`; label/registry changes are handled by a post-flush watcher. Its cleanup unsubscribes and releases the prior registration. Allocation pairs the registry with its symbol, preventing a document switch from publishing under an old symbol.
- `watchPostEffect` publishes the prepared contribution. Server rendering never enters the mounted registration/publication path.
- Unmount stops both watchers and releases registration. Registry reclamation retains the engine's microtask semantics.

The getter input contains already-preprocessed accumulated content, the current registry, a document id, the resolved orphan policy and an explicit incremental flag. The host sets incremental parsing to false for a one-shot SSR request. A wrapper would resolve document-level options and provide the registry; this prototype deliberately accepts those host decisions as input.

Use Vue's [post-flush effect timing](https://vuejs.org/api/reactivity-core.html#watchposteffect) for publication. Tests use Vue's [custom renderer API](https://vuejs.org/api/custom-renderer.html) to mount real components into a minimal memory host, and `@vue/server-renderer` for SSR. The host's output displays serialized trees for inspection; it is not a complete HAST-to-Vue element converter.

## Run the experiment

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @ai-markdown/prototype-vue typecheck
pnpm --filter @ai-markdown/prototype-vue test
pnpm preflight
```

Build first: the prototype resolves runtime/engine through their workspace package exports, which point to `dist`. The root unit project includes prototype tests, and recursive package tests discover the local Vitest configuration.

## Verified contracts

| Scenario                               | Expected behavior                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Preparation during component setup     | No registry registration or contribution publication                                               |
| Two mounted chunks                     | A reference chunk resolves the definition chunk's footnote number and link destination             |
| Definition changes                     | Link targets and harvested aggregate footnote bodies update                                        |
| Unrelated source policy remains stable | The reference chunk retains its parsed MDAST identity                                              |
| Document switch                        | New symbols belong to the new registry; the prior registry empties                                 |
| Unmount                                | Contributions and subscriptions are released                                                       |
| SSR                                    | Local footnote bodies remain in prepared HAST; no registration, subscription or publication occurs |

## What this does not establish

This experiment does not ship DOM rendering, placeholder components, custom component/slot mapping, styles, a streaming cursor or a smooth reveal shell. It does not demonstrate hydration equivalence, browser layout or accessibility. SSR testing checks prepared local footnote trees, not byte equivalence with the React renderer's HTML.

A real Vue adapter still needs a complete HAST conversion and reference-placeholder layer, final URL policy application, browser hydration tests and the framework's component customization API. Those are adapter responsibilities and should be tested before the new public package is advertised as stable. The current evidence supports sharing the preparation functions; it does not justify freezing the entire future core API.
