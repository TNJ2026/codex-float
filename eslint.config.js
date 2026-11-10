import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['node_modules/**', 'dist/**', '.tools/**', 'src-tauri/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: { react },
    rules: {
      ...js.configs.recommended.rules,
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // These expressions deliberately reject control characters in URLs and local paths.
      'no-control-regex': 'off',
    },
  },
  {
    files: ['src/rich-sandbox.js'],
    languageOptions: { globals: { mermaid: 'readonly', echarts: 'readonly' } },
  },
];
