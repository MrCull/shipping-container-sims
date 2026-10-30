/**
 * TT-R19: reefers go only to powered rows, at most REEFER_MAX_TIERS high. `candidateSlots` never offers anything
 * else, the built-in strategies and the pre-fill respect it, and `yard.reefer-powered` catches a TOS that ignores it.
 */
import { describe, expect, it } from 'vitest'
import { candidateSlots, createSimulation, REEFER_MAX_TIERS, type YardAllocationRequest, type YardStacks } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { isReefer } from '../scenario/reefer'
import { validateScenario } from '../scenario/validate'
import type { ScenarioConfig } from '../scenario/types'

const BAYS = 4
const ROWS = 8

function stacks(reefer: boolean, heightAt: (bay: number, row: number) => number = () => 0): YardStacks {
  const heights: number[] = []
  for (let bay = 1; bay <= BAYS; bay++) for (let row = 1; row <= ROWS; row++) heights.push(heightAt(bay, row))
  return {
    blockId: 'B01',
    bays: BAYS,
    rows: ROWS,
    tiers: 6,
    size: '20',
    blockX: 0,
    firstBayZ: 100,
    wtpX: 0,
    wtpZ: 64,
    heights,
    topVessels: heights.map((h) => (h > 0 ? 'V001' : null)),
    stackSpans: heights.map((h) => (h > 0 ? 1 : 0)),
    poweredRows: [2, 3],
    ...(reefer ? { reefer: true } : {}),
  }
}

describe('candidateSlots for reefers', () => {
  it('offers a reefer only powered rows, and a plain box every row', () => {
    expect(new Set(candidateSlots(stacks(true)).map((c) => c.row))).toEqual(new Set([2, 3]))
    expect(new Set(candidateSlots(stacks(false)).map((c) => c.row)).size).toBe(ROWS)
  })

  it('stops a reefer at the 4-tier limit while a plain box may go higher', () => {
    const full = (_bay: number, row: number) => (row === 2 ? REEFER_MAX_TIERS : row === 3 ? REEFER_MAX_TIERS - 1 : 0)
    const reefer = candidateSlots(stacks(true, full))
    expect(reefer.filter((c) => c.row === 2)).toEqual([])
    expect(reefer.filter((c) => c.row === 3).every((c) => c.tier === REEFER_MAX_TIERS)).toBe(true)
    expect(candidateSlots(stacks(false, full)).find((c) => c.row === 2)?.tier).toBe(REEFER_MAX_TIERS + 1)
  })

  it('offers a reefer nothing in a block without powered rows', () => {
    const s = stacks(true)
    s.poweredRows = undefined
    expect(candidateSlots(s)).toEqual([])
  })
})

describe('reefer cargo mix', () => {
  it('flags about the configured share of full boxes, none of the empties, none at share 0', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `TEST${String(1000000 + i * 7)}`)
    const n = ids.filter((id) => isReefer({ reeferShare: 0.3 }, id, true)).length
    expect(n / ids.length).toBeGreaterThan(0.25)
    expect(n / ids.length).toBeLessThan(0.35)
    expect(ids.some((id) => isReefer({ reeferShare: 1 }, id, false))).toBe(false)
    expect(ids.some((id) => isReefer({}, id, true))).toBe(false)
  })

  it('is validated: powered rows 1-8, share 0-1, and a block with plugs when reefers exist', () => {
    const base = fixtures['reefer-powered-rows']
    expect(validateScenario(base).errors).toEqual([])
    const noPower = JSON.parse(JSON.stringify(base)) as ScenarioConfig
    if (noPower.yard) noPower.yard.blocks[0].poweredRows = []
    expect(validateScenario(noPower).errors.map((e) => e.key)).toContain('setup.check.reeferNoPower')
    const badRow = JSON.parse(JSON.stringify(base)) as ScenarioConfig
    if (badRow.yard) badRow.yard.blocks[0].poweredRows = [9]
    expect(validateScenario(badRow).errors.map((e) => e.key)).toContain('setup.check.poweredRows')
  })
})

describe('fixture reefer-powered-rows', () => {
  const run = (strategy?: string) => {
    const c = JSON.parse(JSON.stringify(fixtures['reefer-powered-rows'])) as ScenarioConfig
    if (strategy) c.decisions = { points: { yardAllocation: { strategy } } }
    const sim = createSimulation(c)
    sim.runUntil()
    return sim
  }

  it('keeps every reefer, pre-filled or discharged, in rows 1-2 on tiers 1-4, with every built-in strategy', () => {
    for (const strategy of ['nearest-wtp', 'random', 'grouped']) {
      const sim = run(strategy)
      expect(sim.firstError).toBeNull()
      expect(sim.invariantReport().violations).toEqual([])
      const boxes = new Map(sim.query.containers().map((b) => [b.id, b]))
      const reefers = sim.query.yardSlots().filter((s) => s.containerId && boxes.get(s.containerId)?.reefer)
      expect(reefers.length).toBeGreaterThan(3)
      for (const s of reefers) {
        expect([1, 2]).toContain(s.row)
        expect(s.tier).toBeLessThanOrEqual(REEFER_MAX_TIERS)
      }
    }
  })

  it('nearest-wtp leaves the plugs to reefers while other rows have room', () => {
    const sim = run()
    const boxes = new Map(sim.query.containers().map((b) => [b.id, b]))
    const plain = sim.query.yardSlots().filter((s) => s.containerId && !boxes.get(s.containerId)?.reefer)
    expect(plain.length).toBeGreaterThan(5)
    expect(plain.filter((s) => s.row <= 2).length / plain.length).toBeLessThan(0.25)
  })

  it('trips yard.reefer-powered when a TOS puts a reefer in an unpowered row', () => {
    const c = JSON.parse(JSON.stringify(fixtures['reefer-powered-rows'])) as ScenarioConfig
    const sim = createSimulation(c, {
      yardAllocation: (msg) => {
        const req = msg.payload as YardAllocationRequest
        // ignore the reefer rule: a slot a plain box could take, in the last row when possible
        const list = candidateSlots({ ...req, reefer: false })
        const pick = list.filter((s) => s.row === 8)[0] ?? list[0]
        return { slotId: pick?.slotId ?? null }
      },
    })
    sim.runUntil()
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/yard\.reefer-powered/)
  })
})
