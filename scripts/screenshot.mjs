/**
 * Generic headless screenshot of any route, for visually checking sims (including WebGL/3D).
 * Starts a Vite dev server on a free port unless --base is given, so dev-only APIs are available.
 *
 * Usage:
 *   pnpm run screenshot --path /sim/box-empire --wait 8000 --out .screenshots/box-empire.png
 *   pnpm run screenshot --base http://127.0.0.1:4173 --path / --full-page
 *   pnpm run screenshot --path /sim/x --wait-for "canvas" --eval "window.__tt?.step()"
 *
 * Options:
 *   --path <route>        Route to open (default "/")
 *   --base <url>          Use an already-running server instead of starting Vite
 *   --out <file>          Output PNG (default .screenshots/<route-slug>.png)
 *   --wait <ms>           Extra wait after load and --wait-for (default 5000)
 *   --wait-for <selector> Wait until this selector is visible before the extra wait
 *   --eval <js>           Expression evaluated in the page (awaited) before the extra wait
 *   --width / --height    Viewport size (default 1280x720)
 *   --full-page           Capture the full scrollable page
 *   --fail-on-error       Exit 1 if the page logs console errors or throws
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { values: args } = parseArgs({
  options: {
    path: { type: 'string', default: '/' },
    base: { type: 'string' },
    out: { type: 'string' },
    wait: { type: 'string', default: '5000' },
    'wait-for': { type: 'string' },
    eval: { type: 'string' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '720' },
    'full-page': { type: 'boolean', default: false },
    'fail-on-error': { type: 'boolean', default: false },
  },
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function startVite() {
  const port = await freePort()
  // Run Vite's own entry with the current Node binary (no npx/shell layers, works on Windows too).
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  const stop = () => {
    if (vite.exitCode === null) vite.kill('SIGTERM')
  }
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited early with code ${vite.exitCode}`)
    try {
      const res = await fetch(base)
      if (res.ok) return { base, stop }
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  stop()
  throw new Error('Timed out waiting for Vite dev server')
}

/**
 * Launches Playwright's bundled Chromium. If that build isn't installed (e.g. a cloud container whose
 * preinstalled browser revision differs from the repo's Playwright version), falls back to
 * CHROMIUM_PATH or the preinstalled /opt/pw-browsers/chromium rather than downloading a browser.
 */
async function launchChromium() {
  try {
    return await chromium.launch({ headless: true })
  } catch (err) {
    const fallback = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p) => p && existsSync(p))
    if (!fallback) throw err
    console.warn(`Bundled Chromium unavailable; using ${fallback}`)
    return chromium.launch({ headless: true, executablePath: fallback })
  }
}

async function main() {
  const server = args.base ? { base: args.base.replace(/\/$/, ''), stop: () => {} } : await startVite()
  const slug = args.path.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9-]+/g, '-') || 'home'
  const out = args.out ?? join(ROOT, '.screenshots', `${slug}.png`)
  const errors = []

  const browser = await launchChromium()
  try {
    const page = await browser.newPage({
      viewport: { width: Number(args.width), height: Number(args.height) },
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
    })
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

    const url = `${server.base}${args.path.startsWith('/') ? '' : '/'}${args.path}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
    if (args['wait-for']) {
      await page.locator(args['wait-for']).first().waitFor({ state: 'visible', timeout: 60_000 })
    }
    if (args.eval) {
      const result = await page.evaluate(`(async () => (${args.eval}))()`)
      if (result !== undefined) console.log('eval result:', JSON.stringify(result))
    }
    await sleep(Number(args.wait))

    await mkdir(dirname(out), { recursive: true })
    await page.screenshot({ path: out, fullPage: args['full-page'] })
    console.log(`Saved ${out}`)
  } finally {
    await browser.close()
    server.stop()
  }

  if (errors.length > 0) {
    console.error(`${errors.length} page error(s):\n${errors.join('\n')}`)
    if (args['fail-on-error']) process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
