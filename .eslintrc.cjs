module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['main.js', 'release/**', 'node_modules/**'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    '@typescript-eslint/require-await': 'error',
    'no-alert': 'error',
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'Use requestUrl instead of fetch in Obsidian plugins.' },
      { name: 'confirm', message: 'Use an Obsidian modal instead of confirm().' },
      { name: 'alert', message: 'Use Notice or a modal instead of alert().' },
    ],
    'no-restricted-properties': [
      'error',
      {
        property: 'innerHTML',
        message: 'Do not write to innerHTML. Build DOM using createEl.',
      },
      {
        property: 'outerHTML',
        message: 'Do not write to outerHTML. Build DOM using createEl.',
      },
      {
        property: 'style',
        message: 'Do not set inline styles directly. Use CSS classes or setCssProps.',
      },
    ],
  },
};
