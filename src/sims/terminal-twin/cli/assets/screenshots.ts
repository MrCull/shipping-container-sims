/**
 * `npm run tt:assets:shots` — screenshots every asset in the dev asset viewer
 * from headless Chromium (WebGL via SwiftShader), at each LOD, plus the
 * instanced yard stress test. Output: `.screenshots/assets/` (git-ignored).
 *
 * Options: --base <url> (use a running dev server), --out <dir>, --no-yard.
 * Exit 1 if the page logs errors or an asset fails to load.
 */
import { chromium, type Browser } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import type {} from '../../dev/assetViewerApi' // window.__ttAssets typing

const ROOT = process.cwd()

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

async function startVite(): Promise<{ base: string; stop: () => void }> {
  const port = await freePort()
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  const stop = () => {
    if (vite.exitCode === null) vite.kill('SIGTERM')
  }
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; ) {
    try {
      if ((await fetch(base)).ok) return { base, stop }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  stop()
  throw new Error('Timed out waiting for the Vite dev server')
}

async function launch(): Promise<Browser> {
  if (existsSync(chromium.executablePath())) return chromium.launch()
  const fallback = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p): p is string => !!p && existsSync(p))
  return chromium.launch(fallback ? { executablePath: fallback } : {})
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const opt = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const outDir = opt('--out') ?? join(ROOT, '.screenshots', 'assets')
  mkdirSync(outDir, { recursive: true })
  const given = opt('--base')
  const server = given ? { base: given.replace(/\/$/, ''), stop: () => {} } : await startVite()
  const browser = await launch()
  const errors: string[] = []
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${server.base}/sim/terminal-twin?viewer=yard`)
    await page.waitForFunction(() => !!window.__ttAssets, undefined, { timeout: 60_000 })
    const names = await page.evaluate(() => window.__ttAssets!.list())
    for (const name of names) {
      for (const lod of ['LOD0', 'LOD1', 'LOD2'] as const) {
        const s = await page.evaluate(([n, l]) => window.__ttAssets!.show(n, { lod: l }), [name, lod] as const)
        if (!(lod in s.lods)) continue // this asset has no such LOD
        await page.waitForTimeout(300)
        const file = join(outDir, `${name}-${lod.toLowerCase()}.png`)
        await page.screenshot({ path: file })
        console.log(`${name} ${lod}: ${s.triangles} tris, ${s.drawCalls} draw calls → ${file}`)
      }
    }
    if (!argv.includes('--no-yard')) {
      const y = await page.evaluate(() => window.__ttAssets!.yard(18000))
      await page.screenshot({ path: join(outDir, 'yard.png') })
      console.log(`yard: ${JSON.stringify(y)}`)
    }
  } finally {
    await browser.close()
    server.stop()
  }
  for (const e of errors) console.error(`page error: ${e}`)
  return errors.length ? 1 : 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    console.error(err)
    process.exitCode = 1
  },
)
