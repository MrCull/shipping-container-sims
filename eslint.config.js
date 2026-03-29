import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**'] },

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
    files: ['vite.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
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
