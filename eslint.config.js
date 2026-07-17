import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.storybook/**',
      // Build output — companion to `3a1b045 chore: gitignore storybook-static/`,
      // which added the artifact dir to .gitignore but missed the eslint
      // config. Linting bundled JS produces tens of thousands of false-
      // positive errors against minified code.
      '**/storybook-static/**',
      // Stryker mutation-audit working copy + report output (one-off audit,
      // see packages/core/stryker.conf.json).
      '**/.stryker-tmp/**',
      '**/reports/mutation/**',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  eslintConfigPrettier
);
