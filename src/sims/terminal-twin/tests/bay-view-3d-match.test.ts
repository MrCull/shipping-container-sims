/**
 * Bay view and 3D vessel agree (spec #154, #159): for a TTI preset vessel, every occupied cell of the bay view holds a
 * box in the 3D scene at the same bay, row and tier, and every box the 3D scene draws on the vessel (worked cargo and
 * ROB) is an occupied cell of the bay view, at the scene's display time. The engine runs ahead of the display while
 * playing (the controller's lookahead, up to 1.5 wall seconds times the speed), so the bay view's engine data is moved
 * back to the display time with the scene model (`bayViewDataAt`). Hide ROB hides ROB in both.
 */
import { describe, expect, it } from 'vitest'
import { buildBayView, bayOrder, type BayView, type BayViewData } from '../modules/bayView'
import { bayViewDataAt } from '../modules/bayViewScene'
import { SceneModel } from '../modules/sceneModel'
import { TTI_PRESET_NAME, presets } from '../scenario/presets'
import { parseVesselSlotId, VESSEL_CLASSES } from '../scenario/vesselClasses'
import { vesselBayNumber, vesselRowNumber, vesselTierNumber } from '../modules/locationNotation'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, WorkerRequest } from '../worker/protocol'

const config = presets[TTI_PRESET_NAME]()
const ENGINE_S = 3 * 3600

/** Maritime "bay/row/tier" of a cell, the bay being the odd 20 ft bay of a half or the even 40 ft bay. */
const key = (bay: number, row: number, tier: number, half: 'aft' | 'fore' | null, sizeClass: BayViewData['sizeClass']): string => {
  const spec = VESSEL_CLASSES[sizeClass]
  return `${vesselBayNumber(bay, spec.bays, half)}/${vesselRowNumber(row, spec.rows)}/${vesselTierNumber(tier, spec.holdTiers)}`
}

/** Cells of the bay view that hold a box on board: a box still to discharge, a loaded box, a ROB box. */
function bayViewCells(data: BayViewData, opts: { hideRob?: boolean } = {}): string[] {
  const out: string[] = []
  for (const bay of bayOrder(data.sizeClass)) {
    const v: BayView = buildBayView(data, bay, { colourMode: 'status', hideRob: opts.hideRob })
    for (const s of v.sections)
      for (const t of s.tiers)
        for (const p of t.positions)
          for (const c of p.cells) {
            const loadedHere = c.status === 'done' && data.slots.find((x) => x.id === c.slotId)?.purpose !== 'discharge'
            if (c.status === 'planned-discharge' || c.status === 'rob' || loadedHere) out.push(key(bay, p.row, t.tier, c.half, data.sizeClass))
          }
  }
  return out.sort()
}

/** Boxes the 3D scene draws on the vessel at `t`: containers whose custody is one of its slots, plus its ROB boxes. */
function sceneCells(model: SceneModel, vesselId: string, t: number, opts: { hideRob?: boolean } = {}): string[] {
  const sizeClass = model.vesselConfig(vesselId).sizeClass
  const out: string[] = []
  for (const id of model.containerIds) {
    const c = model.custodyAt(id, t)
    if (c?.kind !== 'vesselSlot') continue
    const s = parseVesselSlotId(c.id)
    if (s.vesselId === vesselId) out.push(key(s.bay, s.row, s.tier, s.half, sizeClass))
  }
  if (!opts.hideRob) for (const b of model.robBoxesOf(vesselId)) out.push(key(b.bay, b.row, b.tier, b.half, sizeClass))
  return out.sort()
}

async function run(): Promise<{ model: SceneModel; data: Record<string, BayViewData> }> {
  const host = createEngineHost()
  const model = new SceneModel(config, config.seed)
  let rid = 0
  const call = async (req: WorkerRequest): Promise<{ delta: Delta; result: unknown }> => {
    const reply = await host.handle({ ...req, rid: ++rid })
    if (!reply.ok) throw new Error(reply.error)
    model.apply(reply.delta)
    return reply
  }
  await call({ op: 'load', config, seed: config.seed })
  await call({ op: 'run', condition: { time: ENGINE_S } })
  const data: Record<string, BayViewData> = {}
  for (const v of config.vessels) data[v.id] = (await call({ op: 'query', kind: 'bayView', id: v.id })).result as BayViewData
  return { model, data }
}

describe('bay view and 3D vessel show the same boxes (TTI preset)', async () => {
  const { model, data } = await run()
  const ids = config.vessels.map((v) => v.id)
  // display times behind the engine, as while playing at speed, and the engine time itself (paused)
  const times = [ENGINE_S * 0.3, ENGINE_S * 0.5, ENGINE_S * 0.7, ENGINE_S * 0.9, ENGINE_S]

  it('the run works a vessel: its boxes change between the display times', () => {
    const moving = ids.some((id) => new Set(times.map((t) => sceneCells(model, id, t).join())).size > 1)
    expect(moving).toBe(true)
  })

  it('every occupied bay view cell has a 3D box at the same bay, row and tier, and vice versa, at every display time', () => {
    let compared = 0
    for (const id of ids) {
      for (const t of times) {
        const scene = sceneCells(model, id, t)
        expect(bayViewCells(bayViewDataAt(data[id], model, t)), `${id} at ${t}`).toEqual(scene)
        compared += scene.length
      }
    }
    expect(compared).toBeGreaterThan(0)
  })

  it('the 3D ROB boxes are the live ROB boxes the bay view reads', () => {
    for (const id of ids) expect(model.robBoxesOf(id)).toEqual(data[id].robBoxes)
    expect(ids.some((id) => data[id].robBoxes.length > 0)).toBe(true)
  })

  it('Hide ROB hides the ROB cells in the bay view as it hides the ROB boxes in 3D', () => {
    for (const id of ids) {
      const synced = bayViewDataAt(data[id], model, ENGINE_S)
      expect(bayViewCells(synced, { hideRob: true })).toEqual(sceneCells(model, id, ENGINE_S, { hideRob: true }))
      if (synced.robBoxes.length === 0) continue
      const views = bayOrder(synced.sizeClass).map((bay) => buildBayView(synced, bay, { colourMode: 'status', hideRob: true }))
      expect(views.reduce((n, v) => n + v.counts.rob, 0)).toBe(0)
      // the strip still marks the ROB bays, so a hidden ROB bay does not read as an empty one
      expect(views[0].strip.some((e) => e.rob)).toBe(true)
    }
  })
})
