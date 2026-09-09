# From ai-react-markdown to ai-markdown

**v2.14.1 is the final planned legacy release; 3.0.0-beta.1 starts the new `@ai-markdown` package train.** The GitHub repository has moved to `ai-markdown/ai-markdown`. Package names, directory ownership and shared-core distribution change together. React components, hooks, configuration names and stylesheet behavior retain their existing shape.

The first beta established the new package boundaries. The current unreleased beta.2 candidate adds the Vue adapter and reviews the advanced engine/core APIs before stable 3.0.0. Use the explicit `beta` tag when installing the new framework packages. Existing legacy versions and Git tags remain available.

## Package and import mapping

| Legacy package or path                          | New package or path                        | Responsibility                                                                   |
| ----------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `@ai-react-markdown/engine`                     | `@ai-markdown/engine`                      | Grammar, tree transforms, incremental algorithms, registry and URL primitives    |
| Private `@ai-react-markdown/runtime`            | `@ai-markdown/core`                        | Sessions, plans, committed contributions, aggregate HAST and reveal coordination |
| `@ai-react-markdown/core`                       | `@ai-markdown/react`                       | React components, hooks, contexts, node caches and DOM integration               |
| `@ai-react-markdown/core/plugins`               | `@ai-markdown/react/plugins`               | React-facing plugin and preprocessing exports                                    |
| `@ai-react-markdown/core/typography/<name>.css` | `@ai-markdown/react/typography/<name>.css` | Existing typography stylesheets                                                  |
| `@ai-react-markdown/mantine`                    | `@ai-markdown/react-mantine`               | Mantine typography and code/diagram presentation                                 |
| `@ai-react-markdown/mantine/styles.css`         | `@ai-markdown/react-mantine/styles.css`    | Mantine integration stylesheet                                                   |
| `@ai-react-markdown/remark-mark-highlight`      | `@ai-markdown/remark-mark-highlight`       | Independently versioned unified plugin                                           |

**The old React core becomes `react`, not the new shared `core`.** Applications should install the framework package. Engine and shared core are normal dependencies and arrive automatically. Custom adapter authors can depend on both explicitly. No alias wrapper joins the old and new graphs; update application imports and integration dependencies together.

## React installation and API continuity

```bash
pnpm remove @ai-react-markdown/core
pnpm add @ai-markdown/react@beta react@^19 react-dom@^19
```

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';

export function Answer({ content, streaming }: { content: string; streaming: boolean }) {
  return <AIMarkdown content={content} streaming={streaming} />;
}
```

Continue passing the complete accumulated Markdown string. `AIMarkdown`, the narrow hooks, `AIMarkdownDocuments`, component slots and flat configuration names retain their React API. Existing custom typography uses the same variant filename under the new package path. Import preprocessors and plugin helpers through the new root or `/plugins` entry as appropriate for their existing exports.

React 19 is the supported initial peer range. ESM/CJS, development/production conditions, declarations and the React `use client` directive are retained. KaTeX remains an optional peer; install it and import its stylesheet when using math rendering, following the [React README](../packages/react/README.md). Custom renderers must still apply the documented final-element URL policy.

## Mantine integration

```bash
pnpm remove @ai-react-markdown/mantine
pnpm add @ai-markdown/react@beta @ai-markdown/react-mantine@beta
```

Keep the existing React 19, Mantine 9 and highlight.js peers. The beta integration requires the exact React adapter beta version, so upgrade the two together. Import `@ai-markdown/react-mantine/styles.css` after the Mantine styles and retain the providers shown in the [Mantine README](../packages/react-mantine/README.md). `MantineAIMarkdown`, `codeBlock` and caller slot precedence are unchanged.

The integration remains React-specific; it cannot render Vue nodes. Mermaid loading and the optional math stylesheet follow the existing integration behavior.

## Shared core ownership

The legacy split extracted reusable computation before changing public imports. The new core now ships separately, with an explicit export list, instead of being bundled into React. Engine and core are exact-version dependencies of the adapter. They do not import React, Vue or DOM APIs; adapters may consume engine directly without routing every primitive through a core re-export.

Core owns pipeline sessions, phantom preparation, block planning, contribution fingerprints, post-transform body harvesting, aggregate footnote HAST, smooth queue state and source-tail classification. It returns syntax trees and coordination facts. React owns nodes, cached React output, context subscriptions, provenance credentials, lifecycle timing, final placeholder conversion and DOM cursor measurement.

`createRegistry` exposes engine's `RegistryController` write contract without private subscriber/refcount containers. Core's contribution publisher requires only a `ContributionRegistry` capability. `createSmoothCoordinator` exposes documented state and methods through `SmoothCoordinator`. These type boundaries do not deep-freeze returned values. The [core README](../packages/core/README.md) documents ownership, invalidation and read-only snapshot rules.

## Cross-chunk references and SSR

Keep the existing logical `documentId`, stable chunk identity and document ordering when changing imports. `AIMarkdownDocuments` still scopes coordination. Registration and contribution publication occur in committed lifecycle work; parsing and planning must not publish. A discarded concurrent render cannot retain a permanently owned document scope.

SSR does not run the registration effects and retains local footnote behavior. The host chooses one-shot parsing for server output; a later client frame must establish its own session and registration. Do not serialize a mutable registry or planner from one request into another. The beta keeps the existing React SSR behavior; a future Vue hydration implementation needs separate validation.

## Public API and release policy

Engine, core, react and react-mantine use one version train starting at `3.0.0-beta.1`, published under `beta`. The highlight plugin remains on its independent 1.x line; the existing rehype/raw forks retain their own repositories and upstream-related versions. A beta release must not move the npm `latest` tag or become a stable GitHub release.

Advanced engine/core contracts may evolve during beta. Test fixtures and implementation containers are excluded from the public root. Framework apps should avoid importing source paths or undocumented helpers. Stable 3.0.0 requires signature review, supported consumer checks and the complete release gate. See the [shared API contracts](./api/core-engine-contracts.md) and [architecture guide](./architecture.md).

The repository transfer is complete. Each new npm package still needs its own first-publication credentials and trusted-publisher configuration for organization `ai-markdown`, repository `ai-markdown`, workflow `release.yml`. Organization ownership alone does not create those configurations. Releases retain provenance and use CI as the publication path.

## Validation and second-framework limits

Shared-core tests load production/development ESM and CJS in fresh Node processes, reject framework resolution and execute parsing/planning without browser globals. Session tests compare incremental output with a full engine pipeline and cover reset, fallback and explicit contribution timing. React tests cover node identity, SSR, Strict Mode, coordination and browser interaction. Published artifacts must additionally resolve outside the workspace, including declarations, plugin entries and CSS paths.

The [Vue adapter](../packages/vue/README.md) now consumes the same preparation contracts and supplies VNode conversion, scoped references, SSR hydration, component/slot extension and streaming UI. It requires Vue `^3.5.0`; its first npm publication is pending. The former prototype is archived. See the [API contracts](./api/core-engine-contracts.md) for the beta.1-to-candidate advanced API changes.

Vue joins the candidate release train with browser acceptance coverage. First publication, trusted-publisher setup for the new package and stable-version approval remain separate steps. A framework-independent Node consumer alone does not establish browser readiness.

## Documentation site

The dedicated site follows this package migration. It should provide shared concepts, framework-specific installation and examples, API reference, streaming and customization guides, security policy, architecture/contributor pages and a versioned legacy path. The repository plan records the page mapping; no public site or domain is claimed by this beta.

Package READMEs continue to include complete installation, minimal examples, environment requirements and important limitations. Legacy 1.x-to-2.x guidance remains historical material; new users should start with the current framework README and this migration guide.
