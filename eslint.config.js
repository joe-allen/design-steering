import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/',
      'src-tauri/target/',
      'src-tauri/gen/',
      'src-tauri/resources/scripts/',
      'openspec/',
      '.agents/',
      '*-design-critique/',
      '*-design-critique-*/',
    ],
  },
  js.configs.recommended,
  ...svelte.configs.recommended,
  ...svelte.configs.prettier,
  {
    files: ['src/**/*.{js,svelte}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
];
