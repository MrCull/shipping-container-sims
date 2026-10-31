/**
 * TT-28 browser smoke tests (seam 3): the infrastructure GLBs in the twin (gate modules, quay furniture, yard
 * infrastructure, buildings) are instanced within the draw-call budget, replace the procedural placeholders, make no
 * external requests, and the Algeciras backdrop meshes apply to the TTI preset only. Screenshots: .screenshots/assets/.
 * Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

function watch(page: Page): { errors: string[]; external: string[] } {
  const errors: string[] = []
  const external: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('request', (req) => {
    const url = new URL(req.url())
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)
    if (!local && /\.(glb|gltf|bin|webp|ktx2|wasm|drc)(\?|$)/i.test(url.pathname)) external.push(req.url())
  })
  return { errors, external }
}

async function open(page: Page, name: string): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((n) => window.__tt!.load(n), name)
  await page.waitForFunction(() => window.__tt!.scene()?.infrastructure.assets === 'loaded', undefined, { timeout: 60_000 })
}

test('the gate fixture draws instanced infrastructure models within the draw-call budget', async ({ page }) => {
  const { errors, external } = watch(page)
  await open(page, 'truck-gate-queue')
  const infra = await page.evaluate(() => window.__tt!.scene()!.infrastructure)
  expect(infra.drawCalls).toBeGreaterThan(5)
  expect(infra.drawCalls).toBeLessThanOrEqual(24)
  expect(infra.instances['gate-island']).toBeGreaterThan(2)
  expect(infra.instances['gate-lane-oog']).toBe(1)
  expect(infra.triangles).toBeGreaterThan(1000)
  await page.evaluate(() => window.__tt!.cameraTo('gate', 45))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '.screenshots/assets/infrastructure-gate.png' })
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('the backdrop meshes replace the procedural backdrop for the TTI preset only', async ({ page }) => {
  const { errors } = watch(page)
  await open(page, 'truck-gate-queue')
  const generic = await page.evaluate(() => window.__tt!.atmosphere().scene?.backdrop)
  expect(generic?.kind).toBe('generic')
  expect(generic?.models).toBe('procedural')
  await page.evaluate(() => window.__tt!.load('TTI Algeciras baseline'))
  await page.waitForFunction(() => window.__tt!.atmosphere().scene?.backdrop.models === 'glb', undefined, { timeout: 90_000 })
  expect(errors).toEqual([])
})

test('the TTI surroundings draw as five scenery meshes inside the stated budget; a generic preset has none', async ({ page }) => {
  const { errors } = watch(page)
  await open(page, 'truck-gate-queue')
  const generic = await page.evaluate(() => window.__tt!.atmosphere().scene?.backdrop)
  for (const part of ['shore', 'anchorage', 'tanks', 'landside', 'town']) expect(generic?.parts).not.toContain(part)
  await page.evaluate(() => window.__tt!.load('TTI Algeciras baseline'))
  await page.waitForFunction(() => window.__tt!.atmosphere().scene?.backdrop.models === 'glb', undefined, { timeout: 90_000 })
  const tti = await page.evaluate(() => window.__tt!.atmosphere().scene?.backdrop)
  expect(tti?.parts).toEqual(expect.arrayContaining(['shore', 'anchorage', 'tanks', 'landside', 'town']))
  // the GLB geometry is in: a scenery part is many triangles, not the few boxes of its stand-in
  const tris = await page.evaluate(() => {
    const breakdown = window.__tt!.drawBreakdown() ?? {}
    return Object.entries(breakdown)
      .filter(([k]) => k.startsWith('backdrop-tti/'))
      .reduce((s, [, v]) => s + v.triangles, 0)
  })
  expect(tris).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
