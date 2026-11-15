/**
 * #269: the cheaper invariant paths (early exits and the occupied-cell pre-check) still report what the full scans
 * report. Each case plants a violation where the early exit applies to everything else, or compares against an
 * independent oracle.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, INVARIANTS, laneGraphOf, type SimSnapshot } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { isStackBase, vesselClass } from '../scenario/vesselClasses'
import { twinScenario } from './twin-scenario'

type InvariantScope = NonNullable<Parameters<(typeof INVARIANTS)[number]['check']>[2]>

const invariant = (id: string) => INVARIANTS.find((i) => i.id === id)!
const scopeOf = (equipment: string[], vessels: string[] = []): InvariantScope => ({
  containers: [],
  yardColumns: new Set(),
  custody: new Map(),
  equipment: new Set(equipment),
  vessels: new Set(vessels),
  newReservationsFrom: 0,
})
/** A deep copy, so every derived index (keyed on the state's objects) is built afresh. */
const copy = (snap: SimSnapshot): SimSnapshot => JSON.parse(JSON.stringify(snap)) as SimSnapshot

describe('asc.wtp-handover (hoist checked first)', () => {
  it('reports the one lowered ASC over an occupied pad among 40 ASCs at travel height, with the same message', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil({ eventType: 'ShcPositioningAtDropoff' })
    const { state, config } = copy(sim.snapshot())
    const shc = Object.values(state.shcs).find((s) => s.status === 'positioning-at-dropoff')!
    const pad = laneGraphOf(config).pads.find((p) => p.id === state.shcJobs[shc.jobId as string].wtpPadId)!
    const asc = state.ascs['B01-ASC1']
    // 40 more ASCs standing over the same pad, but at travel height: the hoist test passes them all
    for (let i = 0; i < 40; i++) state.ascs[`B01-ASCX${i}`] = { ...asc, id: `B01-ASCX${i}`, motion: [], gantryZ: pad.z, trolleyX: pad.x, hoistY: 99 }
    expect(invariant('asc.wtp-handover').check(state, config)).toEqual([])
    Object.assign(asc, { motion: [], gantryZ: pad.z, trolleyX: pad.x, hoistY: 0 })
    shc.motion = []
    shc.nodeId = `P:${pad.id}`
    expect(invariant('asc.wtp-handover').check(state, config)).toEqual([`B01-ASC1 is in the lifting envelope of ${pad.id} (hoist 0.00 m) while ${shc.id} is there`])
  })
})

describe('asc.no-passing (returns early when the event names no ASC)', () => {
  const tooClose = () => {
    const sim = createSimulation(twinScenario({ ascs: 2 }))
    sim.runUntil({ eventType: 'AscJobAssigned' })
    const { state, config } = copy(sim.snapshot())
    for (const id of ['B01-ASC1', 'B01-ASC2']) state.ascs[id].motion = []
    state.ascs['B01-ASC2'].gantryZ = state.ascs['B01-ASC1'].gantryZ + 3
    return { state, config }
  }

  it('a sweep and an event naming either ASC report the pair with the same message', () => {
    const { state, config } = tooClose()
    const check = invariant('asc.no-passing').check
    const whole = check(state, config)
    expect(whole).toHaveLength(1)
    expect(whole[0]).toMatch(/^B01-ASC1 and B01-ASC2 of B01 are 3\.00 m apart at t=/)
    expect(check(state, config, scopeOf(['SHC01', 'B01-ASC2', 'job-7']))).toEqual(whole)
    expect(check(state, config, scopeOf(['B01-ASC1']))).toEqual(whole)
  })

  it('an event naming no ASC checks no pair, as before', () => {
    const { state, config } = tooClose()
    expect(invariant('asc.no-passing').check(state, config, scopeOf(['SHC01', 'STS01', 'job-7']))).toEqual([])
    expect(invariant('asc.no-passing').check(state, config, scopeOf([]))).toEqual([])
  })
})

describe('stowage.order (occupied-cell pre-check)', () => {
  type Half = 'aft' | 'fore' | null
  /** The three rules, written from the invariant's description, over every filled slot. */
  const oracle = (state: SimSnapshot['state']): boolean => {
    const filled = Object.values(state.vesselSlots).filter((s) => s.containerId)
    const cells = new Map<string, Half[]>()
    const cell = (vesselId: string, bay: number, row: number, tier: number) => `${vesselId}/${bay}/${row}/${tier}`
    for (const s of filled) cells.set(cell(s.vesselId, s.bay, s.row, s.tier), [...(cells.get(cell(s.vesselId, s.bay, s.row, s.tier)) ?? []), s.half])
    const at = (vesselId: string, bay: number, row: number, tier: number): Half[] => cells.get(cell(vesselId, bay, row, tier)) ?? []
    return filled.some((s) => {
      if (isStackBase(vesselClass(state.vessels[s.vesselId].sizeClass), s.row, s.tier)) return false
      const below = at(s.vesselId, s.bay, s.row, s.tier - 1)
      if (s.half !== null && below.includes(null)) return true
      if (s.half === null && below.length === 1 && below[0] !== null) return true
      return (s.purpose === 'load' || s.purpose === 'transshipment') && !below.some((h) => h === null || s.half === null || h === s.half)
    })
  }

  it('agrees with an independent oracle on 24 tampered stows (boxes removed, halves changed), swept and scoped', () => {
    const sim = createSimulation(fixtures['stow-mixed-20-40'])
    sim.runUntil()
    const end = sim.snapshot()
    expect(oracle(end.state)).toBe(false)
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const outcomes = { broken: 0, clean: 0 }
    for (let round = 0; round < 24; round++) {
      const { state, config } = copy(end)
      const filled = Object.values(state.vesselSlots).filter((s) => s.containerId)
      expect(filled.length).toBeGreaterThan(20)
      // even rounds tamper with top boxes only (often still a legal stow), odd rounds with boxes that carry another
      const above = new Set(filled.map((s) => `${s.vesselId}/${s.bay}/${s.row}/${s.tier - 1}`))
      const tops = filled.filter((s) => !above.has(`${s.vesselId}/${s.bay}/${s.row}/${s.tier}`))
      const pool = round % 2 === 0 ? tops : filled.filter((s) => !tops.includes(s))
      expect(pool.length).toBeGreaterThan(0)
      for (let k = 0; k < 1 + Math.floor(random() * 3); k++) {
        const slot = pool[Math.floor(random() * pool.length)]
        if (random() < 0.6) slot.containerId = null
        else slot.half = ([null, 'aft', 'fore'] as Half[])[Math.floor(random() * 3)]
      }
      const expected = oracle(state)
      outcomes[expected ? 'broken' : 'clean']++
      const check = invariant('stowage.order').check
      expect(check(state, config).length > 0, `round ${round}, sweep`).toBe(expected)
      expect(check(state, config, scopeOf([], Object.keys(state.vessels))).length > 0, `round ${round}, scoped`).toBe(expected)
      expect(check(state, config, scopeOf([], []))).toEqual([])
    }
    expect(outcomes.broken).toBeGreaterThan(3)
    expect(outcomes.clean).toBeGreaterThan(3)
  }, 30_000)
})
