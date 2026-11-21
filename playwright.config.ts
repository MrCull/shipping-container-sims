/**
 * Browser smoke tests (`pnpm run test:smoke`), kept out of `pnpm test` so CI
 * does not need a browser. Specs: `src/sims/<sim>/tests/browser/*.smoke.ts`.
 *
 * - `dev` project: specs that use the dev API (`window.__tt`, `?viewer=`). It runs against one of two servers
 *   (scripts/smoke-server.mjs, chosen by SMOKE_SERVER=dev|build):
 *   - `dev` (local default): the Vite dev server. No build step, so best for one or two specs, but every page open
 *     loads hundreds of unbundled modules.
 *   - `build` (CI default, i.e. when CI is set): the smoke build, `vite build --mode smoke` into `.smoke-build/`
 *     (SMOKE_BUILD_DIR), a bundled build that keeps the dev API, served by `vite preview`. Pages boot faster; use it
 *     locally for long runs. SMOKE_BUILD_PREBUILT=1 serves an existing build (`pnpm run build:smoke`) without rebuilding.
 * - `prod` project: a production build served by `vite preview` (specs named
 *   `*.prod.smoke.ts`), for checks that dev-only code is absent. SMOKE_PROD_PREBUILT=1 serves an existing build
 *   (SMOKE_PROD_DIR, default `.smoke-dist`) without rebuilding.
 *
 * CI runs the suite in 6 shards (`--shard=i/6`, .github/workflows/pr-checks.yml); `fullyParallel` makes a shard a set of
 * tests, not files. scripts/smoke-merge.mjs merges the shards' JSONL files into one SMOKE line and timing table.
 *
 * Tests titled `@load` need a real frame rate (only the Auto-quality fps spec today): CI runs them as an advisory job
 * (`pnpm run test:smoke --grep @load`); everything else is a required check (`--grep-invert @load`). Frame-based
 * assertions elsewhere use ratios over a wall-clock window (see tests/browser/frameSampling.ts), so they are load-proof.
 *
 * Uses Playwright's bundled Chromium, or falls back to CHROMIUM_PATH or the
 * cloud image's preinstalled /opt/pw-browsers/chromium (like scripts/screenshot.mjs).
 */
import { chromium, defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { smokeDevServer, smokeProdServer } from './scripts/smoke-server.mjs'

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
const devServer = smokeDevServer(process.env, { port: DEV_PORT, vite })
const prodServer = smokeProdServer(process.env, { port: PROD_PORT, vite })
// Written back like the ports, so a spec can tell which server it runs against (build-stamp.smoke.ts does).
process.env.SMOKE_SERVER = devServer.mode

function chromiumExecutable(): string | undefined {
  if (existsSync(chromium.executablePath())) return undefined
  return [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p): p is string => !!p && existsSync(p))
}

export default defineConfig({
  testDir: './src',
  timeout: 120_000,
  // Dev-server chunks (the lazy dashboard, GLBs) and software-WebGL frames are slow on a loaded 2-core runner.
  expect: { timeout: 20_000 },
  // Every test is its own unit of work, so `--shard=i/n` splits the suite by test, not by file (CI runs 6 shards; split by
  // file they were 7, 9 and 19 min). No spec shares state between tests (no serial describe, no shared page in beforeAll);
  // keep it that way. Locally workers stay at 1, so a run is still one test at a time.
  fullyParallel: true,
  // One at a time by default: browser tests are CPU-bound on software WebGL. SMOKE_WORKERS=2 trades speed for timeouts on a 4-core box; try it on an idle machine and re-run failures alone.
  workers: Number(process.env.SMOKE_WORKERS) || 1,
  // CI: one retry (a spec that fails once and passes on retry is reported as flaky, not red) and stop after 5 failures,
  // so a broken build does not burn the whole job timeout. Local runs: no retries, no cap.
  retries: process.env.CI ? 1 : 0,
  maxFailures: process.env.CI ? 5 : 0,
  // The summary reporter ends every run with one `SMOKE: n passed, n failed, ...` line, which survives a pipe that eats the exit code.
  // SMOKE_JSONL_REPORT=<file> appends one line per finished test attempt (scripts/smoke-jsonl-reporter.mjs; CI sets it), so a
  // cancelled or timed-out run keeps its timings. SMOKE_JSON_REPORT=<file> writes a JSON report, but only when the run ends.
  // scripts/smoke-timing.mjs reads either. Unset: list only.
  reporter: [
    ['list'],
    ['./scripts/smoke-summary-reporter.mjs'],
    ...(process.env.SMOKE_JSONL_REPORT ? [['./scripts/smoke-jsonl-reporter.mjs', { outputFile: process.env.SMOKE_JSONL_REPORT }] as const] : []),
    ...(process.env.SMOKE_JSON_REPORT ? [['json', { outputFile: process.env.SMOKE_JSON_REPORT }] as const] : []),
  ],
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
      command: devServer.command,
      url: devServer.url,
      reuseExistingServer: false,
      // The smoke build bundles the app first (about a minute on a busy 4-core box).
      timeout: devServer.mode === 'build' ? 180_000 : 60_000,
    },
    {
      // SMOKE_PROD_PREBUILT=1 serves an existing build (SMOKE_PROD_DIR, default .smoke-dist) without rebuilding, as CI shards do.
      command: prodServer.command,
      url: prodServer.url,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
