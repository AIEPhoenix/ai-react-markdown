# Releasing 3.0

The stable target is `3.0.0` for engine, core, React, React/Mantine and Vue, following candidate `3.0.0-rc.1`. The independent highlight plugin is `1.0.2`; its patch corrects the Node engine declaration. Candidate preparation is not evidence that a version is published. Confirm publication in the [release records](https://github.com/ai-markdown/ai-markdown/releases) before installing a prepared version.

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

## Recorded RC acceptance and review exception

The fresh campaign `rc1-acceptance-20260910T102525Z-e575f03` tested clean commit `e575f03e6f940c21e0a3e0fc1ca30166752eaefb` with seed `202689100` and all 84 tasks. It passed in 10,917 seconds with `repositoryChanged: false`. Its original reports are retained under the maintainer's `.soak-logs/` archive.

Commit `2cdbf9a4be93fc5eaf62c3c1b27b6de276048bc8` only fixes ANSI normalization in the evidence aggregator and adds colored-verdict regression tests. All 37 soak control tests pass, and the corrected aggregator accepts the original 84-task evidence without editing any report. The candidate coverage gate still rejects that ancestor because it conservatively treats any aggregator change as a mechanism change.

On 2026-09-10 the maintainer explicitly authorized retaining the ancestor campaign and making the exception at human review instead of repeating the soak. The replacement run was interrupted and is not passing evidence. This is a narrow reviewed exception for the parser-only fix; it does not change future impact rules or the required-reviewer environment.

The [RC release workflow](https://github.com/ai-markdown/ai-markdown/actions/runs/34491579512) executes automated verification before human `soak-approval`. Its existence is not proof of publication; confirm its final result and npm artifacts before stable promotion. Stable changes must remain limited to version metadata, stable peer ranges and documentation, or require renewed compatibility and soak assessment.

The RC workflow completed successfully on 2026-09-10 after human review. All five `3.0.0-rc.1` packages and independent plugin `1.0.2` were published through OIDC. Post-publication checks downloaded the actual npm tarballs, matched their hashes and provenance sources, and passed ESM/CJS, React/Mantine/Vue SSR, CSS resolution, TypeScript declarations and Vue 3.5.0 consumption. Stable preparation has no runtime-source changes relative to this RC.

## Repeatable published-artifact verification

After publication, the release workflow runs `pnpm test:published-release "$RELEASE_TAG"`
before creating the GitHub release. It downloads npm artifacts and installs them outside
the workspace, reusing the packed-consumer probes for ESM/CJS, development conditions,
React/Mantine/Vue SSR, CSS, declarations, private API boundaries and Vue 3.5.0.
Stable train verification additionally installs all packages without version pins and
checks that npm selects the expected release versions. RC verification uses exact
artifacts and checks the prerelease channel without changing `latest`.

```bash
pnpm test:published-release v3.0.0 .local-notes/published-stable
pnpm test:published-release v3.0.0-rc.1 .local-notes/published-rc
# An independent package release checks its own metadata/provenance and
# exercises it alongside the train versions recorded at that tag.
pnpm test:published-release remark-mark-highlight-v1.0.3 .local-notes/published-plugin
```

Use an existing tag and a checkout containing its full Git history. No workspace build
or dependency installation is required for these registry checks. The Node version
must satisfy the package engine range; `npm`, `pnpm`, `git` and `tar` must be available.
The independent plugin version comes from the tag's manifest, not a hardcoded version.
The `Verify published release` GitHub workflow provides the same read-only check for
an existing tag, without publishing or requiring a soak approval.

Verification checks npm channels, dependency and engine metadata, tarball SHA-512,
and provenance repository, workflow, source tag, commit and tarball subject. This is
provenance **content and source consistency** verification, not cryptographic Sigstore
signature verification. Reused plugin versions and publication retries retain their
original provenance invocation; the original source must be an ancestor with unchanged
package sources. Train packages additionally require unchanged package/lockfile inputs.
Do not require a reused artifact to name the current workflow run.

Registry visibility checks retry for up to 12 attempts, with 5 seconds between attempts
and a 30-second timeout per request. Persistent mismatches fail verification. The JSON
report records the target SHA, Node version, source invocations, hashes and results,
including partial results on failure. CI archives it as `published-release-verification`.
A retry can verify existing uploads and leave an existing published GitHub release intact.
When recovering an incomplete upload, run the release workflow from the release tag so
new provenance records that tag; never move a tag or overwrite an npm version.
Historical audits require the expected channel to still point at that version; once a
newer release advances the channel, the older audit intentionally fails its channel check.
