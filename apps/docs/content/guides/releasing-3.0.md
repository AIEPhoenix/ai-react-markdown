# 3.0 release acceptance record

**Historical record:** this page records the original `3.0.0` promotion and its acceptance evidence. Use [Releasing](releasing.md) for the current procedure. At that promotion, engine, core, React, React/Mantine and Vue were published to npm `latest` at `3.0.0`; the independently versioned highlight plugin was `1.0.2`. This is not a statement of today’s npm channel. See [release highlights](release-highlights.md) for subsequent releases. The [stable release](https://github.com/ai-markdown/ai-markdown/releases/tag/v3.0.0) and its [release workflow](https://github.com/ai-markdown/ai-markdown/actions/runs/34494100859) completed successfully. Exact-version and default npm installs passed the published-consumer checks.

## Compatibility contract

- Public Node consumers require `^20.19.0 || >=22.12.0`. Earlier Node 20 versions fail when CJS output loads ESM dependencies. CI exercises Node 20.19.0, 22.12.0 and 24.20.0 with packed consumers.
- React requires React 19; Vue requires `^3.5.0`. Mantine integration follows its declared peer ranges and is React-only. Packed consumers exercise ESM/CJS, declarations, styles and React/Mantine/Vue SSR outside the workspace.
- Declaration snapshots cover engine, core, React, React plugins, Mantine and Vue. Documented public contracts follow semantic versioning from 3.0.0; breaking changes require a major release.
- The Vue browser suite covers hydration, references, updates, smooth streaming, cursor layout and unmount in Chromium, Firefox and WebKit. Forced-GC lifetime assertions remain Chromium-only. This does not establish Nuxt, KeepAlive or Suspense support.

## Candidate acceptance

Use the [current candidate acceptance procedure](releasing.md#candidate-acceptance). The completed 3.0.0 release must not be republished.

## Stable promotion

The RC-to-3.0.0 promotion is complete. Stable changes relative to `3.0.0-rc.1` were limited to version metadata, stable peer ranges and documentation. There were no runtime-source changes. At that promotion, Mantine declared the React adapter peer `^3.0.0`; core and engine remain exact train dependencies.

For subsequent promotions, follow [Releasing](releasing.md#promote-a-candidate).

## Recorded RC acceptance and review exception

The fresh campaign `rc1-acceptance-20260910T102525Z-e575f03` tested clean commit `e575f03e6f940c21e0a3e0fc1ca30166752eaefb` with seed `202689100` and all 84 tasks. It passed in 10,917 seconds with `repositoryChanged: false`. Original reports remain in the maintainer's local archive.

Commit `2cdbf9a4be93fc5eaf62c3c1b27b6de276048bc8` fixed ANSI normalization in the evidence aggregator and added colored-verdict regression tests. All 37 soak control tests passed at that candidate. The corrected aggregator accepted the original reports unchanged, while the conservative candidate-coverage gate still rejected ancestor evidence because the aggregator mechanism changed.

On 2026-09-10 the maintainer explicitly authorized accepting that ancestor campaign through human review. The replacement run was interrupted and was not passing evidence. This was a narrow exception for the ANSI verdict-parsing fix; it did not change future impact rules or the required-reviewer environment.

The [RC release workflow](https://github.com/ai-markdown/ai-markdown/actions/runs/34491579512) completed successfully after human review. All five `3.0.0-rc.1` packages and plugin `1.0.2` were published through OIDC. Published tarballs passed integrity and provenance-source consistency checks, ESM/CJS, React/Mantine/Vue SSR, CSS, declarations and Vue 3.5.0 consumption. The subsequent stable workflow completed publication and verification for `3.0.0`.

## Repeatable published-artifact verification

Use the [current verification procedure](releasing.md#repeatable-published-artifact-verification). Old tags intentionally fail the channel check once a newer release advances that channel.
