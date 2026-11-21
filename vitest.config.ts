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
    // Heavy engine runs (TTI preset, goldens, benchmarks) exceed the 5 s default when the machine is busy (parallel agents, CI).
    testTimeout: 60_000,
    // Every CPU, not vitest's default of all but one: the main process is idle while files run, so on the 4-vCPU CI
    // runner four forks beat three (measured #324: 185 s to 144 s locally on 4 cores). `forks` stays the pool: `threads`
    // measured no faster here.
    maxWorkers: '100%',
  },
})
