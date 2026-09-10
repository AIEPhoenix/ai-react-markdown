import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/*.mdx'],
  addons: ['@storybook/addon-docs'],
  refs: {
    react: {
      title: 'React',
      url: process.env.STORYBOOK_REACT_URL ?? (process.env.STORYBOOK_BUILD ? './react' : 'http://localhost:6007'),
    },
    vue: {
      title: 'Vue',
      url: process.env.STORYBOOK_VUE_URL ?? (process.env.STORYBOOK_BUILD ? './vue' : 'http://localhost:6008'),
    },
  },
};
export default config;
