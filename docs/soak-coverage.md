# Soak coverage map

The machine-readable source of truth is `scripts/soak/coverage-map.json`.
`scripts/soak/assert-coverage-map.mjs` verifies that every referenced source
and test exists and that every release leg has an owner.

Every stateful or incremental entry must record its stateless oracle, CI test,
release-soak leg, and an anti-vacuity condition proving that the optimized path
was actually exercised. A new entry is incomplete until a planted fault makes
its property or anti-vacuity assertion fail.

The release runner creates `.soak-logs/<run-id>/manifest.json` and
`result.json`. Full and split results are checked with:

```sh
pnpm --filter @ai-react-markdown/engine soak:aggregate -- \
  .soak-logs/<main-run-id> .soak-logs/<census-run-id>
```

Only the complete release profile may produce a release PASS. Development
runs must use `SOAK_PROFILE=smoke`; reused diagnostic seeds must additionally
use `RUN_KIND=replay`.

| Entry                    | Oracle                          | Soak legs        | Anti-vacuity                                        |
| ------------------------ | ------------------------------- | ---------------- | --------------------------------------------------- |
| Incremental parse        | Fresh full parse                | `fuzz`           | Incremental-frame ratio and generator-family floors |
| Resumed freeze scan      | Fresh boundary scan             | `fuzz`, `census` | Non-zero engagement and exhaustive P3               |
| Freeze direction         | Full parse after hazard futures | `dir`, `oracle`  | Boundary and document-probe floors                  |
| Definition-label scanner | Full `collectDefLabels` parse   | `scanner`        | Hazard and benign streams at every snapshot         |
| LaTeX preprocessor       | Stateless `preprocessLaTeX`     | `latex`          | Per-config freeze, rewind, and composed-seam floors |
