# Contributing to ai-react-markdown

Thanks for your interest in contributing. This file covers the practical "how" — for "what" and "why", see [`README.md`](./README.md) and the topic docs under [`docs/`](./docs/).

## Quick orientation

This is a **pnpm monorepo** with four packages:

- [`packages/engine`](./packages/engine) — the Markdown engine: incremental parsing, LaTeX preprocessing, the definition/footnote machinery, and the unified plugin pipeline. No React anywhere in its tree.
- [`packages/core`](./packages/core) — the React renderer built on the engine (the public entry point most users install).
- [`packages/mantine`](./packages/mantine) — Mantine UI integration (lives on top of core).
- [`packages/remark-mark-highlight`](./packages/remark-mark-highlight) — standalone `==highlight==` remark plugin, published on its own semver track.

The engine/core line is where most orientation mistakes happen. **Anything that turns Markdown text into a hast tree belongs in the engine; anything that turns a hast tree into React belongs in core.** If a change needs `useState`, a context, or a DOM node, it is core-side by construction. `core` depends on `engine` at an exact version (pnpm rewrites `workspace:*` to the published version), so the two always ship in lockstep.

Source of truth for the public API surface, sanitization model, cross-chunk coordination, and block-level memoization invariants is in [`docs/`](./docs/). If you're touching internals, **read [`docs/architecture.md`](./docs/architecture.md) first** — its module-layout tree shows which package owns which file.

## Setup

```bash
git clone https://github.com/AIEPhoenix/ai-react-markdown.git
cd ai-react-markdown
pnpm install
pnpm build
```

You'll need:

- Node ≥ 20 (LTS recommended)
- pnpm 11.x (this repo pins the exact version via the `packageManager` field — Corepack, or pnpm itself, will fetch it)

> pnpm settings live in `pnpm-workspace.yaml`, not in a `pnpm` field in `package.json` — pnpm 11 ignores that field. `pnpm check:overrides` fails the build if one reappears, or if the lockfile no longer matches the declared overrides.

## Daily workflow

```bash
# Run Storybook for interactive development
pnpm storybook

# Run tests once — one package, or `pnpm -r test` for all of them
pnpm --filter @ai-react-markdown/core test
pnpm --filter @ai-react-markdown/engine test

# Typecheck
pnpm -r typecheck

# Lint / format
pnpm lint
pnpm format:check
pnpm format          # auto-fix

# Everything CI checks, in one command
pnpm preflight
```

CI runs lint + format:check + typecheck + test + build on every PR.

### Changing the incremental-parse engine

`packages/engine` carries its own falsification suites on top of the unit tests, because the splice path's contract (a spliced tree is deep-equal, positions included, to a full parse of the same content) cannot be covered by examples alone. Run these when you touch `spliceParse`, the boundary scanner, or the definition machinery:

```bash
# Fast feedback: the splice fuzz suite on its own
pnpm --filter @ai-react-markdown/engine fuzz:splice

# Release gate: the five-leg soak (fuzz + direction battery + def-label scanner
# + bounded-exhaustive census + P1 conformance under ORACLE_RAW=1). The seed base
# is REQUIRED and must be fresh — an old seed re-walks a space that already
# passed. The script re-execs itself under `caffeinate`; note that caffeinate
# does not survive a lid close.
./scripts/soak/fiveleg.sh <fresh-seed-base> [label]
```

A green soak is a **release** gate, not a per-PR one; CI does not run it. If your PR changes engine behavior, say in the description whether you ran it and what the result was.

## Branching & PRs

- Branch off `main`. Name your branch `<type>/<short-desc>` — e.g. `fix/cross-chunk-orphan-defs`, `docs/typescript-generics-example`.
- Keep PRs small and focused. If you find yourself doing two unrelated changes, that's usually two PRs.
- Use [Conventional Commits](https://www.conventionalcommits.org/)-style messages where reasonable: `fix(core): …`, `feat(mantine): …`, `docs: …`, `chore: …`. We're not strict — clarity over format.

## What makes a good PR

- **Test coverage for behavior changes.** New behavior gets new tests; bug fixes get regression tests. The `byteEquivalence.test.tsx` harness exists to catch silent drift between code paths — leverage it.
- **Reference stability discipline.** Anything that participates in the block-memo cache (`customComponents`, `urlTransform`, `sanitizeSchema`, `contentPreprocessors`, `config`) must be safe under inline / module-scope / `useMemo`. See [`docs/streaming-and-performance.md`](./docs/streaming-and-performance.md).
- **Docs updates.** If your PR changes public API or visible behavior, update the relevant doc(s):
  - Props / config → root `README.md` + `packages/<pkg>/README.md` + JSDoc.
  - Mechanism / invariant → relevant file under `docs/`.
  - Notable release-level changes → `docs/release-highlights.md`.
- **No new dependencies without a reason.** Each `package.json` dep adds bundle weight and supply-chain surface. Justify them in the PR description.

## Style

- We use Prettier + ESLint configured at the repo root. Run `pnpm format` before pushing.
- TypeScript strict mode is on. Don't loosen it locally to make a PR pass.
- No emojis in source or docs unless explicitly requested.
- For JSDoc on public API, include a `Why` / `Recommended pattern` / `Footguns` triplet when the surface is non-trivial — this is the convention readers expect.

## Dev-only gates (warnings, invariant checks)

Write the **bare** text — `if (process.env.NODE_ENV !== 'production') { ... }` —
at module scope or in function bodies alike. Never wrap it in a
`typeof process !== 'undefined'` guard: Vite substitutes only the bare text, so
the guard evaluates `'undefined'` in bundler browser dev and silently disables
the gate exactly where it matters (this bug shipped once; see the history note
in `useReferenceFlipWarning.ts`).

What makes the bare text safe everywhere: `process.env.NODE_ENV` is resolved at
**build time**. Both entries of core's `tsup.config.ts` — and both entries of
engine's, which repeats the arrangement for the same reason — carry
`env: { NODE_ENV: ... }`. Those keys are **load-bearing**; removing any of them
would ship a dist that evaluates `process.env` at import and crashes no-bundler
consumers (browser native ESM/CDN, Deno). The build fails if that ever regresses:
each package's `scripts/assert-dist-clean.mjs` greps its emitted artifacts for
`process.env` after every build.

## Larger changes

For anything that touches the rendering pipeline, sanitization model, or cross-chunk registry: **open a Discussion or Issue first**. These areas have walked-through design constraints (documented at the top of each implementation file); a quick design sync saves a lot of rework.

The `docs/architecture.md` overview is the orientation; the file-level JSDoc explains _why_ each constraint exists.

## Code of Conduct

By participating in this project you agree to abide by the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).

## Releasing (maintainer-only)

Releases publish from CI via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC — no token secret anywhere) with provenance attached automatically. Pushing a `v*` tag triggers `.github/workflows/release.yml`, which re-runs the full quality gate (lint, format, typecheck, tests, build), verifies the tag matches `package.json`, and publishes every package whose version is not yet on the registry (`pnpm publish -r` skips the rest). Packages on an independent semver track — `remark-mark-highlight` — either ride the train tag when their version was bumped, or get released alone via a `<pkg>-vX.Y.Z` tag:

```bash
# Sync versions across the monorepo (also rewrites README version refs)
pnpm version-packages X.Y.Z && pnpm install

git commit -am "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

Run `pnpm preflight` before tagging to catch gate failures locally — it is the same check suite the workflow runs, minus the publish. There is deliberately no local publish path: a local `npm publish` cannot attach provenance, so publishing happens only via the tag flow.

The workflow also creates the GitHub release, with notes taken from the version's section in `docs/release-highlights.md` — write that section before tagging (it falls back to auto-generated notes otherwise).

## Questions?

- Usage / how-do-I → [Discussions / Q&A](https://github.com/AIEPhoenix/ai-react-markdown/discussions/categories/q-a)
- Ideas / proposals → [Discussions / Ideas](https://github.com/AIEPhoenix/ai-react-markdown/discussions/categories/ideas)
- Bugs → [Issues](https://github.com/AIEPhoenix/ai-react-markdown/issues/new/choose)
- Security → [Private advisory](https://github.com/AIEPhoenix/ai-react-markdown/security/advisories/new)
