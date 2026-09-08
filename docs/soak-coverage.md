# Soak coverage map

The release soak compares stateful and incremental implementations with simpler, stateless oracles. A passing equality assertion is useful only if the optimized path actually ran. Each entry therefore records both the oracle and an anti-vacuity condition: a measurable requirement for engagement with the path being tested.

The machine-readable source is [`scripts/soak/coverage-map.json`](../scripts/soak/coverage-map.json). Its validator, [`assert-coverage-map.mjs`](../scripts/soak/assert-coverage-map.mjs), checks that referenced source and tests exist and that every release leg has an owner.

## Coverage by optimization

| Entry                    | Stateless oracle                | Release legs     | Anti-vacuity requirement                            |
| ------------------------ | ------------------------------- | ---------------- | --------------------------------------------------- |
| Incremental parse        | Fresh full parse                | `fuzz`           | Incremental-frame ratio and generator-family floors |
| Resumed freeze scan      | Fresh boundary scan             | `fuzz`, `census` | Non-zero engagement and exhaustive P3               |
| Freeze direction         | Full parse after hazard futures | `dir`, `oracle`  | Boundary and document-probe floors                  |
| Definition-label scanner | Full `collectDefLabels` parse   | `scanner`        | Hazard and benign streams at every snapshot         |
| LaTeX preprocessor       | Stateless `preprocessLaTeX`     | `latex`          | Per-config freeze, rewind, and composed-seam floors |

The six leg names are runner identifiers, not interchangeable test categories. For example, the resumed scanner is exercised by both randomized splice streams and the bounded-exhaustive census; the definition scanner has its own leg because its configuration and output contract differ from the render parser.

## Adding or changing an entry

Every stateful or incremental entry must name its stateless oracle, CI test, release-soak leg, and anti-vacuity condition. Add the mapping when introducing the optimization, then confirm that the corresponding test compares outputs at the intermediate snapshots where a stale state could matter.

A new entry is incomplete until a planted fault makes its property or engagement assertion fail. Equality against an oracle alone can stay green if the implementation silently falls back on every frame. Conversely, a coverage counter alone cannot establish correctness. Preserve both checks and record a regression fixture when a failure identifies a new input family.

## Run profiles and evidence

Development runs use `SOAK_PROFILE=smoke`. A diagnostic rerun using a previously observed seed additionally uses `RUN_KIND=replay`. These runs help investigate failures; they must not be presented as a fresh release campaign.

Only a complete release profile can produce a release PASS. The runner writes `.soak-logs/<run-id>/manifest.json` and `result.json`, which record the run identity and result needed by the aggregator. Full and split results are checked from the repository root with:

```sh
pnpm --filter @ai-react-markdown/engine soak:aggregate -- \
  .soak-logs/<main-run-id> .soak-logs/<census-run-id>
```

Replace the placeholder directories with the actual run directories. Do not infer release success from a subset of green logs: the aggregator checks the evidence across the required legs and split runs. A replay that diagnoses one failing seed does not replace a complete, fresh-seed release profile.

## Related records

The [prefix-freeze experiment](../packages/engine/src/experiments/prefixFreeze/README.md) explains the boundary study and the evolution of the verification stack. The [architecture guide](./architecture.md) identifies the production pipeline. Historical soak sizes in release notes describe those releases; the current coverage map and runner define the present release contract.
