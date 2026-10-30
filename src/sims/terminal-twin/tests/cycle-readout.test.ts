/** TT-15: the setup dialog's derived nominal STS cycle matches the engine's measured average in a single-crane fixture. */
import { describe, expect, it } from 'vitest'
import { createSimulation, stsCycleGeometry, stsNominalCycle, shcNominalCycle, ascNominalCycle } from '../engine'
import type { StsKinematics } from '../scenario/types'
import { DEFAULT_ASC_KINEMATICS, DEFAULT_SHC_KINEMATICS, ScenarioBuilder } from '../scenario/builder'

function singleCraneRun(stsOverride?: Partial<StsKinematics>) {
  const b = new ScenarioBuilder('cycle', 'one crane (SHCs clear its ground positions), no variation').hatch({ enabled: false })
    .seed(3)
    .quay(400, { mooringS: 60, unmooringS: 60, twinLift: false })
    .sts('STS01', { gantryX: 100, groundPositions: 3 })
    .vesselCall('V001', { name: 'Cycle', sizeClass: 'feeder', discharge: 120, maxSts: 1, sizeMix: { '40': 1 } })
    .shcs(6)
    .block('B01', { x: 100, bays: 30, tiers: 4 })
    .block('B02', { x: 140, bays: 30, tiers: 4 })
    .endWhen({ vesselsCompleted: 1 })
  if (stsOverride) b.stsKinematics(stsOverride)
  const config = b.build()
  const sim = createSimulation(config)
  sim.runUntil()
  const picks = sim.eventLog().filter((e) => e.type === 'StsPicked').map((e) => e.t)
  const intervals = picks.slice(1).map((t, i) => t - picks[i])
  const measured = intervals.reduce((a, b) => a + b, 0) / intervals.length
  return { config, measured, picks: picks.length }
}

describe('nominal cycle readout', () => {
  it('STS: the derived cycle is within 15% of the measured average', () => {
    const { config, measured, picks } = singleCraneRun()
    expect(picks).toBe(120)
    const nominal = stsNominalCycle(config.kinematics.sts, config.layout.stsSafeHoistM, stsCycleGeometry(config))
    expect(Math.abs(nominal.cycleS - measured) / measured).toBeLessThan(0.15)
    expect(nominal.perHour).toBeCloseTo(3600 / nominal.cycleS, 6)
  })

  it('STS: a faster trolley and hoist shorten both the readout and the measured cycle', () => {
    const slow = singleCraneRun()
    const k = slow.config.kinematics.sts
    const fast = singleCraneRun({
      trolley: { ...k.trolley, vMax: k.trolley.vMax * 2 },
      hoistLoaded: { ...k.hoistLoaded, vMax: k.hoistLoaded.vMax * 2 },
      hoistEmpty: { ...k.hoistEmpty, vMax: k.hoistEmpty.vMax * 2 },
    })
    const nominal = (r: typeof slow) => stsNominalCycle(r.config.kinematics.sts, 50, stsCycleGeometry(r.config)).cycleS
    expect(nominal(fast)).toBeLessThan(nominal(slow))
    expect(fast.measured).toBeLessThan(slow.measured)
  })

  it('SHC and ASC readouts are positive and respond to speed', () => {
    const shc = shcNominalCycle(DEFAULT_SHC_KINEMATICS)
    const fastShc = shcNominalCycle({ ...DEFAULT_SHC_KINEMATICS, driveEmpty: { ...DEFAULT_SHC_KINEMATICS.driveEmpty, vMax: 20 } })
    expect(fastShc.cycleS).toBeLessThan(shc.cycleS)
    const asc = ascNominalCycle(DEFAULT_ASC_KINEMATICS)
    expect(asc.cycleS).toBeGreaterThan(0)
    expect(ascNominalCycle({ ...DEFAULT_ASC_KINEMATICS, gantry: { ...DEFAULT_ASC_KINEMATICS.gantry, vMax: 0.5 } }).cycleS).toBeGreaterThan(asc.cycleS)
  })
})
