/**
 * TT-08: the block conflict fixture, the ascDispatch decision point and the
 * single-ASC regression, through the engine API and decision-point handlers.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, getStrategy, type AscDispatchRequest, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { twinScenario } from './twin-scenario'

describe('block conflict fixture', () => {
  const fixture = fixtures['asc-2asc-block-conflict']

  it('completes without deadlock: every box is stacked and the run ends', () => {
    const sim = createSimulation(fixture)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.kpiReport().yard?.boxesStacked).toBe(30)
    expect(sim.kpiReport().yard?.boxesInTransit).toBe(0)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('records the waits: rail wait KPIs, step-asides and per-job railWaitS on AscJobAssigned', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const ascs = sim.kpiReport().yard!.ascs
    const total = (k: 'railWaitS' | 'yields') => Object.values(ascs).reduce((n, a) => n + (a[k] ?? 0), 0)
    expect(total('railWaitS')).toBeGreaterThan(0)
    expect(total('yields')).toBeGreaterThan(0)
    const waits = sim
      .eventLog()
      .filter((e) => e.type === 'AscJobAssigned')
      .map((e) => (e.payload as { railWaitS?: number }).railWaitS ?? -1)
    expect(waits.every((w) => w >= 0)).toBe(true)
    expect(waits.some((w) => w > 0)).toBe(true)
    expect(sim.eventLog().filter((e) => e.type === 'AscYieldAssigned').length).toBe(total('yields'))
  })

  it('rail segments are reserved and reservations never overlap', () => {
    const sim = createSimulation(fixture)
    const zones = new Set<string>()
    sim.subscribe(() => sim.query.reservations().forEach((r) => zones.add(r.zone)))
    sim.runUntil()
    expect([...zones].some((z) => /^B01:R\d+$/.test(z))).toBe(true)
    expect(sim.invariantReport().violations).toEqual([])
  })
})

describe('ascDispatch decision point', () => {
  const jobs = (sim: Simulation) => Object.fromEntries(Object.entries(sim.kpiReport().yard!.ascs).map(([id, k]) => [id, k.jobs]))

  it('the two built-ins give different utilisation splits on the same seed', () => {
    const split = (dispatch: string) => {
      const sim = createSimulation(twinScenario({ ascs: 2, dispatch, allocation: 'random', boxes: 30, seed: 3 }))
      sim.runUntil()
      expect(sim.kpiReport().handlers.ascDispatch.handler).toBe(`strategy:${dispatch}`)
      return jobs(sim)
    }
    const side = split('waterside-first')
    const balanced = split('balanced')
    // 28, not 30: the tier stow sequence (#174) changes the discharge order, and with it the job count for the same 30
    // moves (as-today gives 30; no reposition happens, so the rail change is not involved). All 30 moves still complete
    // and the balanced split is unchanged (14 and 14)
    expect(side).toEqual({ 'B01-ASC1': 28, 'B01-ASC2': 0 })
    expect(balanced['B01-ASC1']).toBeGreaterThan(8)
    expect(balanced['B01-ASC2']).toBeGreaterThan(8)
  })

  it('the default strategy gives WTP work to the waterside ASC and transfer work to the landside ASC', () => {
    const req = (kind: 'wtp' | 'transfer'): AscDispatchRequest => ({
      blockId: 'B01',
      job: { jobId: 'A1', containerId: 'C1', kind, wtpPadId: 'B01-WTP1', yardSlotId: 'B01:01-1-1', padZ: 10, slotZ: 20 },
      candidates: [
        { ascId: 'B01-ASC1', side: 'waterside', gantryZ: 10, jobs: 0, busyS: 0, canServe: true, needsYield: false },
        { ascId: 'B01-ASC2', side: 'landside', gantryZ: 60, jobs: 0, busyS: 0, canServe: true, needsYield: false },
      ],
      ascs: [],
      minSeparationM: 12,
    })
    const handler = getStrategy('ascDispatch', 'waterside-first')
    const ask = (r: AscDispatchRequest) =>
      handler({ correlationId: 'x', decisionPoint: 'ascDispatch', version: 1, t: 0, payload: r }, {} as never)
    expect(ask(req('wtp'))).toEqual({ ascId: 'B01-ASC1' })
    expect(ask(req('transfer'))).toEqual({ ascId: 'B01-ASC2' })
    // the waterside ASC cannot serve: the landside ASC helps only without a step-aside
    const blocked = req('wtp')
    blocked.candidates[0].canServe = false
    expect(ask(blocked)).toEqual({ ascId: 'B01-ASC2' })
    blocked.candidates[1].needsYield = true
    expect(ask(blocked)).toEqual({ ascId: null })
  })

  it('a custom handler decides, and the request lists both ASCs and who can serve', () => {
    const seen: AscDispatchRequest[] = []
    const sim = createSimulation(twinScenario({ ascs: 2, boxes: 6 }), {
      ascDispatch: (msg) => {
        seen.push(msg.payload)
        const landside = msg.payload.candidates.find((c) => c.side === 'landside' && c.canServe)
        return { ascId: landside?.ascId ?? msg.payload.candidates.find((c) => c.canServe)?.ascId ?? null }
      },
    })
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0].ascs.map((a) => a.side)).toEqual(['waterside', 'landside'])
    expect(seen[0].minSeparationM).toBe(12)
    expect(jobs(sim)['B01-ASC2']).toBeGreaterThan(0)
    expect(sim.kpiReport().yard?.boxesStacked).toBe(6)
  })

  it('a reply of null leaves the box open; it is asked again when the block changes', () => {
    let calls = 0
    const sim = createSimulation(twinScenario({ ascs: 2, boxes: 4 }), {
      ascDispatch: (msg) => {
        calls++
        return { ascId: calls <= 2 ? null : (msg.payload.candidates.find((c) => c.canServe)?.ascId ?? null) }
      },
    })
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.kpiReport().yard?.boxesStacked).toBe(4)
  })

  it('a reply naming an ASC of another block fails the run with a clear message', () => {
    const sim = createSimulation(twinScenario({ ascs: 2, boxes: 3 }), { ascDispatch: () => ({ ascId: 'B09-ASC1' }) })
    sim.runUntil()
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/B09-ASC1.*not an ASC of block B01/)
  })
})

describe('single-ASC blocks are unchanged', () => {
  it('no dispatch decision, no step-asides, no extra KPI fields, no railWaitS on events', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil()
    expect(sim.kpiReport().handlers.ascDispatch).toBeUndefined()
    expect(sim.eventLog().some((e) => e.type === 'AscYieldAssigned')).toBe(false)
    expect(Object.keys(sim.kpiReport().yard!.ascs['B01-ASC1']).sort()).toEqual(['gantryM', 'hoistM', 'jobs', 'padWaitS', 'trolleyM'])
    expect(sim.eventLog().filter((e) => e.type === 'AscJobAssigned').every((e) => !('railWaitS' in e.payload))).toBe(true)
  })
})
