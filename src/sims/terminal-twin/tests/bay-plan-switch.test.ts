/**
 * #162: the bay viewer's Load plan | Discharge plan switch. Load shows planned-load and loaded cells, Discharge shows
 * planned-discharge and discharged cells, ROB shows in both (subject to Hide ROB); a box on a spreader shows in the plan
 * of its move. The view-model is the seam for what each plan shows; the twin store (over the engine host in-process) for
 * the default, keeping the choice across vessels and going back to Load on a new run.
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import { bayOrder, buildBayView, defaultBay, stripOf, type BayCell, type BayPlan, type BayView, type BayViewData, type CellStatus } from '../modules/bayView'
import { collectBayViewData } from '../modules/bayViewData'
import type { EngineResponse } from '../modules/engineClient'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EngineInfo, WorkerRequest } from '../worker/protocol'

vi.mock('../modules/engineClient', () => ({
  EngineClient: class {
    private host = createEngineHost()
    private rid = 0
    async request<T>(req: WorkerRequest): Promise<EngineResponse<T>> {
      const reply = await this.host.handle({ ...req, rid: ++this.rid })
      if (!reply.ok) throw new Error(reply.error)
      return { result: reply.result as T, delta: reply.delta as Delta, info: reply.info as EngineInfo }
    }
    dispose() {}
  },
}))

const { useTwinStore } = await import('../store/twinStore')

const config = fixtures['rob-bays'] as ScenarioConfig
const sim = createSimulation(config, {}, { invariants: { sweepEvery: 500 } })
const before: BayViewData = collectBayViewData(sim.query, 'V001', config)

const allCells = (v: BayView): BayCell[] => v.sections.flatMap((s) => s.tiers.flatMap((t) => t.positions.flatMap((p) => p.cells)))
const cellsOf = (data: BayViewData, plan: BayPlan | undefined, hideRob = false): BayCell[] =>
  bayOrder(data.sizeClass).flatMap((bay) => allCells(buildBayView(data, bay, { colourMode: 'status', plan, hideRob })))
const statuses = (cells: BayCell[]): Set<CellStatus> => new Set(cells.filter((c) => c.status !== 'empty').map((c) => c.status))

/** The data with one discharge box and one load box on a spreader (in progress), one box discharged and one loaded. */
function midRun(): { data: BayViewData; discharging: string; discharged: string; loading: string; loaded: string } {
  const [disSlot, dischargedSlot] = before.slots.filter((s) => s.purpose === 'discharge' && s.containerId !== null)
  const [loadSlot, loadedSlot] = before.slots.filter((s) => s.purpose !== 'discharge' && s.plannedContainerId)
  const slots = before.slots.map((s) => {
    if (s.id === disSlot.id || s.id === dischargedSlot.id) return { ...s, containerId: null }
    if (s.id === loadedSlot.id) return { ...s, containerId: s.plannedContainerId! }
    return s
  })
  const boxes = { ...before.boxes }
  boxes[disSlot.id] = { ...boxes[disSlot.id], custody: 'sts' }
  boxes[dischargedSlot.id] = { ...boxes[dischargedSlot.id], custody: 'groundPosition' }
  boxes[loadSlot.id] = { ...boxes[loadSlot.id], custody: 'sts' }
  boxes[loadedSlot.id] = { ...boxes[loadedSlot.id], custody: 'vesselSlot' }
  return { data: { ...before, slots, boxes }, discharging: disSlot.id, discharged: dischargedSlot.id, loading: loadSlot.id, loaded: loadedSlot.id }
}

describe('Load plan | Discharge plan (view-model)', () => {
  it('Load shows planned-load, loaded and ROB cells only; Discharge shows planned-discharge, discharged and ROB only', () => {
    const { data } = midRun()
    expect(statuses(cellsOf(data, 'load'))).toEqual(new Set(['planned-load', 'in-progress', 'done', 'rob']))
    expect(statuses(cellsOf(data, 'discharge'))).toEqual(new Set(['planned-discharge', 'in-progress', 'done', 'rob']))
    // every cell shown in a plan is a slot of that plan's move (or ROB)
    const purposeOf = new Map(data.slots.map((s) => [s.id, s.purpose]))
    for (const c of cellsOf(data, 'load').filter((x) => x.status !== 'empty' && !x.rob)) expect(purposeOf.get(c.slotId)).not.toBe('discharge')
    for (const c of cellsOf(data, 'discharge').filter((x) => x.status !== 'empty' && !x.rob)) expect(purposeOf.get(c.slotId)).toBe('discharge')
  })

  it('a box on the spreader shows in the plan of its move only', () => {
    const { data, discharging, discharged, loading, loaded } = midRun()
    const statusIn = (plan: BayPlan, slotId: string): CellStatus | undefined => cellsOf(data, plan).find((c) => c.slotId === slotId)?.status
    expect(statusIn('discharge', discharging)).toBe('in-progress')
    expect(statusIn('load', discharging)).toBe('empty')
    expect(statusIn('load', loading)).toBe('in-progress')
    expect(statusIn('discharge', loading)).toBe('empty')
    expect(statusIn('load', loaded)).toBe('done')
    expect(statusIn('discharge', loaded)).toBe('empty')
    expect(statusIn('discharge', discharged)).toBe('done')
    expect(statusIn('load', discharged)).toBe('empty')
  })

  it('splits the cells of the combined view between the two plans, ROB in both', () => {
    const count = (cells: BayCell[], s: CellStatus): number => cells.filter((c) => c.status === s).length
    const both = cellsOf(before, undefined)
    const load = cellsOf(before, 'load')
    const dis = cellsOf(before, 'discharge')
    expect(count(load, 'planned-load')).toBe(count(both, 'planned-load'))
    expect(count(dis, 'planned-discharge')).toBe(count(both, 'planned-discharge'))
    expect(count(load, 'planned-load')).toBeGreaterThan(0)
    expect(count(dis, 'planned-discharge')).toBeGreaterThan(0)
    expect(count(load, 'rob')).toBe(before.robBoxes.length)
    expect(count(dis, 'rob')).toBe(before.robBoxes.length)
  })

  it('Hide ROB hides ROB in both plans', () => {
    for (const plan of ['load', 'discharge'] as const) expect(cellsOf(before, plan, true).some((c) => c.rob)).toBe(false)
  })

  it('the state legend lists only the statuses of the plan, plus ROB', () => {
    const legend = (plan: BayPlan): string[] => buildBayView(before, defaultBay(before), { colourMode: 'status', plan }).legend.map((l) => l.key)
    expect(legend('load')).toEqual(['planned-load', 'in-progress', 'done', 'rob'])
    expect(legend('discharge')).toEqual(['planned-discharge', 'in-progress', 'done', 'rob'])
    expect(buildBayView(before, defaultBay(before), { colourMode: 'status', plan: 'load' }).plan).toBe('load')
  })

  it('the work packages and the strip progress follow the plan', () => {
    const run = createSimulation(config, {}, { invariants: { sweepEvery: 500 } })
    run.runUntil({ eventType: 'StsPicked' })
    const data = collectBayViewData(run.query, 'V001', config)
    for (const bay of bayOrder(data.sizeClass)) {
      expect(buildBayView(data, bay, { colourMode: 'status', plan: 'load' }).packages.every((p) => p.kind !== 'discharge')).toBe(true)
      expect(buildBayView(data, bay, { colourMode: 'status', plan: 'discharge' }).packages.every((p) => p.kind !== 'load')).toBe(true)
    }
    const total = (plan: BayPlan): number => stripOf(data, plan).reduce((n, e) => n + e.total, 0)
    const cells = (plan: BayPlan, s: CellStatus[]): number => cellsOf(data, plan).filter((c) => s.includes(c.status)).length
    expect(total('load')).toBe(cells('load', ['planned-load', 'in-progress', 'done']))
    expect(total('discharge')).toBe(cells('discharge', ['planned-discharge', 'in-progress', 'done']))
  })
})

describe('Load plan | Discharge plan (store)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const SCENARIO = 'two-vessels-compete-for-berth'

  it('defaults to Load, keeps the choice across vessels in a run, and goes back to Load on a new run', async () => {
    const store = useTwinStore()
    expect(store.bayPlan).toBe('load')
    await store.startScenario({ ...store.choice, name: SCENARIO, seed: 3 })
    await store.openBayViewer('V001')
    expect(store.bayPlan).toBe('load')
    store.setBayPlan('discharge')
    await store.openBayViewer('V002')
    expect(store.bayPlan).toBe('discharge')
    store.closeBayViewer()
    await store.openBayViewer('V001')
    expect(store.bayPlan).toBe('discharge')

    await store.reset()
    expect(store.bayPlan).toBe('load')

    store.setBayPlan('discharge')
    store.newScenario()
    await store.startScenario({ ...store.choice, name: SCENARIO, seed: 4 })
    expect(store.bayPlan).toBe('load')
  })
})
