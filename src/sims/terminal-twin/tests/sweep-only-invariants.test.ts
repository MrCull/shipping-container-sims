import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation, type InvariantReport, type SimSnapshot } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets, TTI_PRESET_NAME } from '../scenario/presets'
import { createEngineHost } from '../worker/engineHost'

/** #252: sweep-only checking (the browser worker's default) changes nothing but the cost of the run. */
describe('sweep-only invariant checks', () => {
  for (const name of ['tracer-1sts-10-boxes', 'asc-1sts-10-boxes-1block'] as const) {
    it(`${name}: same event-log hash as the per-event check`, () => {
      const per = createSimulation(fixtures[name])
      per.runUntil()
      const sweep = createSimulation(fixtures[name], {}, { invariants: { perEvent: false } })
      sweep.runUntil()
      expect(sweep.eventLogHash()).toBe(per.eventLogHash())
      expect(sweep.invariantReport().violations).toEqual([])
      expect(sweep.invariantReport().checks).toBeLessThan(per.invariantReport().checks)
      expect(sweep.invariantStats().sweeps).toBeGreaterThan(0)
    })
  }

  it('a TTI preset slice: same hash, far fewer checks', () => {
    const config = presets[TTI_PRESET_NAME]()
    const per = createSimulation(config)
    per.runUntil({ maxEvents: 3000 })
    const sweep = createSimulation(config, {}, { invariants: { perEvent: false } })
    sweep.runUntil({ maxEvents: 3000 })
    expect(sweep.eventLogHash()).toBe(per.eventLogHash())
    expect(sweep.invariantReport().checks).toBeLessThan(per.invariantReport().checks / 10)
  })

  it('a tampered state is caught at the next sweep, and the report says a sweep found it', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil({ eventType: 'AscStacked' })
    sim.runUntil({ eventType: 'AscStacked' })
    const snap: SimSnapshot = sim.snapshot()
    const slot = Object.values(snap.state.yardSlots).find((s) => s.containerId)
    if (!slot) throw new Error('no stacked box')
    slot.tier = 3 // floating
    const resumed = restoreSimulation(snap, {}, { invariants: { perEvent: false, sweepEvery: 5 } })
    for (let i = 0; i < 50 && resumed.status === 'ready'; i++) resumed.step()
    expect(resumed.status).toBe('failed')
    const v = resumed.invariantReport().violations[0]
    expect(v.invariant).toBe('yard.no-floating')
    expect(v.foundBy).toBe('sweep')
    expect(resumed.firstError?.message).toMatch(/found by a sweep/)
    const last = resumed.eventLog().at(-1)
    if (last?.type !== 'InvariantViolated') throw new Error('expected InvariantViolated')
    expect(last.payload.foundBy).toBe('sweep')
  })

  it('the per-event check never reports foundBy', () => {
    const sim = createSimulation(fixtures['tracer-1sts-10-boxes'], { stsGroundPosition: (m) => ({ groundPositionId: m.payload.groundPositions[0].id }) })
    sim.runUntil()
    expect(sim.invariantReport().violations[0].foundBy).toBeUndefined()
  })
})

describe('the worker host', () => {
  async function reportAfterRun(strict: boolean | undefined): Promise<InvariantReport> {
    const host = createEngineHost()
    let rid = 0
    const call = async (req: Record<string, unknown>) => {
      const r = await host.handle({ ...req, rid: ++rid } as never)
      if (!r.ok) throw new Error(r.error)
      return r.result
    }
    await call({ op: 'load', config: fixtures['asc-1sts-10-boxes-1block'], seed: 1, strict })
    await call({ op: 'run', condition: {} })
    return (await call({ op: 'query', kind: 'invariants' })) as InvariantReport
  }

  it('checks by sweeps only by default, per event with strict checks', async () => {
    const lax = await reportAfterRun(undefined)
    const strict = await reportAfterRun(true)
    expect(lax.violations).toEqual([])
    expect(strict.violations).toEqual([])
    expect(strict.checks).toBeGreaterThan(lax.checks * 2)
  })
})
