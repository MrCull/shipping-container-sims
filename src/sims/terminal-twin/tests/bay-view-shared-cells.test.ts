/**
 * #205: a cell shared by a discharge box and a load booking (#203) shows in both plans of the bay viewer through a call:
 * the Discharge plan the arrival box (planned, in progress, discharged), the Load plan the booked box (planned, in
 * progress, loaded). Without a plan the cell shows the box that is in it.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { buildBayView, type BayCell, type BayPlan, type BayViewData, type CellStatus } from '../modules/bayView'
import { collectBayViewData } from '../modules/bayViewData'

// a feeder with 60 boxes to discharge and 60 to load, all 40s: the load fills the cells the discharge empties
const config = new ScenarioBuilder('shared', 'shared cells')
  .seed(5)
  .quay(400, { mooringS: 60, unmooringS: 60 })
  .sts('STS01', { gantryX: 60, groundPositions: 3 })
  .vesselCall('V001', { sizeClass: 'feeder', discharge: 60, load: 60, maxSts: 1, sizeMix: { '40': 1 } })
  .shcs(2)
  .block('B01', { x: 20, bays: 40, tiers: 4 })
  .build()
const sim = createSimulation(config, {}, { invariants: { sweepEvery: 500 } })
const dataOf = (): BayViewData => collectBayViewData(sim.query, 'V001', config)
const cellOf = (data: BayViewData, slotId: string, plan?: BayPlan): BayCell => {
  const slot = data.slots.find((s) => s.id === slotId)!
  const v = buildBayView(data, slot.bay, { colourMode: 'status', plan })
  return v.sections.flatMap((s) => s.tiers.flatMap((t) => t.positions.flatMap((p) => p.cells))).find((c) => c.slotId === slotId)!
}

describe('a shared cell in both plans', () => {
  const start = dataOf()
  // a whole-slot shared cell whose load booking names a box (no empties booking, no other shape in the cell)
  const shared = Object.values(start.shared ?? {}).find(
    (c) => c.load && !start.slots.some((o) => o.id !== c.slot.id && o.bay === c.slot.bay && o.row === c.slot.row && o.tier === c.slot.tier),
  )

  it('the scenario has a shared cell with a named load box', () => {
    expect(shared).toBeDefined()
  })

  it('is planned in both plans before the discharge, each plan naming its own box', () => {
    const id = shared!.slot.id
    const d = cellOf(start, id, 'discharge')
    const l = cellOf(start, id, 'load')
    expect([d.status, l.status]).toEqual(['planned-discharge', 'planned-load'])
    expect(d.details.boxId).toBe(shared!.arrival.id)
    expect(l.details.boxId).toBe(shared!.load!.id)
  })

  it('goes discharged then loaded through the call, each plan keeping its own box', () => {
    const id = shared!.slot.id
    const seen: string[] = []
    let sawDone = false
    for (let i = 0; i < 40000; i++) {
      if (!sim.step()) break
      if (i % 5 !== 0) continue
      const data = dataOf()
      const d = cellOf(data, id, 'discharge')
      const l = cellOf(data, id, 'load')
      const key = `${d.status}/${l.status}`
      if (seen[seen.length - 1] !== key) seen.push(key)
      expect(l.details.boxId).toBe(shared!.load!.id)
      expect(d.details.boxId).toBe(shared!.arrival.id)
      if (d.status === 'done' && l.status === 'planned-load') sawDone = true
      if (d.status === 'done' && l.status === 'done') break
    }
    expect(sawDone).toBe(true) // after discharge, before load
    expect(seen[0]).toBe('planned-discharge/planned-load')
    expect(seen[seen.length - 1]).toBe('done/done') // after load
    const order: CellStatus[] = ['planned-discharge', 'in-progress', 'done']
    const dis = seen.map((k) => order.indexOf(k.split('/')[0] as CellStatus))
    expect(dis).toEqual([...dis].sort((a, b) => a - b)) // never goes back
  })

  it('without a plan the cell shows the box that is in it, the loaded one at the end', () => {
    const c = cellOf(dataOf(), shared!.slot.id)
    expect(c.status).toBe('done')
    expect(c.details.boxId).toBe(shared!.load!.id)
  })
})
