import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { SubsystemModes } from '../scenario/types'

/** The berth request fields these tests read. */
interface BerthAllocationRequest {
  quayLengthM: number
  loaM: number
  minBerthX?: number
  maxBerthX?: number
}

interface Opts {
  hatch?: boolean
  quayM?: number
  strategy?: string
  modes?: SubsystemModes
}

/**
 * #365: cranes never pass, so a crane can reach a gantry X only if every crane between it and the quay end fits
 * beside it (`railReach`). Three small cranes (out of reach of a ULCV, #303) at the low end of the rail keep the first
 * ULCV-capable crane at least 3 x 27 m along the quay; a ULCV berthed at 0 m has bays below that X, which no crane can
 * ever work.
 */
function lowEndSmallCranes({ hatch = false, quayM = 700, strategy, modes }: Opts = {}) {
  const b = new ScenarioBuilder('berth-reach', 'Three out-of-reach STS at the low end of the rail, ULCV arrives')
    .hatch({ enabled: hatch })
    .quay(quayM, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 20, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS02', { gantryX: 60, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS03', { gantryX: 100, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS04', { gantryX: 300, groundPositions: 30 })
    .vesselCall('V001', { sizeClass: 'ulcv', discharge: 24, maxSts: 1, sizeMix: { '40': 1 } })
  if (strategy) b.decisions({ points: { berthAllocation: { strategy } } })
  if (modes) b.subsystems(modes)
  return b.build()
}

/** The mirror image: one ULCV-capable crane at the low end, three small cranes at the high end (maxBerthX binds). */
function highEndSmallCranes() {
  return new ScenarioBuilder('berth-reach-high', 'Three out-of-reach STS at the high end of the rail, ULCV arrives')
    .hatch({ enabled: false })
    .quay(700, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 300, groundPositions: 30 })
    .sts('STS02', { gantryX: 600, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS03', { gantryX: 640, groundPositions: 30, craneClass: 'super-post-panamax' })
    .sts('STS04', { gantryX: 680, groundPositions: 30, craneClass: 'super-post-panamax' })
    .vesselCall('V001', { sizeClass: 'ulcv', discharge: 24, maxSts: 1, sizeMix: { '40': 1 } })
    .build()
}

function expectAllWorked(sim: ReturnType<typeof createSimulation>) {
  const stop = sim.runUntil({ time: 200_000 })
  expect(sim.invariantReport().violations).toEqual([])
  expect(sim.kpiReport().movesCompleted).toBe(24)
  expect(stop.reason).toBe('ended')
}

describe('berth allocation within crane reach (#365)', () => {
  it('berths a vessel where its eligible cranes can reach every bay, so the run ends with every move done', () => {
    expectAllWorked(createSimulation(lowEndSmallCranes()))
  })

  it('best-fit keeps to the reach window too', () => {
    const sim = createSimulation(lowEndSmallCranes({ strategy: 'best-fit' }))
    expectAllWorked(sim)
    expect(sim.kpiReport().vessels.V001.berthX).toBeGreaterThan(0)
  })

  it('berth mode off places the vessel inside the reach window, not at 0 m', () => {
    const sim = createSimulation(lowEndSmallCranes({ modes: { berth: 'off' } }))
    expectAllWorked(sim)
    expect(sim.kpiReport().vessels.V001.berthX).toBeGreaterThan(0)
  })

  it('maxBerthX: with the small cranes at the high end the vessel may not berth so high the able crane cannot reach its last bay', () => {
    let req: BerthAllocationRequest | undefined
    const highest = (p: BerthAllocationRequest) => Math.min(p.quayLengthM - p.loaM, p.maxBerthX ?? Infinity)
    const sim = createSimulation(highEndSmallCranes(), {
      berthAllocation: (msg) => {
        req = msg.payload
        return { berthX: highest(msg.payload) }
      },
    })
    expectAllWorked(sim)
    expect(req?.maxBerthX).toBeLessThan(700 - 400)
    expect(req?.minBerthX).toBeUndefined()
    expect(sim.kpiReport().vessels.V001.berthX).toBe(req?.maxBerthX)

    // ignoring the window (berthed at the quay end) leaves STS01 waiting for an X it can never reach
    const bad = createSimulation(highEndSmallCranes(), { berthAllocation: (msg) => ({ berthX: msg.payload.quayLengthM - msg.payload.loaM }) })
    expect(bad.runUntil({ time: 200_000 }).reason).toBe('failed')
    expect(bad.invariantReport().violations[0].invariant).toBe('sts.rail-reachable')
  })

  it('a vessel no stern position lets its cranes work fails loudly instead of waiting at anchorage for ever', () => {
    // 420 m quay: the stern must stay at or below 20 m, but STS04 reaches the ULCV's first bay only from 33 m up
    for (const modes of [undefined, { berth: 'off' as const }]) {
      const sim = createSimulation(lowEndSmallCranes({ quayM: 420, modes }))
      expect(sim.runUntil({ time: 200_000 }).reason).toBe('failed')
      expect(sim.firstError?.message).toMatch(/no stern position on the 420 m quay lets the cranes able to work V001/)
    }
  })

  it('a vessel longer than the quay still waits at anchorage: the reach check is only for vessels the quay can hold', () => {
    // 320 m quay, 400 m ULCV: it can never berth, so no window applies (the vessel-hulls smoke spec relies on this)
    const sim = createSimulation(lowEndSmallCranes({ quayM: 320 }))
    expect(sim.runUntil({ time: 3_600 }).reason).not.toBe('failed')
    expect(sim.firstError).toBeNull()
    expect(sim.kpiReport().vessels.V001.berthX ?? null).toBeNull()
  })

  it('the sts.rail-reachable invariant fails a crane sent to a bay it can never reach, instead of the run going idle', () => {
    // a TOS that ignores the reach window: the ULCV at 0 m, its first bays below the 81 m STS04 can ever reach
    const sim = createSimulation(lowEndSmallCranes(), { berthAllocation: () => ({ berthX: 0 }) })
    expect(sim.runUntil({ time: 200_000 }).reason).toBe('failed')
    const [first] = sim.invariantReport().violations
    expect(first.invariant).toBe('sts.rail-reachable')
    expect(first.message).toMatch(/STS04 waits for the rail to reach .* outside the 81\.00/)
  })

  it('puts a hatch panel in a laydown bay the crane can reach, not the nearest one below its rail reach', () => {
    // berthed at 33 m, bay 0's nearest laydown bay (75 m) lies below the 81 m STS04 can reach
    expectAllWorked(createSimulation(lowEndSmallCranes({ hatch: true })))
  })
})
