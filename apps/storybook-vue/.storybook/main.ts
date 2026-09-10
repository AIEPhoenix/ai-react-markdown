import type { StorybookConfig } from '@storybook/vue3-vite';
const config: StorybookConfig = {
  framework: { name: '@storybook/vue3-vite', options: { docgen: 'vue-component-meta' } },
  viteFinal: (config) => ({
    ...config,
    define: {
      ...config.define,
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
  }),
  stories: ['../../../packages/vue/stories/**/*.mdx', '../../../packages/vue/stories/**/*.stories.ts'],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y', '@storybook/addon-docs'],
  staticDirs: ['../../../tooling/storybook-kit/assets'],
  tags: { qa: { excludeFromSidebar: Boolean(process.env.STORYBOOK_DOCS_EXPORT) } },
};
export default config;
