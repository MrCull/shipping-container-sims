/**
 * Browser smoke tests (`npm run test:smoke`), kept out of `npm test` so CI
 * does not need a browser. Specs: `src/sims/<sim>/tests/browser/*.smoke.ts`.
 *
 * - `dev` project: Vite dev server, so dev-only APIs such as `window.__tt` exist.
 * - `prod` project: a production build served by `vite preview` (specs named
 *   `*.prod.smoke.ts`), for checks that dev-only code is absent.
 *
 * Tests titled `@load` measure frame rate or draw calls and are load-sensitive: CI runs them as an advisory job
 * (`npm run test:smoke -- --grep @load`); everything else is a required check (`--grep-invert @load`).
 *
 * Uses Playwright's bundled Chromium, or falls back to CHROMIUM_PATH or the
 * cloud image's preinstalled /opt/pw-browsers/chromium (like scripts/screenshot.mjs).
 */
import { chromium, defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/**
 * Free ports by default, so parallel checkouts and stale servers from a killed run never collide. The choice is
 * written back to the environment because Playwright re-evaluates this file in every worker process.
 * Set SMOKE_DEV_PORT / SMOKE_PROD_PORT to pin a port.
 */
function freePort(): number {
  const script = "const s=require('node:net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
  return Number(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim())
}
process.env.SMOKE_DEV_PORT ??= String(freePort())
process.env.SMOKE_PROD_PORT ??= String(freePort())
const DEV_PORT = Number(process.env.SMOKE_DEV_PORT)
const PROD_PORT = Number(process.env.SMOKE_PROD_PORT)
const vite = 'node node_modules/vite/bin/vite.js'

function chromiumExecutable(): string | undefined {
  if (existsSync(chromium.executablePath())) return undefined
  return [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p): p is string => !!p && existsSync(p))
}

export default defineConfig({
  testDir: './src',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  // CI runners are slower than a dev machine: a spec that fails once and passes on retry is reported as flaky, not red.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  outputDir: '.smoke-results',
  use: { viewport: { width: 1280, height: 720 }, launchOptions: { executablePath: chromiumExecutable() } },
  projects: [
    {
      name: 'dev',
      testMatch: /(?<!\.prod)\.smoke\.ts$/,
      use: { baseURL: `http://127.0.0.1:${DEV_PORT}` },
    },
    {
      name: 'prod',
      testMatch: /\.prod\.smoke\.ts$/,
      use: { baseURL: `http://127.0.0.1:${PROD_PORT}` },
    },
  ],
  webServer: [
    {
      command: `${vite} --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
      url: `http://127.0.0.1:${DEV_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `${vite} build --outDir .smoke-dist --emptyOutDir --logLevel warn && ${vite} preview --outDir .smoke-dist --host 127.0.0.1 --port ${PROD_PORT} --strictPort`,
      url: `http://127.0.0.1:${PROD_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
