// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'firmware/**',
      'apps/mobile/.expo/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Tests assert on loosely typed HTTP response bodies.
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Node CommonJS: config files and build scripts. These run under `node`
    // directly, so CommonJS and the Node globals are correct here.
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Build scripts report progress and failures on the console; that output
    // is the point, not a stray debug statement.
    files: ['**/scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // The mobile app runs in React Native, not Node. Its globals are the
    // browser-shaped ones the runtime provides.
    files: ['apps/mobile/**/*.ts', 'apps/mobile/**/*.tsx'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
        process: 'readonly',
      },
    },
  },
  prettier,
);
