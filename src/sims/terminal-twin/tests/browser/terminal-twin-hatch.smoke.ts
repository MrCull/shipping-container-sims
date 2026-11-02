/**
 * TT-R10 browser smoke tests: hatch panels in the 3D view, through the dev-only `window.__tt` API.
 * The hatch-cover-cycle fixture lifts the panels of a feeder bay off, stacks them in the quay laydown, and puts them back.
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { HatchPanelState } from '../../engine'
import type {} from '../../dev/devApi' // window.__tt typing
import { HATCH_THICKNESS_M, VESSEL_CLASSES } from '../../scenario/vesselClasses'

const FIXTURE = 'hatch-cover-cycle'
const HALF = HATCH_THICKNESS_M / 2

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, fixture = FIXTURE): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), fixture)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

/** Wait until the scene has drawn at least two more frames, so the rig state is the state at the paused time. */
async function nextFrames(page: Page): Promise<void> {
  const frames = await page.evaluate(() => window.__tt!.scene()?.frames ?? 0)
  await page.waitForFunction((n) => (window.__tt!.scene()?.frames ?? 0) >= n + 2, frames)
}

/** Check every panel: the scene's pose and the drawn pose against the engine's state, at the engine's (paused) time. */
async function checkPanels(page: Page): Promise<{ engine: HatchPanelState[]; statuses: string[] }> {
  await nextFrames(page)
  const engine = await page.evaluate(() => window.__tt!.query<HatchPanelState[]>('hatchList'))
  const state = (await page.evaluate(() => window.__tt!.sceneState()))!
  expect(Object.keys(state.hatchPanels).sort()).toEqual(engine.map((p) => p.id).sort())
  for (const panel of engine) {
    const scene = state.hatchPanels[panel.id]
    expect(scene.status, panel.id).toBe(panel.status)
    if (scene.x === null) continue // its vessel is not in the scene
    if (panel.status === 'lifted') {
      // hanging from the spreader: top face at the hoist height, under the crane's gantry and trolley
      const sts = state.sts[panel.stsId as string]
      expect(scene.stsId, panel.id).toBe(panel.stsId)
      expect(scene.x, panel.id).toBeCloseTo(sts.gantryX, 6)
      expect(scene.y! + HALF, panel.id).toBeCloseTo(sts.hoistY, 6)
      expect(scene.z, panel.id).toBeCloseTo(sts.trolleyZ, 6)
    } else {
      // at rest: where the engine says it lies (top face centre), on its hatch or in its laydown bay
      expect(scene.x, panel.id).toBeCloseTo(panel.pos.x, 6)
      expect(scene.y! + HALF, panel.id).toBeCloseTo(panel.pos.y, 6)
      expect(scene.z, panel.id).toBeCloseTo(panel.pos.z, 6)
    }
    // what the renderer drew is the scene's pose
    const drawn = state.hatchRigs[panel.id]
    expect(drawn, `${panel.id} drawn`).toBeDefined()
    expect(drawn.status).toBe(scene.status)
    expect(drawn.x).toBeCloseTo(scene.x, 6)
    expect(drawn.y).toBeCloseTo(scene.y!, 6)
    expect(drawn.z).toBeCloseTo(scene.z!, 6)
  }
  return { engine, statuses: engine.map((p) => p.status) }
}

test('panels follow the engine through a remove and replace cycle, and the laydown draws what is off the vessel', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await checkPanels(page)
  // the covers of the bays that have a slot, drawn by the twin (not baked into the hull)
  const total = (await page.evaluate(() => window.__tt!.query<HatchPanelState[]>('hatchList'))).length
  expect(total).toBeGreaterThan(0)

  const seen = new Set<string>()
  // remove: two panels of bay 0 lifted, carried and stacked in the laydown; replace: back, last removed first
  for (const type of ['HatchLifted', 'HatchSetInLaydown', 'HatchLifted', 'HatchSetInLaydown', 'HatchLifted', 'HatchReplaced', 'HatchLifted', 'HatchReplaced'] as const) {
    expect((await page.evaluate((t) => window.__tt!.runUntil({ eventType: t }), type)).reason).toBe('condition')
    const { statuses } = await checkPanels(page)
    for (const s of statuses) seen.add(s)
    expect((await page.evaluate(() => window.__tt!.scene()))!.hatchPanels).toBe(total) // all on show once the vessel is alongside
    if (type === 'HatchSetInLaydown' && statuses.filter((s) => s === 'in-laydown').length === 2) {
      // both panels of the hatch are stacked: the second on top of the first
      const stack = (await page.evaluate(() => window.__tt!.query<HatchPanelState[]>('hatchList'))).filter((p) => p.status === 'in-laydown')
      expect(new Set(stack.map((p) => p.pos.x)).size).toBe(1)
      expect(Math.abs(stack[0].pos.y - stack[1].pos.y)).toBeCloseTo(HATCH_THICKNESS_M, 6)
    }
  }
  for (const s of ['lifted', 'in-laydown', 'replaced']) expect(seen, `a panel was ${s}`).toContain(s)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'HatchSecured' }))
  await checkPanels(page)
  expect(errors).toEqual([])
})

test('a panel in the laydown is drawn, can be clicked, and is inspected; hatch moves are in the event feed', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.keyboard.press('e')
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'HatchSetInLaydown' }))
  const [panel] = (await page.evaluate(() => window.__tt!.query<HatchPanelState[]>('hatchList'))).filter((p) => p.status === 'in-laydown')
  expect(panel.siteId).not.toBeNull()
  await expect(page.getByTestId('tt-feed-rows')).toContainText('HatchLifted')
  await expect(page.getByTestId('tt-feed-rows')).toContainText('HatchSetInLaydown')

  // look at it, click it
  expect(await page.evaluate((id) => window.__tt!.cameraTo(id, 40), panel.id)).toBe(true)
  await nextFrames(page)
  const at = await page.evaluate((id) => window.__tt!.screenPoint(id), panel.id)
  expect(at).not.toBeNull()
  expect(await page.evaluate(({ x, y }) => window.__tt!.pickAt(x, y), at!)).toBe(panel.id)

  await page.evaluate((id) => window.__tt!.select(id), panel.id)
  await page.waitForFunction(() => window.__tt!.debug().entity !== null)
  const entity = (await page.evaluate(() => window.__tt!.debug()))!.entity!
  expect(entity).toMatchObject({ kind: 'hatch', id: panel.id, status: 'in-laydown' })
  expect(errors).toEqual([])
})

test('with hatch covers off no panel is drawn and the hull has no covers over any bay', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page, 'tracer-1sts-10-boxes')
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  const state = (await page.evaluate(() => window.__tt!.sceneState()))!
  expect(state.hatchPanels).toEqual({})
  expect((await page.evaluate(() => window.__tt!.scene()))!.hatchPanels).toBe(0)
  // every bay of every vessel is cut open at every LOD (#173): no baked cover, a hole in the deck, a liner in each hold
  const hulls = Object.entries(state.vesselHulls)
  expect(hulls.length).toBeGreaterThan(0)
  for (const [id, hull] of hulls) {
    expect(hull.openHatchBays, id).toEqual(Array.from({ length: VESSEL_CLASSES[hull.sizeClass].bays }, (_, bay) => bay))
  }
  expect(errors).toEqual([])
})
