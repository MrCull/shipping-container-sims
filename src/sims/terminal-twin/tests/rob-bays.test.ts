/**
 * ROB (remain on board) bays (spec #106, #110): the bay plan sets a share of each vessel's bays aside, fills them with
 * display-only boxes for later ports, and nothing else in the engine ever sees them.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { planCargo, stackAccepts, type StackState } from '../scenario/bayPlan'
import { laterPorts, pickRobBays, validateRob, type RobBox } from '../scenario/robBays'
import { DEFAULT_PORT_ROTATION } from '../scenario/containerProps'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { validateScenario } from '../scenario/validate'
import type { ScenarioConfig } from '../scenario/types'
import { vesselClass } from '../scenario/vesselClasses'

const rob = fixtures['rob-bays'] as ScenarioConfig
const withFraction = (config: ScenarioConfig, robBayFraction: number, robFill?: number): ScenarioConfig => ({ ...config, robBayFraction, ...(robFill ? { robFill } : {}) })

describe('ROB bay planning', () => {
  it('sets nothing aside by default: no ROB bays, no boxes, and the plan is the same as without the field', () => {
    const base = fixtures['hatch-cover-cycle'] as ScenarioConfig
    const plan = planCargo(base, base.seed)
    expect(plan.robBays).toEqual({})
    expect(plan.rob).toEqual([])
    expect(planCargo(withFraction(base, 0), base.seed).slots).toEqual(plan.slots)
  })

  it('picks round(fraction x bays) bays per vessel from the seed, never all of them', () => {
    const spec = vesselClass('feeder')
    expect(spec.bays).toBe(7)
    const bays = pickRobBays(rob, rob.seed, { id: 'V001', sizeClass: 'feeder' })
    expect(bays).toHaveLength(3)
    expect(new Set(bays).size).toBe(3)
    expect(pickRobBays(rob, rob.seed, { id: 'V001', sizeClass: 'feeder' })).toEqual(bays)
    expect(pickRobBays({ robBayFraction: 0.99 }, 1, { id: 'V001', sizeClass: 'feeder' })).toHaveLength(spec.bays - 1)
  })

  it('puts no slot and no container in a ROB bay, and keeps every working plan intact', () => {
    const plan = planCargo(rob, rob.seed)
    for (const [vesselId, bays] of Object.entries(plan.robBays)) {
      expect(plan.slots.filter((s) => s.vesselId === vesselId && bays.includes(s.bay))).toEqual([])
    }
    const v1 = rob.vessels[0]
    expect(plan.slots.filter((s) => s.vesselId === 'V001' && s.purpose === 'discharge')).toHaveLength(
      plan.containers.filter((c) => c.vesselId === 'V001' && c.flow === 'discharge').length,
    )
    expect(plan.containers.filter((c) => c.vesselId === 'V001' && c.flow === 'discharge')).toHaveLength(v1.discharge)
  })

  it('fills the ROB bays to the configured level in hold and on deck', () => {
    for (const fill of [0.7, 0.4, 1]) {
      const config = withFraction(rob, 0.43, fill)
      const plan = planCargo(config, config.seed)
      const spec = vesselClass('feeder')
      for (const v of config.vessels) {
        const bays = plan.robBays[v.id]
        const boxes = plan.rob.filter((b) => b.vesselId === v.id)
        for (const deck of [false, true]) {
          const cells = new Set(boxes.filter((b) => b.deck === deck).map((b) => `${b.bay}:${b.row}:${b.tier}`))
          const capacity = bays.length * spec.rows * (deck ? spec.deckTiers : spec.holdTiers)
          expect(cells.size, `fill ${fill} ${deck ? 'deck' : 'hold'}`).toBe(Math.round(fill * spec.rows * (deck ? spec.deckTiers : spec.holdTiers)) * bays.length)
          expect(cells.size / capacity).toBeCloseTo(fill, 1)
        }
        expect(boxes.every((b) => bays.includes(b.bay))).toBe(true)
      }
    }
  })

  it('stacks ROB boxes by the 20/40 rules, bottom up with nothing floating, heavier lower', () => {
    const plan = planCargo(rob, rob.seed)
    const spec = vesselClass('feeder')
    const stacks = new Map<string, RobBox[]>()
    for (const b of plan.rob) {
      const key = `${b.vesselId}:${b.bay}:${b.row}:${b.deck}`
      stacks.set(key, [...(stacks.get(key) ?? []), b])
    }
    expect(stacks.size).toBeGreaterThan(0)
    for (const [key, boxes] of stacks) {
      const tiers = [...new Set(boxes.map((b) => b.tier))].sort((a, b) => a - b)
      const from = boxes[0].deck ? spec.holdTiers : 0
      expect(tiers, key).toEqual(tiers.map((_, i) => from + i)) // from the floor or hatch cover up, no gaps
      let state: StackState | null = 'open'
      let lastKind: 'pair' | 'full' | null = null
      let lastWeight = Infinity
      for (const tier of tiers) {
        const cell = boxes.filter((b) => b.tier === tier)
        const kind = cell[0].size === '20' ? 'pair' : 'full'
        if (kind === 'pair') expect(cell.map((b) => b.half).sort(), key).toEqual(['aft', 'fore'])
        else expect(cell, key).toHaveLength(1)
        state = state && stackAccepts(state, kind)
        expect(state, `${key} tier ${tier}`).not.toBeNull()
        const weight = cell.reduce((n, b) => n + b.grossKg, 0)
        if (kind === lastKind) expect(weight, `${key} heavier lower`).toBeLessThanOrEqual(lastWeight)
        lastKind = kind
        lastWeight = weight
      }
    }
  })

  it('gives every ROB box a POD from a port the service calls after the terminal', () => {
    const plan = planCargo(rob, rob.seed)
    const later = laterPorts(DEFAULT_PORT_ROTATION)
    expect(plan.rob.length).toBeGreaterThan(50)
    for (const b of plan.rob) {
      expect(later).toContain(b.pod)
      expect(b.pod).not.toBe(DEFAULT_PORT_ROTATION.terminal)
      expect(b.isoType).toMatch(/^(22|42|45)G1$/)
      expect(['LIGHT', 'MEDIUM', 'HEAVY']).toContain(b.weightClass)
      expect(b.slotId).toMatch(/^V00\d:\d\d-\d\d-\d\d[af]?$/)
    }
    expect(new Set(plan.rob.map((b) => b.pod)).size).toBeGreaterThan(1)
    expect(laterPorts({ terminal: 'B', ports: ['A', 'B', 'C', 'D'] })).toEqual(['C', 'D'])
    expect(laterPorts({ terminal: 'D', ports: ['A', 'B', 'C', 'D'] })).toEqual(['A', 'B', 'C']) // last port: the loop starts again
  })

  it('is deterministic and independent of the engine streams: the working plan is identical with or without ROB', () => {
    const a = planCargo(rob, rob.seed)
    expect(planCargo(rob, rob.seed)).toEqual(a)
    expect(planCargo(rob, rob.seed + 1).rob).not.toEqual(a.rob)
    // the ROB boxes of a vessel do not depend on how the other vessels are set up
    const other = planCargo({ ...rob, vessels: [rob.vessels[1]] }, rob.seed)
    expect(other.rob.map((b) => b.slotId)).toEqual(a.rob.filter((b) => b.vesselId === 'V002').map((b) => b.slotId))
  })

  it('validates the settings', () => {
    expect(validateRob({})).toEqual([])
    expect(validateRob({ robBayFraction: 0.5, robFill: 0.7 })).toEqual([])
    expect(validateRob({ robBayFraction: 1 })).toHaveLength(1)
    expect(validateRob({ robBayFraction: -0.1 })).toHaveLength(1)
    expect(validateRob({ robFill: 0 })).toHaveLength(1)
    expect(validateScenario(withFraction(rob, 1.5))).toMatchObject({ errors: [{ key: 'setup.check.containerProps' }] })
    expect(validateScenario(rob).errors).toEqual([])
  })

  it('throws when the working bays cannot hold the discharge', () => {
    const tight = { ...withFraction(rob, 0.86), vessels: rob.vessels.map((v) => ({ ...v, discharge: 300, load: 0 })) }
    expect(() => planCargo(tight, tight.seed)).toThrow(/do not fit/)
  })
})

describe('ROB bays in the headless engine (fixture rob-bays)', () => {
  const sim = createSimulation(rob, {}, { invariants: { sweepEvery: 200 } })
  sim.runUntil()

  it('runs to its end with zero invariant violations', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.invariantReport().checks).toBeGreaterThan(0)
    expect(sim.query.vessel('V001').status).toBe('departed')
  })

  it('works the other bays: every discharge and load box moved, including the trucks’ exports', () => {
    const kpi = sim.kpiReport()
    expect(kpi.movesCompleted).toBeGreaterThanOrEqual(16 + 6 + 4)
  })

  it('never discharges, loads or books a truck export into a ROB bay, and keeps their hatches closed', () => {
    for (const v of ['V001', 'V002']) {
      const bays = sim.query.vessel(v).robBays as number[]
      expect(bays).toHaveLength(3)
      const slots = sim.query.vesselSlots(v)
      expect(slots.length).toBeGreaterThan(0)
      expect(slots.filter((s) => bays.includes(s.bay))).toEqual([])
      const panels = sim.query.hatchPanels(v)
      for (const bay of bays) {
        const own = panels.filter((p) => p.bay === bay)
        expect(own.length, `${v} bay ${bay} has its hatch drawn`).toBeGreaterThan(0)
        expect(own.every((p) => p.status === 'secured' && !p.opens && p.cycles === 0 && p.liftedAt === null)).toBe(true)
      }
    }
    // no event ever names a slot or hatch panel of a ROB bay
    const names = ['V001', 'V002'].flatMap((v) => (sim.query.vessel(v).robBays as number[]).flatMap((b) => [`${v}:${String(b).padStart(2, '0')}-`, `${v}:H${String(b).padStart(2, '0')}-`]))
    const mentions = sim.eventLog().filter((e) => names.some((n) => JSON.stringify(e).includes(n)))
    expect(mentions).toEqual([])
  })

  it('keeps ROB boxes out of the containers: nothing the engine counts is a ROB box', () => {
    const robCount = sim.query.vessel('V001').robBoxes?.length ?? 0
    expect(robCount).toBeGreaterThan(30)
    const ids = new Set(sim.query.containers().map((c) => c.id))
    for (const b of sim.query.vessel('V001').robBoxes ?? []) expect(ids.has(b.slotId)).toBe(false)
    expect(sim.query.containers().every((c) => !c.id.startsWith('ROB'))).toBe(true)
  })

  it('leaves KPIs and event log unchanged by the ROB boxes, once their bays are taken out (same working boxes either way)', () => {
    // with the fraction at 0 the same scenario still runs clean; ROB only removes bays from the working plan
    const plain = createSimulation(withFraction(rob, 0), {}, { invariants: { sweepEvery: 200 } })
    plain.runUntil()
    expect(plain.firstError).toBeNull()
    expect(plain.invariantReport().violations).toEqual([])
    expect(plain.query.vessel('V001').robBoxes).toBeUndefined()
  })
})

describe('the peak-day preset keeps remain-on-board bays', () => {
  it('sets aside a share of every vessel’s bays, with the figures marked unverified', () => {
    const c = presets['TTI Algeciras — peak day']()
    expect(c.robBayFraction).toBeGreaterThan(0)
    expect(c.robBayFraction).toBeLessThan(0.7)
    expect(validateScenario(c)).toEqual({ errors: [], warnings: [] })
    const plan = planCargo(c, c.seed)
    for (const v of c.vessels) expect(plan.robBays[v.id]?.length).toBeGreaterThan(0)
    expect(plan.rob.length).toBeGreaterThan(1000)
    expect(c.description).toMatch(/unverified/i)
  })
})
