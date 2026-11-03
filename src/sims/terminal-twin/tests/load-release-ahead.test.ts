/**
 * #186 load boxes staged on WTP pads ahead of their crane: bounded by `yard.loadReleaseAhead`, never on the crane's
 * ground positions, and the crane's discharge never waits for them. Headless engine API.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent, type Simulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'
import { ScenarioValidationError, validateScenario } from '../scenario/validate'

const DURATION = 4 * 3600
const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) => sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

function scenario(ahead: number | undefined): ScenarioConfig {
  const b = new ScenarioBuilder('load-ahead', 'load release-ahead test')
    .hatch({ enabled: false })
    .seed(7)
    .moveVariation(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    // 40 ft boxes only: twin-20 lifts (#187) discharge faster than a pad frees, which is not what this test is about
    .vesselCall('V001', { name: 'First', sizeClass: 'feeder', discharge: 20, load: 8, maxSts: 1, sizeMix: { '40': 1 } })
    .shcs(3)
    .block('B01', { x: 20, bays: 12, tiers: 4 })
    .yardStart({ mode: 'prefilled', targetPct: 40 })
    .endWhen({ simDurationS: DURATION })
  if (ahead !== undefined) b.loadReleaseAhead(ahead)
  return b.build()
}

/** Run in 20 s steps, noting how many load boxes are staged ahead and when one first stood on a pad without a ground position. */
function sample(ahead: number) {
  const sim = createSimulation(scenario(ahead))
  let maxAhead = 0
  let padSeenAt: number | null = null
  for (let t = 20; t <= DURATION; t += 20) {
    sim.runUntil({ time: t })
    const orders = sim.query.loadOrders()
    maxAhead = Math.max(maxAhead, orders.filter((o) => o.stage === 'staging' || o.stage === 'padded').length)
    if (padSeenAt === null && orders.some((o) => o.stage === 'padded' && o.groundPositionId === null)) padSeenAt = t
  }
  return { sim, maxAhead, padSeenAt }
}

const firstLoadAskT = (sim: Simulation): number =>
  ofType(sim, 'DecisionResolved').find((e) => e.payload.decisionPoint === 'stsGroundPosition' && e.payload.request.direction === 'load')?.t ?? Infinity

describe('load release-ahead (#186)', () => {
  const r = sample(2)

  it('puts load boxes on WTP pads before their crane asks for a ground position, within the bound', () => {
    expect(r.padSeenAt).not.toBeNull()
    expect(r.padSeenAt as number).toBeLessThan(firstLoadAskT(r.sim))
    expect(r.maxAhead).toBeGreaterThan(0)
    expect(r.maxAhead).toBeLessThanOrEqual(2)
  })

  it('claims no ground position for a load box until the discharge is done, and loads every box', () => {
    const lastDischarge = Math.max(...ofType(r.sim, 'StsGrounded').map((e) => e.t))
    expect(firstLoadAskT(r.sim)).toBeGreaterThanOrEqual(lastDischarge)
    expect(ofType(r.sim, 'StsGrounded').filter((e) => e.t <= firstLoadAskT(r.sim)).length).toBe(ofType(r.sim, 'StsGrounded').length)
    expect(ofType(r.sim, 'StsLoadPicked')).toHaveLength(8)
    expect(r.sim.firstError).toBeNull()
    expect(r.sim.invariantReport().violations).toEqual([])
  })

  it('discharges no later than with the release-ahead off', () => {
    const off = sample(0)
    const lastOf = (s: Simulation) => Math.max(...ofType(s, 'StsGrounded').map((e) => e.t))
    expect(lastOf(r.sim)).toBeLessThanOrEqual(lastOf(off.sim) + 60)
    expect(off.padSeenAt).toBeNull()
  })

  it('leaves the event log unchanged at 0 (the default)', () => {
    const a = createSimulation(scenario(undefined))
    const b = createSimulation(scenario(0))
    a.runUntil({})
    b.runUntil({})
    expect(a.eventLog().map((e) => e.type)).toEqual(b.eventLog().map((e) => e.type))
  })

  it('keeps one pad per crane head box: boxes released ahead only use pads beyond the reserved ones (#213)', () => {
    const PADS = 4
    const config = new ScenarioBuilder('head-pad', 'head box pad reserve')
      .hatch({ enabled: false })
      .seed(11)
      .moveVariation(10)
      .quay(600, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .sts('STS02', { gantryX: 120, groundPositions: 3 })
      .sts('STS03', { gantryX: 180, groundPositions: 3 })
      .vesselCall('V001', { name: 'First', sizeClass: 'feeder', discharge: 12, load: 18, maxSts: 3, sizeMix: { '40': 1 } })
      .shcs(3)
      .block('B01', { x: 20, bays: 14, tiers: 4, wtpPads: PADS })
      .yardStart({ mode: 'prefilled', targetPct: 40 })
      .loadReleaseAhead(6)
      .endWhen({ simDurationS: DURATION })
      .build()
    const sim = createSimulation(config)
    let worst = -PADS
    for (let t = 20; t <= DURATION; t += 20) {
      sim.runUntil({ time: t })
      const orders = sim.query.loadOrders()
      const heads = new Map<string, (typeof orders)[number]>()
      for (const o of orders) {
        const h = heads.get(o.stsId)
        if (!h || o.seq < h.seq) heads.set(o.stsId, o)
      }
      const headIds = new Set([...heads.values()].map((o) => o.containerId))
      const unpadded = [...heads.values()].filter((o) => o.stage === 'released').length
      const ahead = orders.filter((o) => (o.stage === 'staging' || o.stage === 'padded') && !headIds.has(o.containerId)).length
      // one pad stays for discharge boxes, one per crane whose head box has no pad yet
      worst = Math.max(worst, ahead - (PADS - 1 - unpadded))
    }
    expect(worst).toBeLessThanOrEqual(0)
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('rejects a bad value', () => {
    for (const bad of [-1, 1.5, 99]) {
      const config = scenario(2)
      if (config.yard) config.yard.loadReleaseAhead = bad
      expect(validateScenario(config).errors.map((e) => e.key)).toContain('setup.check.loadReleaseAhead')
      expect(() => createSimulation(config)).toThrow(ScenarioValidationError)
    }
  })
})
