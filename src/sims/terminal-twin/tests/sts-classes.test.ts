/**
 * #303 STS classes: a 43 m Super Post-Panamax crane is left out of the crane split of a vessel whose top deck tier it
 * cannot reach (a ULCV) and works a Panamax; its hoist never goes above its lift height (`sts.class-limits`).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, planSegment, restoreSimulation, stsCanWork, stsLimits, type Simulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { presets } from '../scenario/presets'
import { STS_CRANE_CLASSES, type VesselSizeClass } from '../scenario/types'
import { TTI_PRESET_NAME } from '../terminals/tti-algeciras/constants'

/** Two cranes: STS01 Super Post-Panamax (43 m), STS02 Malaccamax (52 m); one vessel of `sizeClass`. */
function twoClasses(sizeClass: VesselSizeClass) {
  return new ScenarioBuilder(`classes-${sizeClass}`, 'one SPP and one Malaccamax crane')
    .hatch({ enabled: false })
    .quay(600, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS02', { gantryX: 200, groundPositions: 30 })
    .vesselCall('V001', { sizeClass, discharge: 24, maxSts: 2, sizeMix: { '40': 1 } })
    .build()
}

function splitCranes(sim: Simulation): string[] {
  const ev = sim.eventLog().find((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'craneSplit')
  if (ev?.type !== 'DecisionResolved' || ev.payload.decisionPoint !== 'craneSplit') throw new Error('no crane split')
  return ev.payload.reply.assignments.map((a) => a.stsId).sort()
}

describe('STS crane classes (#303)', () => {
  it('class limits come from the knowledge file: 43 m / 65 m Super Post-Panamax, 52 m / 68 m Malaccamax', () => {
    expect(STS_CRANE_CLASSES['super-post-panamax']).toMatchObject({ liftHeightM: 43, outreachM: 65, rows: 24 })
    expect(STS_CRANE_CLASSES.malaccamax).toMatchObject({ liftHeightM: 52, outreachM: 68, rows: 25 })
    const config = twoClasses('panamax')
    expect(stsLimits(config, 'STS01')).toMatchObject({ craneClass: 'super-post-panamax', liftHeightM: 43, boomUndersideM: 46.6 })
    expect(stsLimits(config, 'STS02')).toMatchObject({ craneClass: 'malaccamax', liftHeightM: 52, boomUndersideM: 55.6 })
  })

  it('a 43 m crane cannot reach a ULCV top deck tier but reaches a Panamax; a Malaccamax reaches both', () => {
    const config = twoClasses('ulcv')
    expect(stsCanWork(config, 'STS01', 'ulcv')).toBe(false)
    expect(stsCanWork(config, 'STS01', 'neo-panamax')).toBe(true)
    expect(stsCanWork(config, 'STS01', 'panamax')).toBe(true)
    expect(stsCanWork(config, 'STS02', 'ulcv')).toBe(true)
    // outreach: a crane whose outreach stops short of the outer row is out of reach too
    const short = { ...config, sts: config.sts.map((s) => (s.id === 'STS02' ? { ...s, outreachM: 40 } : s)) }
    expect(stsCanWork(short, 'STS02', 'ulcv')).toBe(false)
  })

  it('the crane split leaves the 43 m crane out of a ULCV and includes it for a Panamax', () => {
    const ulcv = createSimulation(twoClasses('ulcv'))
    expect(ulcv.runUntil().reason).toBe('ended')
    expect(splitCranes(ulcv)).toEqual(['STS02'])
    expect(ulcv.kpiReport().sts.STS01.moves).toBe(0)
    expect(ulcv.invariantReport().violations).toEqual([])

    const panamax = createSimulation(twoClasses('panamax'))
    expect(panamax.runUntil().reason).toBe('ended')
    expect(splitCranes(panamax)).toEqual(['STS01', 'STS02'])
    expect(panamax.kpiReport().sts.STS01.moves).toBeGreaterThan(0)
    expect(panamax.invariantReport().violations).toEqual([])
  })

  it('a 43 m crane never hoists above its lift height (the layout safe hoist is 50 m)', () => {
    const config = twoClasses('panamax')
    expect(config.layout.stsSafeHoistM).toBeGreaterThan(43)
    const sim = createSimulation(config)
    let top = 0
    sim.subscribe(() => {
      for (const m of sim.query.sts('STS01').motion) if (m.axis === 'hoist') top = Math.max(top, m.from, m.to)
    })
    expect(sim.runUntil().reason).toBe('ended')
    expect(top).toBeGreaterThan(30)
    expect(top).toBeLessThanOrEqual(43)
  })

  it('the sts.class-limits invariant catches a hoist above the lift height', () => {
    const sim = createSimulation(twoClasses('panamax'))
    sim.runUntil({ time: 30 })
    const snap = sim.snapshot()
    const now = snap.state.now
    // STS01 (43 m) gets a hoist move to 48 m, still under way at the next event
    const hoist = planSegment('STS01', 'hoist', 30, 48, now, { vMax: 1.5, accel: 0.6, decel: 0.6 })
    hoist.t1 = now + 3600
    snap.state.sts.STS01.motion = [hoist]
    const resumed = restoreSimulation(snap)
    resumed.runUntil()
    const v = resumed.invariantReport().violations
    expect(v[0]?.invariant).toBe('sts.class-limits')
    expect(v[0]?.message).toMatch(/STS01 \(super-post-panamax\) hoists to 48\.00 m, above its 43 m lift height/)
  })

  it('the TTI presets make 101 to 103 Super Post-Panamax and 104 to 108 Malaccamax', () => {
    const config = presets[TTI_PRESET_NAME]()
    const classes = Object.fromEntries(config.sts.map((s) => [s.id, stsLimits(config, s.id).craneClass]))
    expect(classes).toEqual({
      STS101: 'super-post-panamax',
      STS102: 'super-post-panamax',
      STS103: 'super-post-panamax',
      STS104: 'malaccamax',
      STS105: 'malaccamax',
      STS106: 'malaccamax',
      STS107: 'malaccamax',
      STS108: 'malaccamax',
    })
  })
})
