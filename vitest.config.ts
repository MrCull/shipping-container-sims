import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Only this checkout's sources (never .claude/worktrees/*).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
