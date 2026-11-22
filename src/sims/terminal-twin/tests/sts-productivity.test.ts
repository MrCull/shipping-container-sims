/** Spec #116 / #117: the STS time breakdown from an event log, and the peak-day measurement it exists for. */
import { describe, expect, it } from 'vitest'
import { createSimulation, STS_TIME_BUCKETS, stsProductivity } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { EngineEvent } from '../engine'

const ev = (t: number, type: string, payload: Record<string, unknown>): EngineEvent =>
  ({ id: t, seq: t, t, type, causedBy: null, subjects: {}, payload }) as unknown as EngineEvent

describe('stsProductivity', () => {
  it('splits a crane window by the event that opened each state and counts grounded and loaded boxes', () => {
    const log = [
      ev(0, 'ScenarioStarted', {}),
      ev(100, 'WorkPackageStarted', { stsId: 'S1', packageId: 'WP1' }),
      ev(100, 'StsMoveStarted', { stsId: 'S1' }),
      ev(160, 'StsGrounded', { stsId: 'S1', containerId: 'A' }),
      ev(200, 'StsWaitingForHatch', { stsId: 'S1' }),
      ev(260, 'StsHatchStarted', { stsId: 'S1' }),
      ev(360, 'StsLoadStarted', { stsId: 'S1' }),
      ev(360, 'StsWaitingForBox', { stsId: 'S1' }),
      ev(560, 'StsBoxWaitEnded', { stsId: 'S1' }),
      ev(600, 'StsLoaded', { stsId: 'S1', containerId: 'B' }),
      ev(700, 'StsWaitingForRail', { stsId: 'S1' }),
      ev(5000, 'VesselDeparted', { vesselId: 'V1' }), // after the window: ignored
    ]
    const r = stsProductivity(log, 800)
    expect(r.rows).toHaveLength(1)
    const [s1] = r.rows
    expect(s1).toMatchObject({ stsId: 'S1', startS: 100, windowS: 700, moves: 2 })
    expect(s1.buckets).toMatchObject({ cycle: 100 + 0 + 40 + 100, hatch: 100, lashing: 60, box: 200, rail: 100, ground: 0, reposition: 0, done: 0 })
    expect(STS_TIME_BUCKETS.reduce((n, b) => n + s1.buckets[b], 0)).toBeCloseTo(s1.windowS)
    expect(r.share.box).toBeCloseTo(200 / 700)
    expect(s1.grossMovesPerHour).toBeCloseTo((2 * 3600) / 700)
  })

  it('#301: boom transitions and boom turns inside a planned cycle (bridge passage) go to the boom bucket', () => {
    const seg = (axis: string, t0: number, t1: number) => ({ entityId: 'S1', axis, t0, t1 })
    const log = [
      ev(100, 'WorkPackageStarted', { stsId: 'S1', packageId: 'WP1' }),
      ev(100, 'StsBoomStarted', { stsId: 'S1', op: 'lower', segments: [] }),
      ev(250, 'StsBoomCompleted', { stsId: 'S1', op: 'lower' }),
      ev(250, 'StsMoveStarted', { stsId: 'S1', segments: [seg('hoist', 250, 270), seg('boom', 270, 420), seg('gantry', 420, 480), seg('boom', 480, 630)] }),
      ev(700, 'StsWorkComplete', { stsId: 'S1' }),
      ev(700, 'StsBoomStarted', { stsId: 'S1', op: 'raise', segments: [] }),
      ev(900, 'StsBoomCompleted', { stsId: 'S1', op: 'raise' }),
    ]
    const [s1] = stsProductivity(log, 1000).rows
    // lower 150 + two turns in the cycle 300 + raise (park and turn) 200
    expect(s1.buckets).toMatchObject({ boom: 650, cycle: 450 - 300, done: 100 })
    expect(STS_TIME_BUCKETS.reduce((n, b) => n + s1.buckets[b], 0)).toBeCloseTo(s1.windowS)
  })

  it('#301: boom fixture: each crane spends one lower and one raise (150 s turn each, plus the park) in the boom bucket', () => {
    const config = fixtures['boom-berthing']
    const sim = createSimulation(config)
    sim.runUntil()
    const r = stsProductivity(sim.eventLog(), sim.now)
    expect(r.rows.length).toBeGreaterThan(0)
    for (const row of r.rows) {
      expect(row.buckets.boom, row.stsId).toBeGreaterThanOrEqual(300)
      expect(row.buckets.boom, row.stsId).toBeLessThan(600) // the park before the raise (hoist up, trolley to the backreach) takes up to a few minutes
    }
    // boom mode off: no boom time, every other bucket as before
    const off = { ...config, subsystems: { ...config.subsystems, boom: 'off' as const } }
    const simOff = createSimulation(off)
    simOff.runUntil()
    expect(stsProductivity(simOff.eventLog(), simOff.now).total.buckets.boom).toBe(0)
  })

  it('ignores cranes that never started a package', () => {
    expect(stsProductivity([ev(5, 'StsWaitingForRail', { stsId: 'S9' })], 100).rows).toEqual([])
  })
})
