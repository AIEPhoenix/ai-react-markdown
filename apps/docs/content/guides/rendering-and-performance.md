# Rendering and performance

Incremental parsing reduces repeated parsing work while a document grows. It does not make all rendering work proportional to the newest transport delta. Measure parsing, framework rendering and application work separately.

## What the adapters share

React and Vue use the same engine and core pipeline sessions. The client adapters enable `incrementalParse` by default. A verified prefix can be retained while an unfinished tail is parsed again; configuration changes or source replacement can invalidate retained state. Server rendering uses the full pipeline.

Built-in preprocessing has append-aware paths, but a custom content preprocessor receives the complete string. A whole-string regular expression still scans a growing document even when parsing can reuse its prefix.

## Where the frameworks differ

| Stage                                | React                                                                | Vue                                                                    |
| ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Parsing and contribution preparation | Shared engine/core sessions                                          | Shared engine/core sessions                                            |
| Block planning                       | Uses the core block planner                                          | Does not run the block planner                                         |
| Framework conversion                 | Can reuse cached React blocks with `blockMemo` (default `true`)      | Converts the frame's HAST to VNodes; Vue's patcher compares the result |
| Presentation                         | React typography and custom components; optional Mantine integration | Vue components, slots and application CSS                              |

In React, `incrementalParse` is effective only while `blockMemo` is enabled; turning `blockMemo` off also disables cross-chunk coordination. Keep it enabled for coordinated documents. React's `blockMemo` prop and profiling recipes do not apply to Vue. Neither adapter uses `streaming` as the switch for incremental parsing.

## Keep update costs visible

1. Start with one accumulated string per message. Extra renderers introduce coordination and framework work; they are a layout decision, not an automatic optimization.
2. Keep plugin arrays, schemas and callbacks stable until their meaning changes. Treat shared policy objects as immutable.
3. Profile the actual document shape. A growing table or unfinished construct can leave a large tail to process.
4. Include custom components, syntax highlighting, diagrams and layout in the measurement. Parse time alone does not describe the user's experience.
5. Compare completed output as well as timings. An optimization is useful only if it preserves the required result.

## Continue with measured guidance

- [React streaming and performance](streaming-and-performance.md): cache invalidation, stable props and profiling.
- [Mantine streaming code](../../../../packages/react-mantine/README.md#streaming-code-source-display-and-asynchronous-work): source, displayed code and asynchronous presentation work.
- [Benchmark record](benchmark.md): measurements for the specific historical versions and workloads recorded there; these are not current-version performance promises.
- [Soak coverage](soak-coverage.md): how contributors check equivalence and exercise stateful optimizations.
