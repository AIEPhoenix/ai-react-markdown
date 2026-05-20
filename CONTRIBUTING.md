# Contributing to ai-react-markdown

Thanks for your interest in contributing. This file covers the practical "how" — for "what" and "why", see [`README.md`](./README.md) and the topic docs under [`docs/`](./docs/).

## Quick orientation

This is a **pnpm monorepo** with two packages:

- [`packages/core`](./packages/core) — framework-agnostic renderer (the heart).
- [`packages/mantine`](./packages/mantine) — Mantine UI integration (lives on top of core).

Source of truth for the public API surface, sanitization model, cross-chunk coordination, and block-level memoization invariants is in [`docs/`](./docs/). If you're touching internals, **read [`docs/architecture.md`](./docs/architecture.md) first**.

## Setup

```bash
git clone https://github.com/AIEPhoenix/ai-react-markdown.git
cd ai-react-markdown
pnpm install
pnpm build
```

You'll need:

- Node ≥ 20 (LTS recommended)
- pnpm 10.x (this repo pins via `packageManager` field — Corepack will fetch the right version)

## Daily workflow

```bash
# Run Storybook for interactive development
pnpm storybook

# Run tests once
pnpm --filter @ai-react-markdown/core test

# Typecheck
pnpm --filter @ai-react-markdown/core typecheck

# Lint / format
pnpm lint
pnpm format:check
pnpm format          # auto-fix
```

CI runs lint + format:check + typecheck + test + build on every PR.

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

## Larger changes

For anything that touches the rendering pipeline, sanitization model, or cross-chunk registry: **open a Discussion or Issue first**. These areas have walked-through design constraints (documented at the top of each implementation file); a quick design sync saves a lot of rework.

The `docs/architecture.md` overview is the orientation; the file-level JSDoc explains *why* each constraint exists.

## Code of Conduct

By participating in this project you agree to abide by the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).

## Releasing (maintainer-only)

```bash
# Version bumps live in scripts/version-packages.mjs
pnpm version-packages

# Publish to npm + cut a GitHub release
pnpm release
```

Tag pushes don't auto-create GitHub releases — they're created by hand from the npm version, with the changelog distilled from commits.

## Questions?

- Usage / how-do-I → [Discussions / Q&A](https://github.com/AIEPhoenix/ai-react-markdown/discussions/categories/q-a)
- Ideas / proposals → [Discussions / Ideas](https://github.com/AIEPhoenix/ai-react-markdown/discussions/categories/ideas)
- Bugs → [Issues](https://github.com/AIEPhoenix/ai-react-markdown/issues/new/choose)
- Security → [Private advisory](https://github.com/AIEPhoenix/ai-react-markdown/security/advisories/new)
