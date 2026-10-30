/**
 * TT-27 vessel hulls in the twin (seam 3, browser dev API): every size class
 * renders from its GLB, deck containers sit on the rendered hull's bay grid,
 * the livery and name follow the vessel's line, and the hulls switch LOD at
 * berth and at anchorage. Screenshots go to .screenshots/assets/vessel-*.png.
 * Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import atlas from '../../assets/models/vessels/vessel-livery-atlas.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import type { VesselConfig, VesselSizeClass } from '../../scenario/types'

const CLASSES: VesselSizeClass[] = ['feeder', 'feedermax', 'panamax', 'neo-panamax', 'ulcv']
const HEIGHT: Record<string, number> = { '20': 2.591, '40': 2.591, '40HC': 2.896 }

function call(id: string, sizeClass: VesselSizeClass, extra: Partial<VesselConfig> = {}): VesselConfig {
  return { id, name: `${id} Test`, sizeClass, arrivalS: 0, discharge: 60, load: 0, transshipment: 0, maxSts: 2, ...extra }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, vessels: VesselConfig[], quayLengthM: number): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(
    ({ vessels, quayLengthM }) => window.__tt!.load('tracer-1sts-10-boxes', { overrides: { vessels, quayLengthM, stsCount: 2 } }),
    { vessels, quayLengthM },
  )
  // Berthed (mooring takes a while), before the cranes have taken much off.
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsMoveStarted' }))
  await page.waitForFunction(() => {
    const s = window.__tt!.sceneState()
    return !!s && Object.values(s.vesselHulls).every((h) => h.assets === 'loaded')
  })
}

test('every size class renders its hull GLB and deck containers sit on its bay grid', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = watchErrors(page)
  for (const sizeClass of CLASSES) {
    await open(page, [call('V001', sizeClass, { name: 'HMM Tarifa' })], 900)
    const state = (await page.evaluate(() => window.__tt!.sceneState()))!
    const hull = state.vesselHulls.V001
    expect(hull.sizeClass).toBe(sizeClass)
    expect(hull.bayGrid, `${sizeClass} bay grid`).not.toBeNull()
    const g = hull.bayGrid!
    let deck = 0
    for (const [id, custody] of Object.entries(state.containers)) {
      if (custody?.kind !== 'vesselSlot') continue
      const m = /:(\d+)-(\d+)-(\d+)([af]?)$/.exec(custody.id)!
      const [bay, row, tier] = [Number(m[1]), Number(m[2]), Number(m[3])]
      const half = m[4] === 'a' ? -g.halfOffsetM : m[4] === 'f' ? g.halfOffsetM : 0
      const rendered = state.liveries[id]
      const base = tier >= g.holdTiers ? g.origin.y + (tier - g.holdTiers) * g.tierPitchM : g.holdTopY - (g.holdTiers - tier) * g.tierPitchM
      const expected = {
        x: g.origin.x + (bay + 0.5) * g.bayPitchM + half,
        y: base + HEIGHT[rendered.size] / 2,
        z: g.origin.z - (row + 0.5) * g.rowPitchM,
      }
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(rendered.centre[k] - expected[k]), `${sizeClass} ${id} ${k}`).toBeLessThan(0.01)
      if (tier >= g.holdTiers) deck++
    }
    expect(deck, `${sizeClass} deck containers`).toBeGreaterThan(0)
    await page.evaluate(() => window.__tt!.cameraTo('V001', 260))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `.screenshots/assets/vessel-${sizeClass}.png` })
  }
  expect(errors).toEqual([])
})

test('livery and name follow each vessel’s line from the scenario', async ({ page }) => {
  const errors = watchErrors(page)
  const vessels = [
    call('V001', 'feeder', { name: 'Ever Lucent' }),
    call('V002', 'feeder', { name: 'Madrid Maersk', arrivalS: 60 }),
    call('V003', 'feeder', { name: 'Coastal Trader', line: 'MSC', arrivalS: 120 }),
    call('V004', 'feeder', { name: 'Coastal Spirit', arrivalS: 180 }),
  ]
  await open(page, vessels, 900)
  const state = (await page.evaluate(() => window.__tt!.sceneState()))!
  const expected: Record<string, string | null> = { V001: 'Evergreen', V002: 'Maersk', V003: 'MSC', V004: null }
  for (const v of vessels) {
    const hull = state.vesselHulls[v.id]
    expect(hull.line ?? null, v.id).toBe(expected[v.id])
    expect(atlas.liveries[hull.liveryIndex].line, v.id).toBe(expected[v.id])
    expect(hull.name, v.id).toBe(v.name)
  }
  await page.evaluate(() => window.__tt!.cameraTo('V002', 120))
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/assets/vessel-liveries.png' })
  expect(errors).toEqual([])
})

test('hulls switch LOD with distance, at berth and at anchorage', async ({ page }) => {
  const errors = watchErrors(page)
  // The quay fits one Panamax: the ULCV waits at anchorage.
  await open(page, [call('V001', 'panamax', { name: 'HMM Tarifa' }), call('V002', 'ulcv', { name: 'ONE Harmony', arrivalS: 30 })], 320)
  const statuses = await page.evaluate(() => window.__tt!.sceneState()!.vessels)
  expect(statuses.V001.status).toBe('berthed')
  expect(statuses.V002.status).toBe('at-anchorage')
  const lod = (id: string) => page.evaluate((v) => window.__tt!.sceneState()!.vesselHulls[v].lod, id)
  for (const id of ['V001', 'V002']) {
    await page.evaluate((v) => window.__tt!.cameraTo(v, 150), id)
    await expect.poll(() => lod(id), { message: `${id} near` }).toBe(0)
    await page.evaluate((v) => window.__tt!.cameraTo(v, 700), id)
    await expect.poll(() => lod(id), { message: `${id} mid` }).toBe(1)
    await page.evaluate((v) => window.__tt!.cameraTo(v, 2500), id)
    await expect.poll(() => lod(id), { message: `${id} far` }).toBe(2)
  }
  const scene = await page.evaluate(() => window.__tt!.scene())
  expect(scene!.vesselAssets).toBe('loaded')
  await page.evaluate(() => window.__tt!.cameraTo('V002', 450))
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/assets/vessel-anchorage.png' })
  expect(errors).toEqual([])
})
