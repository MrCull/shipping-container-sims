/**
 * TT-05 browser smoke tests: the SHC fixture through the dev-only `window.__tt` API.
 * Run with `npm run test:smoke` (not part of `npm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { ContainerState, RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/shc-1sts-2shc-1wtp.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'shc-1sts-2shc-1wtp'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function openShc(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('the SHC fixture runs in the browser: golden hash, custody chain, rendered SHCs match the engine', async ({ page }) => {
  const errors = collectErrors(page)
  await openShc(page)
  expect((await page.evaluate(() => window.__tt!.runUntil())).reason).toBe('ended')

  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.eventLogHash).toBe(golden.eventLogHash)
  expect(summary.kpis).toEqual(golden.kpis)
  expect(summary.invariants.violations).toBe(0)

  const boxes = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('containers'))
  for (const { id } of boxes) {
    const box = await page.evaluate((cid) => window.__tt!.query<ContainerState>('container', cid), id)
    expect(box.custodyHistory.slice(0, 5).map((h) => h.owner.kind), id).toEqual([
      'vesselSlot',
      'sts',
      'groundPosition',
      'shc',
      'wtpPad',
    ])
  }

  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  const shcList = await page.evaluate(() => window.__tt!.query<{ id: string; status: string }[]>('shcList'))
  const scene = await page.evaluate(() => window.__tt!.scene())
  expect(scene!.shcs).toBe(shcList.length)
  expect(scene!.shcs).toBe(2)
  expect(scene!.containers).toBe(boxes.length)
  const state = await page.evaluate(() => window.__tt!.sceneState())
  for (const shc of shcList) expect(state!.shcs[shc.id].status).toBe(shc.status)
  expect(errors).toEqual([])
})

test('paused mid-trip, the scene shows each SHC and box where the engine has them', async ({ page }) => {
  await openShc(page)
  await page.evaluate(() => window.__tt!.pause())
  await page.evaluate(() => window.__tt!.runTo(240))
  const state = await page.evaluate(() => window.__tt!.sceneState())
  const boxes = await page.evaluate(() =>
    window.__tt!.query<{ id: string; custody: { kind: string; id: string } }[]>('containers'),
  )
  const shcs = await page.evaluate(() => window.__tt!.query<{ id: string; status: string }[]>('shcList'))
  for (const box of boxes) expect(state!.containers[box.id], box.id).toEqual(box.custody)
  for (const shc of shcs) expect(state!.shcs[shc.id].status).toBe(shc.status)
  expect(boxes.some((b) => b.custody.kind === 'shc')).toBe(true)
})

/** Sample SHC poses on every animation frame for `ms` wall milliseconds. */
async function sampleFrames(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const tt = window.__tt!
    const samples: { sim: number; wall: number; frames: number; shcs: Record<string, { x: number; z: number }> }[] = []
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const tick = () => {
        const s = tt.sceneState()!
        samples.push({
          sim: s.displayTime,
          wall: performance.now(),
          frames: tt.scene()?.frames ?? 0,
          shcs: Object.fromEntries(Object.entries(s.shcs).map(([id, p]) => [id, { x: p.x, z: p.z }])),
        })
        if (performance.now() - t0 < duration) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    return samples
  }, ms)
}

test('SHCs animate smoothly at ×1 and keep animating every frame at ×600', async ({ page }) => {
  await openShc(page)
  // Start just after SHC01 sets off empty towards the first box.
  await page.evaluate(() => window.__tt!.pause())
  await page.evaluate(() => window.__tt!.runTo(160))
  await page.evaluate(() => window.__tt!.setSpeed(1))
  const slow = await sampleFrames(page, 2000)
  const vMax = 8.3 // m/s, default empty SHC speed
  let moved = 0
  for (let i = 1; i < slow.length; i++) {
    const dt = slow[i].sim - slow[i - 1].sim
    for (const [id, p] of Object.entries(slow[i].shcs)) {
      const q = slow[i - 1].shcs[id]
      const step = Math.abs(p.x - q.x) + Math.abs(p.z - q.z)
      // no teleporting: never faster than the SHC's top speed (+ rounding)
      expect(step, `${id} at sim ${slow[i].sim}`).toBeLessThanOrEqual(vMax * dt + 0.05)
      moved += step
    }
  }
  expect(moved).toBeGreaterThan(1)

  await page.evaluate(() => window.__tt!.setSpeed(600))
  const fast = await sampleFrames(page, 2000)
  const first = fast[0]
  const last = fast[fast.length - 1]
  expect(last.frames - first.frames).toBeGreaterThanOrEqual(10)
  for (let i = 1; i < fast.length; i++) expect(fast[i].sim).toBeGreaterThan(fast[i - 1].sim)
  const rate = (last.sim - first.sim) / ((last.wall - first.wall) / 1000)
  expect(rate).toBeGreaterThan(600 * 0.9)
  expect(rate).toBeLessThan(600 * 1.1)
  // SHC poses changed across the ×600 frames
  const changed = fast.some((s, i) => i > 0 && JSON.stringify(s.shcs) !== JSON.stringify(fast[i - 1].shcs))
  expect(changed).toBe(true)
})

test('lane-graph and reservation overlays toggle on and off', async ({ page }) => {
  const errors = collectErrors(page)
  await openShc(page)
  await page.evaluate(() => window.__tt!.pause())
  await page.evaluate(() => window.__tt!.runTo(170))
  const lanes = page.getByRole('button', { name: 'Lane graph' })
  const reservations = page.getByRole('button', { name: 'Reservations' })
  await expect(lanes).toHaveAttribute('aria-pressed', 'false')

  await lanes.click()
  await reservations.click()
  await expect(lanes).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => page.evaluate(() => window.__tt!.scene()?.overlays))
    .toEqual({ laneGraph: true, reservations: true })
  const active = await page.evaluate(() => window.__tt!.sceneState()!.reservations)
  expect(Object.keys(active).length).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.__tt!.scene()?.reservedZones ?? 0)).toBe(Object.keys(active).length)
  await page.evaluate(() => window.__tt!.cameraTo('SHC01'))
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.screenshots/terminal-twin-smoke-shc-overlays.png' })

  await lanes.click()
  await reservations.click()
  await expect
    .poll(() => page.evaluate(() => window.__tt!.scene()?.overlays))
    .toEqual({ laneGraph: false, reservations: false })
  await expect.poll(() => page.evaluate(() => window.__tt!.scene()?.reservedZones)).toBe(0)
  expect(errors).toEqual([])
})

test('the setup dialog sets the SHC count and kinematics', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await expect(dialog).toBeVisible()
  await dialog.getByText(FIXTURE, { exact: true }).click()
  await expect(dialog.getByRole('group', { name: /shuttle carriers/i })).toBeVisible()
  const readout = dialog.getByTestId('tt-shc-readout')
  const before = await readout.textContent()
  await dialog.getByLabel('Count').fill('3')
  await dialog.getByLabel('Empty speed (m/s)').fill('5')
  await expect(readout).not.toHaveText(before ?? '')
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(dialog).toBeHidden()
  await page.waitForFunction(() => !!window.__tt)
  const shcs = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('shcList'))
  expect(shcs.map((s) => s.id)).toEqual(['SHC01', 'SHC02', 'SHC03'])
  await page.evaluate(() => window.__tt!.runUntil())
  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.status).toBe('ended')
  expect(summary.invariants.violations).toBe(0)
  expect(summary.eventLogHash).not.toBe(golden.eventLogHash)
  expect(Object.keys(summary.kpis.horizontal!.shcs)).toHaveLength(3)
})
