/** Spec #116 / #117: the STS time breakdown from an event log, and the peak-day measurement it exists for. */
import { describe, expect, it } from 'vitest'
import { STS_TIME_BUCKETS, stsProductivity } from '../engine'
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

  it('ignores cranes that never started a package', () => {
    expect(stsProductivity([ev(5, 'StsWaitingForRail', { stsId: 'S9' })], 100).rows).toEqual([])
  })
})
