# Build a framework adapter

Core and engine provide parsing and document coordination without React or Vue. Your adapter owns host rendering, lifecycle, styles, subscriptions and DOM measurement. If you are wrapping React for a design system, use [Build a React integration](extending-via-subpackage.md) instead.

## Begin with a standalone parse session

Install matching train versions of `@ai-markdown/core` and `@ai-markdown/engine`. This example also uses `unist-util-visit` to apply final URL policy to a render-owned tree.

```bash
pnpm add @ai-markdown/core @ai-markdown/engine unist-util-visit
```

Create one host per independent Markdown unit. The following function returns HAST for your framework converter; it does not publish document contributions or create DOM nodes.

```ts
import { cloneHastForRender, createPipelineSession } from '@ai-markdown/core';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  buildTransform,
  defaultEnginePlugins,
  defaultUrlTransform,
  preprocessAIMDContent,
  sanitizeSchema,
} from '@ai-markdown/engine';
import { visit } from 'unist-util-visit';

export function createMarkdownHost(documentId: string, clobberPrefix: string) {
  const session = createPipelineSession();
  const remarkPlugins = buildCoreRemarkPlugins(defaultEnginePlugins);
  const rehypePlugins = buildCoreRehypePlugins(sanitizeSchema, clobberPrefix);
  const remarkRehypeOptions = buildCoreRemarkRehypeOptions(true);
  const targetPhantoms = { missingFootnotes: new Set<string>(), missingLinks: new Set<string>() };
  const transform = buildTransform({
    urlTransform: defaultUrlTransform,
    allowedElements: undefined,
    disallowedElements: undefined,
    allowElement: undefined,
    skipHtml: true,
    unwrapDisallowed: undefined,
  });

  return {
    render(source: string, incrementalParse = false) {
      const trees = session.parse({
        content: preprocessAIMDContent(source),
        targetPhantoms,
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions,
        preserveForBodyHarvest: false,
        documentId,
        provenance: 'standalone-example',
        incrementalParse,
        defListEnabled: true,
      });
      const tree = cloneHastForRender(trees.hast);
      visit(tree, transform);
      return tree;
    },
    reset() {
      session.reset();
    },
  };
}
```

Supply a stable, unique, attribute-safe clobber prefix for the document, such as `answer-1-`. Use the same identity on the server and hydration render. The constant provenance above is only for this standalone path: a coordinated adapter needs a per-instance credential shared by its verifier and coordinated handlers.

This host defaults to full parsing, suitable for server output. A client can retain the host and pass `true` for subsequent incremental frames. It uses stateless preprocessing, so custom full-string transforms and preprocessing costs still need profiling. Reset retained state when replacing the host's parse policy; keep plugin arrays and schema identity stable while the policy is unchanged.

## Convert borrowed trees safely

Pipeline trees belong to the session. Clone before render-time mutation, as above. The structural clone does not recursively copy arbitrary nested plugin data. Your converter must map HAST to the framework's element model, forward allowed attributes deliberately and handle SVG namespaces correctly. Custom components are trusted application code; their output is not automatically sanitized again.

A block planner is optional. React uses one with its block cache; Vue converts each frame's whole HAST and relies on its patcher. If adding a cache, stable block keys alone do not establish validity: reference dependencies, positions, URL policy and component identity also matter.

## Add coordination at the host lifecycle boundary

| Phase                   | Adapter responsibility                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Prepare a frame         | Derive phantom targets and coordination policy; parse and plan without publishing                                  |
| Commit/mount            | Register the current chunk with its current document registry, subscribe, and publish only committed contributions |
| Read references         | Use the shared resolver so late destinations receive sanitization, rebasing and final per-attribute URL policy     |
| Render footnotes        | Let the last eligible chunk render the aggregate tree; do not mutate registry-owned bodies                         |
| Switch document/unmount | Unsubscribe and pair every registration with release; release smooth coordinator membership too                    |

SSR and hydration must agree before mounted contributions become readable. Do not share mutable sessions or registries across unrelated consumers or server requests. Read [Core and engine contracts](api/core-engine-contracts.md) before implementing this phase; the standalone example intentionally does not implement coordination.

## Verify the adapter, not only the parser

Test source replacement, configuration changes, late definitions, document switches and unmount cleanup in the actual host framework. Add server/hydration and browser tests for the framework's lifecycle and cursor geometry. Packed consumers should resolve public imports, types and styles outside the monorepo.

Shared engine equivalence tests do not prove your converter, subscription cleanup or hydration behavior. Use [core testing](core-testing.md), [soak coverage](soak-coverage.md) and the existing React/Vue integrations as distinct sources of evidence.
