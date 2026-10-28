/**
 * The dashboard's data over the worker protocol (one `dashboard` query): the same
 * numbers the engine reports, including the live per-block yard fill.
 */
import { describe, expect, it } from 'vitest'
import { buildTimeline, createSimulation } from '../engine'
import { blockFillPct } from '../modules/dashboardModel'
import { fixtures } from '../scenario/fixtures'
import { createEngineHost } from '../worker/engineHost'
import type { DashboardData, WorkerReply, WorkerRequest } from '../worker/protocol'

async function hostRun(fixture: string, condition: object = {}) {
  const host = createEngineHost()
  let rid = 0
  const call = async (req: WorkerRequest): Promise<Extract<WorkerReply, { ok: true }>> => {
    const reply = await host.handle({ ...req, rid: rid++ } as never)
    if (!reply.ok) throw new Error(reply.error)
    return reply
  }
  await call({ op: 'load', config: fixtures[fixture], seed: fixtures[fixture].seed })
  await call({ op: 'run', condition })
  return call
}

describe('dashboard query', () => {
  it('returns the KPI series, the vessel timeline and the per-block yard fill of the engine', async () => {
    const fixture = 'asc-1sts-10-boxes-1block'
    const call = await hostRun(fixture)
    const sim = createSimulation(fixtures[fixture])
    sim.runUntil()
    const data = (await call({ op: 'query', kind: 'dashboard' })).result as DashboardData
    expect(data.series).toEqual(sim.kpiSeries())
    expect(data.timeline).toEqual(buildTimeline(sim.eventLog(), sim.now))
    expect(data.yard.map((b) => b.id)).toEqual(sim.query.yardBlocks().map((b) => b.id))
    for (const b of sim.query.yardBlocks()) {
      const row = data.yard.find((y) => y.id === b.id)!
      expect(row.fillPct).toBe(blockFillPct(b, sim.query.yardSlots(b.id)))
      expect(row.fillPct).toBeGreaterThan(0)
    }
  })

  it('works for a scenario without a yard (no blocks)', async () => {
    const call = await hostRun('two-vessels-compete-for-berth')
    const data = (await call({ op: 'query', kind: 'dashboard' })).result as DashboardData
    expect(data.yard).toEqual([])
    expect(data.timeline.vessels).toHaveLength(2)
  })
})
