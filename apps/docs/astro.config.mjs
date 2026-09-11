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
          items: [{ slug: 'docs', label: 'Overview' }, 'docs/guides/getting-started', 'docs/examples'],
        },
        {
          label: 'Shared guides',
          items: [
            'docs/guides',
            'docs/guides/cjk-typography',
            'docs/guides/content-preprocessors',
            'docs/guides/url-sanitization',
            'docs/guides/cross-chunk-coordination',
            'docs/guides/smooth-streaming',
            'docs/guides/streaming-cursor',
            'docs/guides/streaming-and-performance',
          ],
        },
        {
          label: 'React',
          items: [
            { slug: 'docs/react', label: 'Installation & API' },
            { slug: 'docs/react/mantine', label: 'Mantine integration' },
            'docs/guides/streaming-chat-example',
            'docs/guides/custom-components',
            'docs/guides/custom-typography',
            'docs/guides/design-tokens',
            'docs/guides/metadata-context',
            'docs/guides/typescript-generics',
            'docs/guides/extending-via-subpackage',
          ],
        },
        { label: 'Vue', items: [{ slug: 'docs/vue', label: 'Installation, slots & composables' }] },
        {
          label: 'Core / Engine',
          collapsed: true,
          items: [
            'docs/core',
            'docs/engine',
            'docs/guides/api/core-engine-contracts',
            'docs/guides/architecture',
            'docs/plugins/highlight',
          ],
        },
        {
          label: 'Migration & releases',
          collapsed: true,
          items: ['docs/guides/framework-transition', 'docs/guides/migrating-to-v2', 'docs/guides/release-highlights'],
        },
        {
          label: 'Contributing',
          collapsed: true,
          items: [
            'docs/guides/development-commands',
            'docs/guides/documentation-site',
            'docs/guides/storybook',
            'docs/guides/benchmark',
            'docs/guides/core-testing',
            'docs/guides/soak-coverage',
            'docs/guides/releasing-3.0',
          ],
        },
      ],
    }),
  ],
  markdown: {
    processor: unified({ rehypePlugins: [rehypeRaw, [repositoryLinks, { base, storybook: env.DOCS_STORYBOOK_URL }]] }),
  },
});
