import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'

const GOD_MODE_HOTKEY = {
  group: ['**/useGodModeHotkey'],
  message: 'Do not mount useGodModeHotkey in Terminal Twin: it clashes with the D/O shortcuts.',
}
const ENGINE_BARREL_ONLY = {
  group: ['**/engine/**', '!**/engine/index'],
  message: 'Import Terminal Twin engine code only from engine/index.ts (the public API).',
}
const ENGINE_PURITY = [
  { group: ['vue', 'pinia', 'vue-router', 'three', 'three/*'], message: 'The Terminal Twin engine must stay UI-free.' },
  { group: ['node:*', 'fs', 'path', 'url', 'os', 'child_process'], message: 'The Terminal Twin engine must not use Node built-ins.' },
  { group: ['@/*', '**/cli/**'], message: 'The Terminal Twin engine may only import engine/ and scenario/ code.' },
]

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', '.claude/**', '.smoke-dist/**', '.smoke-results/**'] },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  ...pluginVue.configs['flat/recommended'],

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Injected by Vite `define` (vite.config.ts), typed in env.d.ts.
        __BUILD_TIME__: 'readonly',
        __BUILD_COMMIT__: 'readonly',
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

  // Terminal Twin restricted imports. Flat config replaces a rule's options block by block (the last matching
  // block wins), so every block below lists all the patterns that apply to its files.
  // - Everyone: no useGodModeHotkey (it clashes with the D/O shortcuts).
  // - Everyone outside engine/ and scenario/: import the engine only through engine/index.ts.
  // - engine/, scenario/ and worker/: no DOM, Vue, Three.js or Node built-ins.
  {
    files: ['src/sims/terminal-twin/**/*.{ts,vue}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [GOD_MODE_HOTKEY, ENGINE_BARREL_ONLY] }] },
  },
  {
    files: ['src/sims/terminal-twin/engine/**/*.ts', 'src/sims/terminal-twin/scenario/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [GOD_MODE_HOTKEY, ...ENGINE_PURITY] }] },
  },
  {
    files: ['src/sims/terminal-twin/worker/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [GOD_MODE_HOTKEY, ENGINE_BARREL_ONLY, ...ENGINE_PURITY] }] },
  },
  {
    files: ['src/sims/terminal-twin/engine/**/*.ts', 'src/sims/terminal-twin/scenario/**/*.ts', 'src/sims/terminal-twin/worker/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'process'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use EngineContext.random() (seeded).' }],
    },
  },

  // Spawning 'npx'/'npm' by name fails on Windows (no shell, the shims are .cmd files): run Node binaries
  // through process.execPath, e.g. [process.execPath, '--import', 'tsx', entry].
  {
    files: ['**/*.{ts,mjs}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name=/^(execFileSync|execFile|spawnSync|spawn)$/][arguments.0.value=/^(npx|npm|pnpm)$/]",
          message: "Do not spawn npx/npm/pnpm by name (ENOENT on Windows). Use process.execPath with the tool's JS entry.",
        },
      ],
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
