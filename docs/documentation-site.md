# Documentation site

The independent documentation site uses [Astro Starlight](https://starlight.astro.build/getting-started/) in the private `apps/docs` workspace. React and Vue have separate API entries; Mantine is a React integration. Shared concepts and Core / Engine contracts have their own navigation groups. The initial site uses the repository's English content.

## Run and build

Use the repository's pinned Node and pnpm versions, then run:

```bash
pnpm install
pnpm dev:docs          # Astro development server, normally http://localhost:4321
pnpm check:docs    # Astro content/configuration diagnostics
pnpm build:docs    # Static output in apps/docs/dist, including Pagefind search
pnpm test:docs     # Link transformation tests and built-site link/anchor checks
pnpm preview:docs  # Serve the production build locally
```

No renderer package build is required. The site renders documentation and code excerpts; Storybook remains responsible for live framework examples. Search is generated during the production build; verify it with `pnpm preview:docs`.

## One source per document

- `docs/*.md` and `docs/api/*.md` remain the canonical usage, architecture and maintenance guides.
- Package READMEs remain the canonical package installation and API references, including the independently versioned highlight plugin.
- `apps/docs/content/` owns the documentation overview, example directory and optional translations. The standalone English homepage lives in `apps/docs/src/pages/index.astro`.
- `apps/docs/scripts/content.mjs` maps these sources to routes and generates Starlight frontmatter with an edit link to the original file.
- `apps/docs/src/content/docs/` is generated and ignored by Git. Do not edit it. Development watches canonical sources and regenerates changed pages, including additions and deletions.

Guides retain their existing framework scope. A shared navigation group does not make React hooks, typography tokens or Mantine providers into Vue APIs. Follow each guide's Vue links for Vue-specific integration.

New top-level guides and API guides are included automatically. Add their navigation entries in `apps/docs/astro.config.mjs`. Internal planning/review directories are excluded. Retained release history is identified by version and is separate from current integration guidance.

## Links and deployment paths

Rendered Markdown links, reference links and raw HTML links to included documents become site routes. Source-code links remain GitHub links. Absolute GitHub `blob/main` links to included documents also become site routes. Code blocks are never rewritten. Edit links always target canonical sources.

Configure a static deployment through environment variables at build time:

| Variable             | Purpose                                                                | Default                                         |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| `DOCS_SITE_URL`      | Absolute site origin for canonical URLs and sitemap generation         | Unset for local development                     |
| `DOCS_BASE`          | URL path prefix, such as `/preview/`                                   | `/`                                             |
| `DOCS_STORYBOOK_URL` | Matching Storybook composition root, with `react/` and `vue/` children | Example links open local Storybook instructions |

```bash
DOCS_SITE_URL=https://docs.example.com DOCS_BASE=/preview/ pnpm build:docs
DOCS_BASE=/preview/ pnpm test:docs
```

Upload all of `apps/docs/dist/` together. Its HTML, assets and Pagefind index are one build. Configure the host's not-found page using `404.html`; this is a static multi-page site, so do not rewrite every unknown path to the homepage. The repository CI builds and checks the documentation under a prefix and retains the static artifact.

The optional Sites configuration in `apps/docs/.openai/hosting.json` identifies the private preview. It does not define the project's public documentation domain. Until a public domain is selected, existing Storybook-to-guide links retain working GitHub destinations; do not point public catalogs at an owner-only preview.

## Homepage, themes and languages

The site root `/` is a standalone project homepage. `/docs/` is the documentation overview, and guides and package references live below that path (for example `/docs/react/` and `/docs/guides/getting-started/`). `DOCS_BASE` remains an optional deployment prefix for the whole site, so `/preview/` produces `/preview/` and `/preview/docs/`.

The shared header provides Docs navigation, search, a language menu and Starlight's Auto / Light / Dark selector on both the homepage and documentation pages. Auto follows the system color scheme; explicit choices persist across navigation and reloads. The language menu currently contains only English.

Language configuration lives in `apps/docs/src/i18n/config.mjs`. English is the `root` locale, so English URLs have no `/en/` prefix. Custom navigation translations live in `apps/docs/src/content/i18n/en.json`; Starlight supplies the standard UI translations.

To add another documentation language, add its locale configuration and translated guides under `apps/docs/content/translations/<locale>/`, mirroring the canonical repository paths (for example `fr/docs/getting-started.md` or `fr/packages/vue/README.md`). Keep the leading H1 and the original source-relative links. Generated pages use `/<locale>/docs/...`; missing translations use Starlight's English fallback. The language selector automatically switches to Starlight's multilingual selector once another locale is enabled. Localized homepage content and its route must be added before publishing that locale; the initial homepage is English only.

## GitHub Pages

`.github/workflows/pages.yml` builds the homepage, documentation and composed Storybook from the same commit. Pull requests validate and upload the assembled artifact; pushes to `main` and manual runs on `main` also deploy it. PR artifacts are downloadable builds, not hosted PR preview URLs.

Enable **Settings → Pages → Build and deployment → GitHub Actions**. `actions/configure-pages` supplies the actual origin and base path, including a configured custom domain. No domain is hardcoded in the workflow. On the default project URL, the homepage is `/ai-markdown/`, documentation is `/ai-markdown/docs/`, and examples are `/ai-markdown/storybook/`.

Reproduce the combined build from the repository root:

```bash
export DOCS_SITE_URL=https://ai-markdown.github.io
export DOCS_BASE=/ai-markdown/
export DOCS_STORYBOOK_URL=https://ai-markdown.github.io/ai-markdown/storybook/
pnpm check:docs
pnpm build:docs
STORYBOOK_DOCS_EXPORT=1 pnpm build:storybook
pnpm test:storybook:site
pnpm assemble:pages
DOCS_DIST=_site pnpm test:docs
```

`_site/` is ignored and contains the docs build at its root and the entire Storybook build in `storybook/`. The link check validates documentation links against this assembled directory, including same-origin links into the React and Vue catalogs. Pages receives one artifact only after both builds and their checks pass. Never deploy the docs and Storybook separately to the same Pages site: each deployment replaces the site's artifact.

## Organization root website

The public homepage is **`https://ai-markdown.github.io/`**. Its publishing repository is `ai-markdown/ai-markdown.github.io`, as required for GitHub organization sites. That repository calls this repository's reusable Pages workflow and checks out application source from `ai-markdown/ai-markdown`. It checks for source changes approximately every 15 minutes (scheduled runs may be delayed); manual dispatch publishes immediately. No cross-repository write credential is stored.

The organization deployment uses `/` as its base: `/docs/` contains documentation, `/examples/` embeds the full Storybook UI with framework switches, and `/storybook/` remains available for direct links and standalone use. The existing project deployment under `/ai-markdown/` remains a working mirror. Both deployments derive their base from their own Pages settings.
