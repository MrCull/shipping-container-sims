/**
 * #331 (spec #320): the vessel group's scene checks, moved from the browser smoke specs to the headless scene
 * (`cli/headlessScene.ts`), which builds and poses the scene through the browser's own path and returns
 * `__tt.sceneState()`'s shape. Colour by tints per mode (was `colour-by.smoke.ts`), ROB box counts and the ROB display
 * (was `rob-bays.smoke.ts`, `colour-by.smoke.ts`), hatch panel positions (was `terminal-twin-hatch.smoke.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { HatchPanelState } from '../engine'
import { headlessScene, type HeadlessScene } from '../cli/headlessScene'
import type { SceneState } from '../modules/sceneState'
import { HATCH_THICKNESS_M, VESSEL_CLASSES } from '../scenario/vesselClasses'

const HALF = HATCH_THICKNESS_M / 2
const open: HeadlessScene[] = []
async function scene(name: string): Promise<HeadlessScene> {
  const s = await headlessScene(name)
  open.push(s)
  return s
}
afterEach(() => {
  for (const s of open.splice(0)) s.dispose()
})

const tints = (state: SceneState): Record<string, number> => Object.fromEntries(Object.entries(state.liveries).map(([id, l]) => [id, l.tint]))
const coloured = (t: Record<string, number>): number => new Set(Object.values(t).filter((v) => v >= 0)).size

describe('headless scene: colour by tints the 3D boxes per mode', () => {
  it('default draws the line livery; POD, weight, length and dwell each tint every box, in their own colours', async () => {
    const s = await scene('rob-bays')
    await s.runUntil({ eventType: 'VesselBerthed' })
    const before = tints(s.sceneState())
    expect(Object.keys(before).length).toBeGreaterThan(10)
    expect(Object.values(before).every((v) => v === -1)).toBe(true)

    s.setColourBy('pod')
    const pod = tints(s.sceneState())
    expect(s.sceneState().colour.mode).toBe('pod')
    expect(coloured(pod)).toBeGreaterThan(1)
    expect(Object.values(pod).every((v) => v >= 0)).toBe(true)

    s.setColourBy('weight')
    expect(JSON.stringify(tints(s.sceneState()))).not.toBe(JSON.stringify(pod))

    s.setColourBy('length')
    const length = tints(s.sceneState())
    expect(coloured(length)).toBeGreaterThan(1)

    s.setColourBy('dwell')
    expect(JSON.stringify(tints(s.sceneState()))).not.toBe(JSON.stringify(length))

    s.setColourBy('default')
    expect(Object.values(tints(s.sceneState())).every((v) => v === -1)).toBe(true)
  })

  it('a time-based mode follows the sim clock', async () => {
    const s = await scene('rob-bays')
    s.setColourBy('transit')
    const early = tints(s.sceneState())
    expect(Object.values(early).some((v) => v >= 0)).toBe(true)
    await s.runUntil({ vesselsCompleted: 1 })
    expect(JSON.stringify(tints(s.sceneState()))).not.toBe(JSON.stringify(early))
  })
})

describe('headless scene: ROB boxes in the hull', () => {
  it('draws the ROB boxes of a vessel with ROB bays, and none for one without', async () => {
    const rob = await scene('rob-bays')
    await rob.runUntil({ eventType: 'StsMoveStarted' })
    // 3 bays x 8 rows x (4 hold + 3 deck tiers) cells at 70% fill: well over 30 boxes (exact count: rob-bays.test.ts)
    expect(rob.sceneState().vesselHulls.V001.robBoxes).toBeGreaterThan(30)
    const plain = await scene('hatch-cover-cycle')
    await plain.runUntil({ eventType: 'StsMoveStarted' })
    expect(plain.sceneState().vesselHulls.V001.robBoxes).toBe(0)
  })

  it('the ROB display: Grey (default) and Show draw them, Hide draws none', async () => {
    const s = await scene('rob-bays')
    await s.runUntil({ eventType: 'VesselBerthed' })
    expect(s.sceneState().colour.robDisplay).toBe('grey')
    expect(s.sceneState().vesselHulls.V001.robBoxes).toBeGreaterThan(30)
    s.setColourBy('default', 'hide')
    expect(s.sceneState().vesselHulls.V001.robBoxes).toBe(0)
    expect(s.sceneState().vesselHulls.V001.robHidden).toBe(true)
    s.setColourBy('line', 'show')
    expect(s.sceneState().vesselHulls.V001.robBoxes).toBeGreaterThan(30)
    expect(s.sceneState().vesselHulls.V001.robHidden).toBe(false)
    s.setColourBy('line', 'grey')
    expect(s.sceneState().vesselHulls.V001.robBoxes).toBeGreaterThan(30)
  })
})

describe('headless scene: hatch panels', () => {
  /** Every panel: the scene's pose and the drawn pose against the engine's state at the paused time. */
  async function checkPanels(s: HeadlessScene): Promise<string[]> {
    const engine = await s.controller.query<HatchPanelState[]>('hatchList')
    const state = s.sceneState()
    expect(Object.keys(state.hatchPanels).sort()).toEqual(engine.map((p) => p.id).sort())
    for (const panel of engine) {
      const scene = state.hatchPanels[panel.id]
      expect(scene.status, panel.id).toBe(panel.status)
      if (scene.x === null) continue // its vessel is not in the scene
      if (panel.status === 'lifted') {
        const sts = state.sts[panel.stsId as string]
        expect(scene.stsId, panel.id).toBe(panel.stsId)
        expect(scene.x, panel.id).toBeCloseTo(sts.gantryX, 6)
        expect(scene.y! + HALF, panel.id).toBeCloseTo(sts.hoistY, 6)
        expect(scene.z, panel.id).toBeCloseTo(sts.trolleyZ, 6)
      } else {
        expect(scene.x, panel.id).toBeCloseTo(panel.pos.x, 6)
        expect(scene.y! + HALF, panel.id).toBeCloseTo(panel.pos.y, 6)
        expect(scene.z, panel.id).toBeCloseTo(panel.pos.z, 6)
      }
      const drawn = state.hatchRigs[panel.id]
      expect(drawn, `${panel.id} drawn`).toBeDefined()
      expect(drawn.status).toBe(scene.status)
      expect(drawn.x).toBeCloseTo(scene.x, 6)
      expect(drawn.y).toBeCloseTo(scene.y!, 6)
      expect(drawn.z).toBeCloseTo(scene.z!, 6)
    }
    return engine.map((p) => p.status)
  }

  it('panels follow the engine through a remove and replace cycle, and the laydown draws what is off the vessel', async () => {
    const s = await scene('hatch-cover-cycle')
    await checkPanels(s)
    const total = (await s.controller.query<HatchPanelState[]>('hatchList')).length
    expect(total).toBeGreaterThan(0)
    const seen = new Set<string>()
    for (const type of ['HatchLifted', 'HatchSetInLaydown', 'HatchLifted', 'HatchSetInLaydown', 'HatchLifted', 'HatchReplaced', 'HatchLifted', 'HatchReplaced'] as const) {
      expect((await s.runUntil({ eventType: type })).reason).toBe('condition')
      const statuses = await checkPanels(s)
      for (const st of statuses) seen.add(st)
      expect(s.stats().hatchPanels).toBe(total) // all on show once the vessel is alongside
      if (type === 'HatchSetInLaydown' && statuses.filter((st) => st === 'in-laydown').length === 2) {
        const stack = (await s.controller.query<HatchPanelState[]>('hatchList')).filter((p) => p.status === 'in-laydown')
        expect(new Set(stack.map((p) => p.pos.x)).size).toBe(1)
        expect(Math.abs(stack[0].pos.y - stack[1].pos.y)).toBeCloseTo(HATCH_THICKNESS_M, 6)
      }
    }
    for (const st of ['lifted', 'in-laydown', 'replaced']) expect(seen, `a panel was ${st}`).toContain(st)
    await s.runUntil({ eventType: 'HatchSecured' })
    await checkPanels(s)
  })

  it('with hatch covers off no panel is drawn and the hull has no covers over any bay', async () => {
    const s = await scene('tracer-1sts-10-boxes')
    const state = s.sceneState()
    expect(state.hatchPanels).toEqual({})
    expect(s.stats().hatchPanels).toBe(0)
    const hulls = Object.entries(state.vesselHulls)
    expect(hulls.length).toBeGreaterThan(0)
    for (const [id, hull] of hulls) {
      expect(hull.openHatchBays, id).toEqual(Array.from({ length: VESSEL_CLASSES[hull.sizeClass].bays }, (_, bay) => bay))
    }
  })
})
