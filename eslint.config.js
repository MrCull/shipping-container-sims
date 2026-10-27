import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', '.smoke-dist/**', '.smoke-results/**'] },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  ...pluginVue.configs['flat/recommended'],

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  {
    files: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'src/**/*.smoke.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Terminal Twin engine, scenario and worker code must run in Node and a Web Worker:
  // no DOM, Vue, Three.js or Node built-ins.
  {
    files: [
      'src/sims/terminal-twin/engine/**/*.ts',
      'src/sims/terminal-twin/scenario/**/*.ts',
      'src/sims/terminal-twin/worker/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['vue', 'pinia', 'vue-router', 'three', 'three/*'], message: 'The Terminal Twin engine must stay UI-free.' },
            { group: ['node:*', 'fs', 'path', 'url', 'os', 'child_process'], message: 'The Terminal Twin engine must not use Node built-ins.' },
            { group: ['@/*', '**/cli/**'], message: 'The Terminal Twin engine may only import engine/ and scenario/ code.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'process'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use EngineContext.random() (seeded).' }],
    },
  },

  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/block-order': [
        'warn',
        { order: ['script', 'template', 'style'] },
      ],
    },
  },
)
