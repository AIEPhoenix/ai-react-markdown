# Benchmarking

Measure the integration and workload you intend to change. The [July 2026 benchmark record](benchmark.md) is historical evidence, not a current latency promise.

## Choose the measuring tool

| Tool                  | Use it for                                                                       | Limits                                                                                            |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm bench:unit`     | Isolated LaTeX preprocessing microbenchmarks                                     | Does not measure rendering, layout or document coordination                                       |
| Storybook comparisons | Attributing parsing and React commit work                                        | Development-mode measurements are not production latency estimates                                |
| `pnpm bench:web`      | Production browser integration, frame gaps, long tasks and DOM/viewport behavior | Current apps cover React, Mantine and a React text control; they do not establish Vue performance |

## Run a focused production scenario

Build the workspace packages before running the browser harness:

```bash
pnpm build
pnpm bench:web:selftest
pnpm bench:web --app react-core --scenario code-dense --repeats 5
```

The self-test checks that the measuring instrument responds to injected work. It is not a library speed threshold. Results are written under the ignored `benchmarks/results/` directory. See the [browser harness guide](../../../../benchmarks/README.md) for scenario selection, comparison commands, timeouts and dispatch defaults.

Do not infer smooth-reveal performance from a scenario that only supplies uniformly paced source updates. Verify which controller, coordination path and presentation features the scenario actually exercises.

## Re-measure a current change

Choose the question first. For an incremental-parser change, compare parse and transform stages with identical plugin selections and input snapshots. For a custom renderer or code-highlighting change, use a production browser app and include the same CSS and providers an application uses. For coordinated references, include multiple mounted chunks and definition changes; standalone numbers cannot estimate registry fanout.

Record the commit, package versions, browser, device, build mode, payload, delivery schedule, and repetitions with the result. Preserve correctness checking alongside timing. Normalize generated document prefixes only where the equality harness requires it; do not erase a meaningful href, missing footer, or reordered node merely to make a comparison pass.

Compare each scenario with itself before and after the change. Report medians or repeated runs with their spread, identify timeouts explicitly, and separate warm startup from steady streaming. A large relative parser saving can coexist with a small end-to-end improvement when highlighting or layout dominates; that is a useful attribution result, not a contradiction.
