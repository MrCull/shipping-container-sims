/**
 * #302: STS booms (boom mode real) raise to pass a vessel's bridge. A gantry move whose path crosses a berthed
 * vessel's accommodation block, with the lowered boom's underside below the air draft plus the clearance, becomes
 * park trolley, raise, gantry boom up, lower. A step to the next clear bay never raises; with
 * `canGantryWithBoomRaised: false` the crossing is blocked.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, stsParkPose, type EngineEvent, type MotionSegment } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig, VesselSizeClass } from '../scenario/types'

const bridgeFixture = fixtures['boom-bridge']

function withClass(sizeClass: VesselSizeClass): ScenarioConfig {
  const config = structuredClone(bridgeFixture)
  config.vessels = config.vessels.map((v) => ({ ...v, sizeClass }))
  return config
}

function run(config: ScenarioConfig) {
  const sim = createSimulation(config)
  const result = sim.runUntil()
  return { sim, result, log: sim.eventLog() }
}

/** Every planned motion segment of one crane, in time order (from the events that carry segments). */
function segmentsOf(log: readonly EngineEvent[], stsId: string): MotionSegment[] {
  const out: MotionSegment[] = []
  for (const e of log) {
    const p = e.payload as { stsId?: string; segments?: MotionSegment[] }
    if (p.stsId === stsId && Array.isArray(p.segments)) out.push(...p.segments.filter((s) => s.entityId === stsId))
  }
  return out.sort((a, b) => a.t0 - b.t0)
}

/** Gantry moves (from, to) planned while the boom was up, i.e. boom-up gantry runs between a raise and a lower. */
function boomUpGantries(segs: readonly MotionSegment[]): MotionSegment[] {
  const out: MotionSegment[] = []
  let up = false
  for (const s of segs) {
    if (s.axis === 'boom') up = s.to > s.from
    else if (s.axis === 'gantry' && up && s.from !== s.to) out.push(s)
  }
  return out
}

describe('STS booms pass a vessel bridge (#302)', () => {
  it('ULCV: the crane crossing the house parks its trolley, raises, gantries boom up and lowers, with no overlap', () => {
    const { sim, result, log } = run(bridgeFixture)
    expect(result.reason).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    const vessel = sim.query.vessel('V001')
    const house = { lo: vessel.berthX! + 26.5, hi: vessel.berthX! + 42.5 }
    const segs = segmentsOf(log, 'STS01')
    const i = segs.findIndex((s) => s.axis === 'gantry' && Math.min(s.from, s.to) < house.hi && Math.max(s.from, s.to) > house.lo)
    expect(i).toBeGreaterThan(0)
    const gantry = segs[i]
    const before = segs.slice(0, i)
    const raise = before.filter((s) => s.axis === 'boom').at(-1)!
    expect(raise.to).toBe(80)
    expect(raise.t1).toBeLessThanOrEqual(gantry.t0)
    // trolley parked on the backreach before the raise (#297 review: `stsParkPose`, class geometry)
    // (no trolley segment: it was still parked there from the start)
    const park = before.filter((s) => s.axis === 'trolley').at(-1)
    expect(park?.to ?? createSimulation(bridgeFixture).query.sts('STS01').trolleyZ).toBeCloseTo(stsParkPose(bridgeFixture, 'STS01').trolleyZ, 6)
    expect(park?.t1 ?? 0).toBeLessThanOrEqual(raise.t0)
    for (const s of before.filter((x) => x.axis === 'hoist')) expect(s.t1).toBeLessThanOrEqual(raise.t0)
    const lower = segs.slice(i + 1).find((s) => s.axis === 'boom')!
    expect(lower.to).toBe(0)
    expect(lower.t0).toBeGreaterThanOrEqual(gantry.t1)
    // the work after the crossing starts only once the boom is down
    const next = segs.slice(i + 1).find((s) => s.axis === 'trolley' || s.axis === 'hoist')!
    expect(next.t0).toBeGreaterThanOrEqual(lower.t1)
    // exactly one boom-up crossing for the crane: every other bay step is boom down
    expect(boomUpGantries(segs)).toHaveLength(1)
  })

  it('a step to the next clear bay never raises', () => {
    const { log } = run(bridgeFixture)
    const segs = segmentsOf(log, 'STS02') // works forward bays, never crosses the house
    expect(segs.filter((s) => s.axis === 'gantry' && s.from !== s.to).length).toBeGreaterThan(1)
    expect(boomUpGantries(segs)).toEqual([])
  })

  it('Feeder: the lowered boom clears the bridge, so the same crossing stays boom down', () => {
    const { sim, result, log } = run(withClass('feeder'))
    expect(result.reason).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(boomUpGantries(segmentsOf(log, 'STS01'))).toEqual([])
  })

  it('canGantryWithBoomRaised false: the crossing is blocked and reported, the crane split is unchanged', () => {
    const config = structuredClone(bridgeFixture)
    config.kinematics.sts.canGantryWithBoomRaised = false
    const { sim, log } = run(config)
    expect(sim.invariantReport().violations).toEqual([])
    const blocked = log.filter((e) => e.type === 'StsGantryBlocked')
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked[0].payload).toMatchObject({ stsId: 'STS01', vesselId: 'V001' })
    expect(boomUpGantries(segmentsOf(log, 'STS01'))).toEqual([])
    const splits = (l: readonly EngineEvent[]) =>
      l.filter((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'craneSplit').map((e) => (e as { payload: { reply: unknown } }).payload.reply)
    expect(splits(log).length).toBeGreaterThan(0)
    expect(splits(log)).toEqual(splits(run(bridgeFixture).log))
  })

  it('boom mode off: no boom motion and no blocking', () => {
    const config = structuredClone(bridgeFixture)
    config.subsystems = { ...config.subsystems, boom: 'off' }
    const { result, log } = run(config)
    expect(result.reason).toBe('ended')
    expect(log.some((e) => e.type.startsWith('StsBoom') || e.type === 'StsGantryBlocked')).toBe(false)
  })
})
