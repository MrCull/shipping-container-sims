import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

/** Short commit hash for the main-menu build stamp; "" when git is unavailable (the stamp then shows time only). */
function shortCommit(): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (/^[0-9a-f]{7,40}$/.test(out)) return out
  } catch {
    // no git binary or not a checkout: fall through to CI env
  }
  const sha = process.env.GITHUB_SHA ?? ''
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : ''
}

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(shortCommit()),
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // ES-module workers (Terminal Twin's engine worker); the default iife breaks if a worker code-splits.
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) {
            return 'three'
          }
        },
      },
    },
  },
})
