# Releasing 3.0

**3.0.0 is published.** Engine, core, React, React/Mantine and Vue are on npm `latest` at `3.0.0`; the independently versioned highlight plugin is `1.0.2`. The [stable release](https://github.com/ai-markdown/ai-markdown/releases/tag/v3.0.0) and its [release workflow](https://github.com/ai-markdown/ai-markdown/actions/runs/34494100859) completed successfully. Exact-version and default npm installs passed the published-consumer checks.

## Compatibility contract

- Public Node consumers require `^20.19.0 || >=22.12.0`. Earlier Node 20 versions fail when CJS output loads ESM dependencies. CI exercises Node 20.19.0, 22.12.0 and 24.20.0 with packed consumers.
- React requires React 19; Vue requires `^3.5.0`. Mantine integration follows its declared peer ranges and is React-only. Packed consumers exercise ESM/CJS, declarations, styles and React/Mantine/Vue SSR outside the workspace.
- Declaration snapshots cover engine, core, React, React plugins, Mantine and Vue. Documented public contracts follow semantic versioning from 3.0.0; breaking changes require a major release.
- The Vue browser suite covers hydration, references, updates, smooth streaming, cursor layout and unmount in Chromium, Firefox and WebKit. Forced-GC lifetime assertions remain Chromium-only. This does not establish Nuxt, KeepAlive or Suspense support.

## Candidate acceptance

For subsequent releases, use a new version and tag; the completed 3.0.0 release must not be republished.

1. Run `pnpm preflight` on the final source. It covers builds, lint, formatting, declarations, unit and control tests, tarballs, consumer integration, Storybook and browser/lifetime checks.
2. Require CI, including the packed consumer Node matrix and core contract job, to pass.
3. Commit a clean candidate and run `pnpm check:soak-impact`. Follow [soak coverage and approval](soak-coverage.md) when engine impact requires a campaign, and validate its evidence with `pnpm check:release-soak --evidence .soak-logs/<run-id>`. The current release profile covers all six legs and 84 logical tasks.
4. Tag the verified version. The release workflow must pass automated verification and, when required, human `soak-approval` review. Retain the reviewed evidence.
5. Use trusted publishing for existing packages. Prereleases use their corresponding `beta` or `rc` channel; stable releases use `latest`. The independent plugin follows its own version and channel. Leave bootstrap authentication disabled for existing packages.
6. Require post-publication registry and consumer verification. The workflow archives its report before creating the GitHub release; the read-only verification workflow can check an existing release again.

A local green run does not replace remote CI, published-artifact verification or required human review. Record actual run URLs and evidence identifiers after they exist.

## Stable promotion

The RC-to-3.0.0 promotion is complete. Stable changes relative to `3.0.0-rc.1` were limited to version metadata, stable peer ranges and documentation. There were no runtime-source changes. Mantine now declares the React adapter peer `^3.0.0`; core and engine remain exact train dependencies.

For a future promotion, install the published candidate in representative React, Mantine and Vue applications, record the runtime versions and SSR/hydration and streaming results, and allow a feedback period. Resolve candidate regressions first, choose a new stable version, update the train and integration peer ranges, and validate the resulting tarballs. Reassess soak impact for the final committed candidate. Stable releases use npm `latest` and a non-prerelease GitHub release. Preserve existing tags and artifacts; correct published defects with a new patch or candidate.

## Recorded RC acceptance and review exception

The fresh campaign `rc1-acceptance-20260910T102525Z-e575f03` tested clean commit `e575f03e6f940c21e0a3e0fc1ca30166752eaefb` with seed `202689100` and all 84 tasks. It passed in 10,917 seconds with `repositoryChanged: false`. Original reports remain in the maintainer's local archive.

Commit `2cdbf9a4be93fc5eaf62c3c1b27b6de276048bc8` fixed ANSI normalization in the evidence aggregator and added colored-verdict regression tests. All 37 soak control tests passed at that candidate. The corrected aggregator accepted the original reports unchanged, while the conservative candidate-coverage gate still rejected ancestor evidence because the aggregator mechanism changed.

On 2026-09-10 the maintainer explicitly authorized accepting that ancestor campaign through human review. The replacement run was interrupted and was not passing evidence. This was a narrow exception for the ANSI verdict-parsing fix; it did not change future impact rules or the required-reviewer environment.

The [RC release workflow](https://github.com/ai-markdown/ai-markdown/actions/runs/34491579512) completed successfully after human review. All five `3.0.0-rc.1` packages and plugin `1.0.2` were published through OIDC. Published tarballs passed integrity and provenance-source consistency checks, ESM/CJS, React/Mantine/Vue SSR, CSS, declarations and Vue 3.5.0 consumption. The subsequent stable workflow completed publication and verification for `3.0.0`.

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
