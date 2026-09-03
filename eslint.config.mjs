import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.wxt/**',
      '**/.output/**',
      'release/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      'demo/assets/judge/**',
      '**/.venv/**',
      'eslint.config.mjs',
      'scripts/compact-chrome-release.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.js', '**/*.mjs'],
  },
  {
    files: ['demo/**/*.js'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },
  {
    files: ['extension/**/*.ts', 'extension/**/*.tsx'],
    ignores: ['extension/lib/network/**', 'extension/tests/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Route agent traffic through privacyGateway.ts.' },
        { name: 'XMLHttpRequest', message: 'Raw network APIs are forbidden outside the gateway.' },
        { name: 'WebSocket', message: 'Raw network APIs are forbidden outside the gateway.' },
      ],
    },
  },
);
