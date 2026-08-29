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
      // NOTE: `.storybook/` is deliberately NOT ignored. It holds the shared
      // decorators, the color-scheme context and the react-scan gate — real
      // code that the story files import, and that lint has to see.
      // Build output — companion to `3a1b045 chore: gitignore storybook-static/`,
      // which added the artifact dir to .gitignore but missed the eslint
      // config. Linting bundled JS produces tens of thousands of false-
      // positive errors against minified code.
      '**/storybook-static/**',
      // Stryker mutation-audit working copy + report output (one-off audit,
      // see packages/engine/stryker.conf.json).
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
  {
    // The benchmark runner is plain Node ESM, not TypeScript, so `no-undef`
    // applies to it (typescript-eslint turns that rule off for `.ts`, where
    // the compiler already answers it). These scripts legitimately use Node
    // and browser globals: `page.evaluate` bodies run in the page, so
    // `window` and `document` appear in source that Node never executes.
    files: ['benchmarks/runner/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Date: 'readonly',
        window: 'readonly',
        document: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  eslintConfigPrettier
);
