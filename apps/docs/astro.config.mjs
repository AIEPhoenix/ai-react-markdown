import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import rehypeRaw from 'rehype-raw';
import starlight from '@astrojs/starlight';
import { env } from 'node:process';
import { locales } from './src/i18n/config.mjs';
import { contentIntegration } from './scripts/content.mjs';
import { normalizeBase, repositoryLinks } from './scripts/links.mjs';

const base = normalizeBase(env.DOCS_BASE);
export default defineConfig({
  site: env.DOCS_SITE_URL,
  base,
  trailingSlash: 'always',
  integrations: [
    contentIntegration(),
    starlight({
      title: 'AI Markdown',
      favicon: '/brand/organization-mark.png',
      defaultLocale: 'root',
      locales,
      components: {
        Header: './src/components/Header.astro',
        Hero: './src/components/Hero.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        LanguageSelect: './src/components/LanguageSelect.astro',
      },
      description: 'Markdown rendering for React and Vue: installation, streaming, customization and adapter APIs.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ai-markdown/ai-markdown' }],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { slug: 'docs', label: 'Overview' },
            { slug: 'docs/guides/getting-started', label: 'Packages & requirements' },
            'docs/guides/markdown-features',
            'docs/examples',
          ],
        },
        {
          label: 'Concepts',
          items: [
            'docs/guides/streaming-input',
            'docs/guides/documents-and-references',
            'docs/guides/rendering-and-performance',
          ],
        },
        {
          label: 'React',
          collapsed: true,
          items: [
            { slug: 'docs/guides/react-quick-start', label: 'Quick start' },
            { slug: 'docs/guides/streaming-chat-example', label: 'Streaming chat' },
            { slug: 'docs/guides/smooth-streaming', label: 'Smooth streaming' },
            { slug: 'docs/guides/streaming-cursor', label: 'Cursor' },
            { slug: 'docs/guides/cross-chunk-coordination', label: 'Documents & references' },
            { slug: 'docs/guides/custom-components', label: 'Custom rendering' },
            { slug: 'docs/guides/metadata-context', label: 'Metadata' },
            { slug: 'docs/guides/custom-typography', label: 'Typography' },
            { slug: 'docs/guides/design-tokens', label: 'CSS tokens' },
            { slug: 'docs/guides/typescript-generics', label: 'TypeScript' },
            { slug: 'docs/guides/streaming-and-performance', label: 'Performance' },
            { slug: 'docs/guides/react-ssr', label: 'SSR & hydration' },
            { slug: 'docs/guides/api/react-props', label: 'Props' },
            { slug: 'docs/react', label: 'Components & types' },
            { slug: 'docs/guides/api/react-hooks', label: 'Hooks & providers' },
          ],
        },
        {
          label: 'Vue',
          collapsed: true,
          items: [
            { slug: 'docs/guides/vue-quick-start', label: 'Quick start' },
            { slug: 'docs/guides/vue-streaming', label: 'Streaming' },
            { slug: 'docs/guides/vue-documents', label: 'Documents & references' },
            { slug: 'docs/guides/vue-customization', label: 'Custom rendering & styling' },
            { slug: 'docs/guides/vue-ssr', label: 'SSR & lifecycle' },
            { slug: 'docs/vue', label: 'API reference' },
          ],
        },
        {
          label: 'Mantine (React)',
          collapsed: true,
          items: [
            { slug: 'docs/guides/react-mantine-quick-start', label: 'Quick start' },
            { slug: 'docs/guides/mantine-code-blocks', label: 'Code blocks & diagrams' },
            { slug: 'docs/react/mantine', label: 'API reference' },
          ],
        },
        {
          label: 'Advanced',
          collapsed: true,
          items: [
            'docs/guides/troubleshooting',
            'docs/guides/content-preprocessors',
            'docs/guides/cjk-typography',
            'docs/guides/url-sanitization',
            'docs/core',
            'docs/engine',
            'docs/guides/api/core-engine-contracts',
            'docs/guides/building-an-adapter',
            'docs/plugins/highlight',
            { slug: 'docs/guides/extending-via-subpackage', label: 'Build a React integration' },
          ],
        },
        {
          label: 'Contributing',
          collapsed: true,
          items: [
            'docs/guides/development-commands',
            'docs/guides/architecture',
            'docs/guides/documentation-site',
            'docs/guides/storybook',
            'docs/guides/benchmarking',
            'docs/guides/core-testing',
            'docs/guides/soak-coverage',
            'docs/guides/releasing',
          ],
        },
        {
          label: 'Releases & migration',
          collapsed: true,
          items: [
            'docs/guides/release-highlights',
            'docs/guides/framework-transition',
            'docs/guides/migrating-to-v2',
            'docs/guides/releasing-3.0',
            'docs/guides/benchmark',
          ],
        },
      ],
    }),
  ],
  markdown: {
    processor: unified({ rehypePlugins: [rehypeRaw, [repositoryLinks, { base, storybook: env.DOCS_STORYBOOK_URL }]] }),
  },
});
