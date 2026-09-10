# Releasing 3.0

The prepared candidate is `3.0.0-rc.1` for engine, core, React, React/Mantine and Vue. The independent highlight plugin is `1.0.2`; its patch corrects the Node engine declaration. Candidate preparation is not evidence that a version is published. Confirm publication in the [release records](https://github.com/ai-markdown/ai-markdown/releases) before following `@rc` installation examples.

## Compatibility contract

- Public Node consumers require `^20.19.0 || >=22.12.0`. Earlier Node 20 versions fail when CJS output loads ESM dependencies. Both declared lower bounds and Node 24 run packed consumer checks in CI.
- React requires React 19; Vue requires Vue 3.5 or later. Mantine integration follows its declared peer ranges. Packed consumers exercise ESM/CJS, declarations, styles, React SSR and Vue SSR outside the workspace.
- Declaration snapshots cover engine, core, React, React plugins, Mantine and Vue. Review snapshot diffs before updating; avoid breaking the frozen candidate API without a new candidate and migration notes.
- The Vue browser suite runs hydration, references, updates, smooth streaming, cursor layout and unmount checks in Chromium, Firefox and WebKit. Forced-GC lifetime assertions remain Chromium-only. This does not establish Nuxt, KeepAlive or Suspense support.

## Candidate acceptance

1. Run `pnpm preflight` on the final source. It builds all packages and runs lint, formatting, declarations, unit and control tests, tarball checks, consumer integration, Storybook and browser/lifetime checks.
2. Require the CI packed consumer matrix and core contract job to pass. The generated contribution/aggregate state test has a 30-second correctness budget; its seeds, cases, sequence lengths and assertions are unchanged. Performance needs separate measurements.
3. Commit a clean candidate and run `pnpm check:soak-impact`. Changes to the soak classifier since beta.2 require a fresh release campaign. Follow [soak coverage and approval](./soak-coverage.md), preserving all six legs and 84 logical tasks. Validate the completed evidence with `pnpm check:release-soak --evidence .soak-logs/<run-id>`.
4. Tag only the verified candidate. The release workflow must pass automated verification and, when required, human `soak-approval` review. The reviewer checks the candidate SHA and full local evidence before approving. Retain the evidence directory.
5. Publish the five train packages through trusted publishing on `rc`; verify all exact versions, tarballs, provenance and peer dependencies. The independent plugin uses `latest`. Retain the bootstrap secret for future first publications, but do not select bootstrap authentication for this existing-package RC.
6. Install published RC artifacts in representative React, Mantine and Vue applications. Record the application/runtime versions, SSR/hydration and streaming results. Allow a feedback period before promoting the train.

A local green run cannot substitute for remote CI, published-artifact verification or the release environment reviewer. Record actual run URLs and evidence identifiers in the release record after they exist.

## Stable promotion

Resolve candidate regressions and publish another RC if public behavior or compatibility changes. Then run `pnpm version-packages 3.0.0`, update current guides and badges from `@rc` to stable, and refresh release highlights. Rebuild and validate the final tarballs and peer ranges. Reassess soak impact; only reuse an ancestor campaign if the evidence gate accepts it for the final clean candidate.

Publish `v3.0.0` through the release workflow, with npm `latest` for all five train packages and a non-prerelease GitHub release. Check fresh installs without explicit tags. Do not move existing tags or overwrite a published version; use a new patch or candidate to correct a faulty release. Keep the prior beta/RC artifacts available for diagnosis.
