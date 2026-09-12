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
        Head: './src/components/Head.astro',
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
          translations: { 'zh-CN': '从这里开始' },
          items: [
            { slug: 'docs', label: 'Overview', translations: { 'zh-CN': '概览' } },
            {
              slug: 'docs/guides/getting-started',
              label: 'Packages & requirements',
              translations: { 'zh-CN': '包与环境要求' },
            },
            'docs/guides/markdown-features',
            'docs/examples',
          ],
        },
        {
          label: 'Concepts',
          translations: { 'zh-CN': '核心概念' },
          items: [
            'docs/guides/streaming-input',
            'docs/guides/documents-and-references',
            'docs/guides/rendering-and-performance',
          ],
        },
        {
          label: 'React',
          translations: { 'zh-CN': 'React' },
          collapsed: true,
          items: [
            { slug: 'docs/guides/react-quick-start', label: 'Quick start', translations: { 'zh-CN': '快速开始' } },
            {
              slug: 'docs/guides/streaming-chat-example',
              label: 'Streaming chat',
              translations: { 'zh-CN': '流式聊天' },
            },
            {
              slug: 'docs/guides/smooth-streaming',
              label: 'Smooth streaming',
              translations: { 'zh-CN': '平滑流式输出' },
            },
            { slug: 'docs/guides/streaming-cursor', label: 'Cursor', translations: { 'zh-CN': '光标' } },
            {
              slug: 'docs/guides/cross-chunk-coordination',
              label: 'Documents & references',
              translations: { 'zh-CN': '文档与引用' },
            },
            {
              slug: 'docs/guides/custom-components',
              label: 'Custom rendering',
              translations: { 'zh-CN': '自定义渲染' },
            },
            { slug: 'docs/guides/metadata-context', label: 'Metadata', translations: { 'zh-CN': '元数据' } },
            { slug: 'docs/guides/custom-typography', label: 'Typography', translations: { 'zh-CN': '排版' } },
            { slug: 'docs/guides/design-tokens', label: 'CSS tokens', translations: { 'zh-CN': 'CSS 设计变量' } },
            { slug: 'docs/guides/typescript-generics', label: 'TypeScript', translations: { 'zh-CN': 'TypeScript' } },
            { slug: 'docs/guides/streaming-and-performance', label: 'Performance', translations: { 'zh-CN': '性能' } },
            { slug: 'docs/guides/react-ssr', label: 'SSR & hydration', translations: { 'zh-CN': 'SSR 与水合' } },
            { slug: 'docs/guides/api/react-props', label: 'Props', translations: { 'zh-CN': '属性' } },
            { slug: 'docs/react', label: 'Components & types', translations: { 'zh-CN': '组件与类型' } },
            {
              slug: 'docs/guides/api/react-hooks',
              label: 'Hooks & providers',
              translations: { 'zh-CN': 'Hooks 与 Provider' },
            },
          ],
        },
        {
          label: 'Vue',
          translations: { 'zh-CN': 'Vue' },
          collapsed: true,
          items: [
            { slug: 'docs/guides/vue-quick-start', label: 'Quick start', translations: { 'zh-CN': '快速开始' } },
            { slug: 'docs/guides/vue-streaming', label: 'Streaming', translations: { 'zh-CN': '流式渲染' } },
            {
              slug: 'docs/guides/vue-documents',
              label: 'Documents & references',
              translations: { 'zh-CN': '文档与引用' },
            },
            {
              slug: 'docs/guides/vue-customization',
              label: 'Custom rendering & styling',
              translations: { 'zh-CN': '定制与样式' },
            },
            { slug: 'docs/guides/vue-ssr', label: 'SSR & lifecycle', translations: { 'zh-CN': 'SSR 与生命周期' } },
            { slug: 'docs/vue', label: 'API reference', translations: { 'zh-CN': 'API 参考' } },
          ],
        },
        {
          label: 'Mantine (React)',
          translations: { 'zh-CN': 'Mantine（React）' },
          collapsed: true,
          items: [
            {
              slug: 'docs/guides/react-mantine-quick-start',
              label: 'Quick start',
              translations: { 'zh-CN': '快速开始' },
            },
            {
              slug: 'docs/guides/mantine-code-blocks',
              label: 'Code blocks & diagrams',
              translations: { 'zh-CN': '代码块与图表' },
            },
            { slug: 'docs/react/mantine', label: 'API reference', translations: { 'zh-CN': 'API 参考' } },
          ],
        },
        {
          label: 'Advanced',
          translations: { 'zh-CN': '进阶' },
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
            {
              slug: 'docs/guides/extending-via-subpackage',
              label: 'Build a React integration',
              translations: { 'zh-CN': '开发 React 集成' },
            },
          ],
        },
        {
          label: 'Contributing',
          translations: { 'zh-CN': '参与贡献' },
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
          translations: { 'zh-CN': '发布与迁移' },
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
