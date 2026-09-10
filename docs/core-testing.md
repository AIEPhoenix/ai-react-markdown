# Core contracts and state-sequence validation

`@ai-markdown/core` is an independent, framework-neutral package, and its tests belong with the implementation. The engine's six-leg soak validates parsing algorithms; it does not replace checks for core state, caches, publication, or cleanup. This gate also does not establish the correctness of React/Vue DOM behavior, hydration, or host lifecycles. Those still require adapter tests.

## Running the gate

From the repository root, run:

```bash
pnpm install --frozen-lockfile
pnpm test:core-contracts
```

The command builds core and its workspace dependencies, checks core's types, and runs every core test. It does not require prebuilt React/Vue packages or load the root Storybook project. Tests also exercise the actual ESM/CJS development/production entries without UI frameworks or browser globals.

The standalone gate runs in the dedicated `core-contracts` CI task. Root `preflight` and the Release workflow cover the same checks through the shared package build, workspace typecheck and `test:unit` steps, without repeating core builds or tests. The aggregate unit command also protects the sequence settings. Any nonzero exit fails validation. See [development commands](./development-commands.md) for the complete command map.

## Coverage ownership

| Core module                         | Main tests within core                                       | Contracts checked                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipelineSession`                   | `runtime.test.ts`, `stateSequences.test.ts`                  | Incremental/full equivalence, appends and replacements, configuration/document switches, reset, one-shot parsing, recovery after failure       |
| `blockPlan` / `blockPlanner`        | `blockPlan.test.ts`, `blockPlanner.test.ts`, state sequences | Block/reference context, fingerprints, six plugin configurations, retained-prefix reuse, phantom-policy changes, comparison with full planning |
| `coordinationPreparation`           | `coordinationPreparation.test.ts`                            | Phantom sets, handler/harvest policy, contribution identity tuples covering body-affecting inputs                                              |
| `contribution`                      | `runtime.test.ts`, state sequences                           | Explicit publication, duplicate-commit suppression, definition updates/removal, registry and registration changes, policy invalidation         |
| `aggregateFootnotes`                | `aggregateFootnotes.test.ts`, runtime, state sequences       | Ordering, repeated-reference backlinks, orphan policy, aggregation after release, output ownership and prefix isolation                        |
| `cloneHastForRender`                | `cloneHastForRender.test.ts`                                 | Frozen inputs, isolated URL metadata, deliberately shared nested data                                                                          |
| `tailSignal`                        | `tailSignal.test.ts`                                         | MDAST tail classification, nested descent, phantom exclusion                                                                                   |
| `coordinator` / `smoothCoordinator` | `smoothCoordinator.test.ts`, state sequences                 | Turn-taking, sticky completion, reference counts, deferred release, notification coalescing, heartbeat and final cleanup                       |
| Public distribution boundary        | `runtime.test.ts`, build checks                              | Actual entries without framework/DOM dependencies; declarations without implementation containers                                              |

Pure planner, coordinator, tail-derivation, and block-planning/fingerprint tests formerly inside React's blockMemo suite now live in core. React retains render-cache, component-output, aggregate-footnote component, and tail DOM-marker tests to verify adapter integration. ReactNode cache tests should not move into core merely to simplify directory ownership.

## Fixed-seed state combinations

`stateSequences.test.ts` uses three default seeds: `20260909`, `20260910`, and `20260911`. Each seed drives three properties, with 24 generated sequences per property and 24–48 random operations per sequence. Mandatory operation prefixes keep a sequence from completely skipping a major state axis. Contribution/aggregation properties have a 30-second per-seed timeout because they rebuild two registries after every operation; other tests retain their normal timeout. This is a bounded correctness budget, not a performance threshold, and does not reduce the seed count, sequence count or operation count.

1. **Pipeline / planner:** interleave appends, replacements, configuration/document switches, resets, and one-shot parsing. Compare every frame with an independent full engine parse, then compare the retained planner with complete `buildBlocks` planning.
2. **Contribution / aggregation:** update three chunks across two registries, remove definitions, switch documents, deactivate/re-register chunks, and replace pipeline configuration. Compare persistent publication with a fresh registry, full parse, and new publisher at each step. Also assert that repeated commits do not increase the version and that release empties registry state and labels.
3. **Turn-taking coordinator:** compare with a separate model containing only order, reference counts, and a done set. Check predecessor blocking, repeated registration, completion, release, and revival within a microtask. Finally check that state is empty and an unsubscribed observer receives no further notifications.

Reconstruction comparisons primarily detect stale state and invalidation mistakes across frames. A defect shared by both uses of a pure aggregation algorithm may escape that comparison, so numbering, backlinks, and ownership also have independent assertions with explicit expected results. This is neither exhaustive coverage of Markdown/state sequences nor a long-running memory stress test.

## Reproducing failures and extending coverage

A fast-check failure reports the seed, shrink path, and minimized operation sequence. Build the artifacts first, then replay with the values from that failure. Apply the path only to its corresponding property:

```bash
CORE_SEQUENCE_SEED=20260909 CORE_SEQUENCE_RUNS=24 CORE_SEQUENCE_PATH='replace-with-reported-path' \
  pnpm --filter @ai-markdown/core exec vitest run src/stateSequences.test.ts \
  -t 'contribution/aggregate'
```

Remove `CORE_SEQUENCE_PATH` to rerun the complete seed. Increase `CORE_SEQUENCE_RUNS` for a larger local campaign. The formal gate clears all three variables and always uses the defaults committed in source, preventing a developer's replay settings from silently reducing CI coverage.

When adding public state or cache dependencies, add the corresponding operations and explicit assertions. Update the coverage table for new modules. No coverage percentage is claimed here: the evidence consists of behavioral contracts and assertions; a line/branch coverage report has not yet been generated.
