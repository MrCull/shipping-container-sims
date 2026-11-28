import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { SHARED_PROJECT, simIdsWithTests } from './scripts/vitest-projects.mjs'

// One project per sim folder with tests (named by sim id, `pnpm test:sim <id>` runs one), plus `shared` for every
// test outside src/sims/. Discovered from the folders, so a new sim needs no edit here.
const simIds = simIdsWithTests(fileURLToPath(new URL('.', import.meta.url)))

export default defineConfig({
  // Component tests (`tests/components/`) mount `.vue` files.
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Only this checkout's sources (never .claude/worktrees/*). Each project inherits this root config (`extends`).
    projects: [
      ...simIds.map((id) => ({ extends: true as const, test: { name: id, include: [`src/sims/${id}/**/*.test.ts`] } })),
      {
        extends: true as const,
        test: { name: SHARED_PROJECT, include: ['src/**/*.test.ts'], exclude: ['src/sims/**'] },
      },
    ],
    // Node for every file; a component test opts in to the DOM per file with a `// @vitest-environment happy-dom` first line.
    environment: 'node',
    // Heavy engine runs (TTI preset, goldens, benchmarks) exceed the 5 s default when the machine is busy (parallel agents, CI).
    testTimeout: 60_000,
    // Every CPU, not vitest's default of all but one: the main process is idle while files run, so on the 4-vCPU CI
    // runner four forks beat three (measured #324: 185 s to 144 s locally on 4 cores). `forks` stays the pool: `threads`
    // measured no faster here.
    maxWorkers: '100%',
  },
})
