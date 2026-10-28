/** End conditions (TT-07): N vessels, sim duration, total moves; the first one met ends the run. */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent } from '../engine'
import type { EndConditions } from '../scenario/types'
import { fixtures } from '../scenario/fixtures'

function endRun(fixture: string, endConditions: EndConditions) {
  const sim = createSimulation({ ...fixtures[fixture], endConditions })
  const result = sim.runUntil()
  const log = sim.eventLog()
  const last = log[log.length - 1] as EngineEvent
  return { sim, result, log, last, kpis: sim.kpiReport() }
}
const times = (log: readonly EngineEvent[], type: string) => log.filter((e) => e.type === type).map((e) => e.t)

describe('end conditions', () => {
  it('moves: ends on the Nth move, not before and not after', () => {
    const { last, log, kpis, result } = endRun('tracer-1sts-10-boxes', { moves: 4 })
    expect(result.reason).toBe('ended')
    expect(last.type).toBe('ScenarioEnded')
    expect((last.payload as { reason: string }).reason).toBe('moves >= 4')
    expect(kpis.movesCompleted).toBe(4)
    expect(last.t).toBe(times(log, 'StsGrounded')[3])
  })

  it('simDurationS: ends exactly at the duration, between events', () => {
    const { last, kpis } = endRun('tracer-1sts-10-boxes', { simDurationS: 700 })
    expect((last.payload as { reason: string }).reason).toBe('simDurationS >= 700')
    expect(last.t).toBe(700)
    expect(kpis.simTimeS).toBe(700)
    expect(kpis.movesCompleted).toBeGreaterThan(0)
    expect(kpis.movesCompleted).toBeLessThan(10)
  })

  it('vesselsCompleted: ends when the Nth vessel has departed', () => {
    const { last, log, kpis } = endRun('two-vessels-compete-for-berth', { vesselsCompleted: 1 })
    expect((last.payload as { reason: string }).reason).toBe('vesselsCompleted >= 1')
    expect(kpis.vesselsCompleted).toBe(1)
    expect(last.t).toBe(times(log, 'VesselDeparted')[0])
  })

  it('default (nothing set): ends when every scheduled vessel has departed', () => {
    const { kpis, last } = endRun('two-vessels-compete-for-berth', {})
    expect(kpis.vesselsCompleted).toBe(2)
    expect((last.payload as { reason: string }).reason).toBe('vesselsCompleted >= 2')
  })

  it('several enabled: the earliest one wins', () => {
    const sooner = endRun('tracer-1sts-10-boxes', { moves: 3, simDurationS: 5000, vesselsCompleted: 1 })
    expect((sooner.last.payload as { reason: string }).reason).toBe('moves >= 3')
    const timeFirst = endRun('tracer-1sts-10-boxes', { moves: 10, simDurationS: 300, vesselsCompleted: 1 })
    expect((timeFirst.last.payload as { reason: string }).reason).toBe('simDurationS >= 300')
    expect(timeFirst.last.t).toBe(300)
    const vesselFirst = endRun('two-vessels-compete-for-berth', { vesselsCompleted: 1, simDurationS: 10 ** 7, moves: 10 ** 6 })
    expect((vesselFirst.last.payload as { reason: string }).reason).toBe('vesselsCompleted >= 1')
  })

  it('an unreachable condition lets the run end by itself when nothing is left to do', () => {
    const { result, last } = endRun('tracer-1sts-10-boxes', { moves: 1000 })
    expect(result.reason).not.toBe('ended')
    expect(last.type).not.toBe('ScenarioEnded')
  })
})
