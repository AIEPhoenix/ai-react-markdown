# From ai-react-markdown to ai-markdown

**2.14.0 is the final planned release under the `ai-react-markdown` project identity and package scope.** It introduces an internal framework-neutral orchestration layer while retaining the existing React and Mantine APIs, imports, stylesheet paths and installation commands. The next development phase moves to `ai-markdown`; this release does not rename installed packages or claim support for a second UI framework.

This document distinguishes the architecture implemented in the legacy release from the subsequent package migration. Keep using the existing package READMEs to integrate 2.14.0. The future names below describe the intended destination and are not installation instructions for already-published replacements.

## Why split before migrating names?

The current `@ai-react-markdown/core` is a React adapter. It contains React contexts, hooks, node caches, component conversion and browser cursor behavior. Renaming that whole package to `@ai-markdown/core` would make the new shared core depend on React and leave every additional framework to repeat the same parsing and coordination policies.

The split instead extracts reusable orchestration into a private runtime package. React consumes that implementation before any public package name changes. Existing equivalence, SSR, streaming, coordination and browser tests can therefore validate the boundary against a working adapter. Source reorganization and consumer import migration remain separately reviewable changes.

## Current ownership and intended package names

| Legacy package/layer                       | Role after this split                                                                                                       | Intended ai-markdown destination                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@ai-react-markdown/engine`                | Grammar, tree transforms, incremental algorithms, registry and policy primitives                                            | `@ai-markdown/engine`                                                     |
| Private `@ai-react-markdown/runtime`       | Pipeline sessions, block plans, contribution publishing, aggregate HAST, reveal coordination and source-tail classification | `@ai-markdown/core`                                                       |
| `@ai-react-markdown/core`                  | React components, hooks, contexts, node caches and DOM integration                                                          | `@ai-markdown/react`                                                      |
| `@ai-react-markdown/mantine`               | React/Mantine typography and code/diagram presentation                                                                      | A React-specific Mantine integration; final name belongs to the migration |
| `@ai-react-markdown/remark-mark-highlight` | Framework-independent unified plugin on its own version track                                                               | A separately versioned plugin under the new scope                         |

Dependency direction is engine → consumed by runtime → consumed by adapters → consumed by UI integrations. Adapters may also use engine primitives directly. Runtime does not re-export the engine wholesale, and neither shared package imports an adapter. A future Vue, Svelte or other adapter must own its framework's nodes and lifecycle; it should consume shared decisions instead of copying React's hooks.

DOM positioning is still in the React adapter for this release. A separate browser-only utility entry may be justified once a second adapter needs it. It must not make the shared root depend on `document`, `HTMLElement`, or the browser's layout cycle. The current runtime root is typechecked without DOM libraries and exercised by a Node consumer with UI framework imports rejected.

## What 2.14.0 actually changes

The renderer now delegates its full/incremental pipeline session, phantom suffix assembly, block planning, reference fingerprints, contribution comparison/body harvest, aggregate footnote tree assembly and smooth queue state machine to runtime. Runtime returns trees, plans and coordination facts; React converts them into elements and manages cache ownership.

The split preserves the distinction between computation and committed side effects. Parsing and planning do not register or publish anything. The React adapter registers a chunk during its lifecycle and publishes through the runtime contribution session from an effect. A discarded render must not publish. SSR retains local footnote behavior because commit effects have not allocated a coordinated symbol.

The public installation remains the existing engine/core/mantine release train. Runtime is `private: true`, stays out of npm publishing and is bundled into core. Core's declarations are resolved during the build, and distribution checks reject leaked private runtime imports. Engine remains external and version-pinned; a second inlined engine copy could split registry identity and is explicitly forbidden.

Detailed ownership, APIs and invariants live in the [runtime README](../packages/runtime/README.md). The [architecture guide](./architecture.md) follows the production React path, and [cross-chunk coordination](./cross-chunk-coordination.md) explains the user-facing reference behavior.

## Validation and the limits of this milestone

The split is validated through the existing React adapter and a framework-free Node consumer. The Node checks load production/development ESM and CJS artifacts, reject framework module resolution, run parsing/planning and exercise coordination. Session tests compare incremental output with a full engine pipeline and cover reset, fallback and explicit commit behavior. React tests remain responsible for node identity, hydration/SSR, Strict Mode and browser interaction.

A headless consumer proves that shared code can execute without React or a DOM. It does not prove that the API is ergonomic for every UI framework. The first real second adapter should validate lifecycle mapping, scheduler behavior, hydration, slots/components, styling, cursor placement and reference synchronization before the new shared core promises long-term public API stability.

## The migration that follows

1. Freeze the legacy release with its complete API documentation, release notes and verification record. Keep the tag available as the reference for existing consumers.
2. Move repository identity and package metadata to the new organization/scope. Update workspace dependency names, package exports, release tags, provenance/trusted publishing configuration, examples and documentation links together.
3. Rename the extracted runtime to the new shared core and the existing public core to the React adapter. Resolve the integration naming scheme before publishing its first new-scope version, so consumers do not have to migrate twice.
4. Implement and test a second framework adapter against the shared layer. Adjust the shared API where the adapter demonstrates a concrete lifecycle or rendering requirement.
5. Publish the dedicated documentation site with separate installation paths for each supported framework and a legacy-to-new migration guide. Present only frameworks and packages that actually ship.

The organization and npm scope have been reserved. That establishes ownership of the destination; it does not transfer the current repository, configure each npm trusted publisher, or publish the new package names automatically. Those changes belong to the next phase.

## Documentation site scope

The site should offer a framework selector, runnable getting-started examples, streaming integration guides, API reference, customization and security policy guidance, architecture/contributor material, migration mappings and a versioned legacy documentation path. Shared concepts—Markdown grammar, streaming completion, reference coordination and URL policy—should have one canonical explanation, with framework-specific examples beside it.

Keep the repository's package READMEs useful after the site launches: installation, a minimal complete example, supported environments, important limitations and direct links to deeper material still belong with the published npm package. The site expands navigation and examples; it should not make the installed package documentation depend on finding a separate website first.
