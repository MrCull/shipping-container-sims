/**
 * TT-R06: a yard stack (one row x one 20 ft bay position) takes the length of its bottom box and accepts only that
 * length until it is empty. The lock is derived from the stack contents (nothing is stored); `candidateSlots` never
 * offers a 20 on a 40-locked stack or a 40 on mismatched stacks, and `yard.no-mixed-length-stack` catches a TOS that
 * ignores the candidate list.
 */
import { describe, expect, it } from 'vitest'
import { candidateSlots, createSimulation, yardSlotId, type YardAllocationRequest, type YardStacks } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'

const BAYS = 6
const ROWS = 8

/** A 6-bay block with a few stacks set up by `[bay, row, height, span]`. */
function stacks(size: '20' | '40', puts: [number, number, number, 1 | 2][]): YardStacks {
  const heights = new Array<number>(BAYS * ROWS).fill(0)
  const stackSpans = new Array<number>(BAYS * ROWS).fill(0)
  for (const [bay, row, h, span] of puts)
    for (let k = 0; k < span; k++) {
      heights[(bay + k - 1) * ROWS + row - 1] = h
      stackSpans[(bay + k - 1) * ROWS + row - 1] = span
    }
  return {
    blockId: 'B01',
    bays: BAYS,
    rows: ROWS,
    tiers: 3,
    size,
    blockX: 0,
    firstBayZ: 100,
    wtpX: 0,
    wtpZ: 64,
    heights,
    topVessels: heights.map((h) => (h > 0 ? 'V001' : null)),
    stackSpans,
  }
}

describe('candidateSlots keeps stacks to one length', () => {
  it('offers a 20 ft box no slot on a 40-locked stack, but a slot on a 20 ft stack and on an empty one', () => {
    const c = candidateSlots(stacks('20', [[1, 1, 1, 2], [4, 1, 1, 1]]))
    expect(c.find((x) => x.bay === 1 && x.row === 1)).toBeUndefined()
    expect(c.find((x) => x.bay === 2 && x.row === 1)).toBeUndefined()
    expect(c.find((x) => x.bay === 4 && x.row === 1)?.tier).toBe(2)
    expect(c.find((x) => x.bay === 3 && x.row === 1)?.tier).toBe(1)
  })

  it('offers a 40 ft box no slot over a 20 ft stack, over a 20 and an empty stack, or over unequal heights', () => {
    const c = candidateSlots(stacks('40', [[2, 1, 1, 1], [5, 2, 1, 1], [5, 3, 2, 1]]))
    expect(c.find((x) => x.bay === 1 && x.row === 1)).toBeUndefined() // bay 1 empty, bay 2 holds a 20
    expect(c.find((x) => x.bay === 2 && x.row === 1)).toBeUndefined() // bay 2 holds a 20, bay 3 empty
    expect(c.find((x) => x.bay === 4 && x.row === 2)).toBeUndefined() // bay 5 holds a 20
    expect(c.find((x) => x.bay === 4 && x.row === 3)).toBeUndefined()
    expect(c.find((x) => x.bay === 1 && x.row === 2)?.tier).toBe(1) // two empty stacks
  })

  it('offers a 40 ft box a slot on 40-locked stacks of equal height, not of unequal height', () => {
    const base: [number, number, number, 1 | 2][] = [[1, 1, 1, 2], [3, 2, 1, 2]]
    const equal = candidateSlots(stacks('40', base))
    expect(equal.find((x) => x.bay === 1 && x.row === 1)?.tier).toBe(2)
    const s = stacks('40', base)
    s.heights[0] = 2 // bay 1 row 1 higher than bay 2 row 1
    expect(candidateSlots(s).find((x) => x.bay === 1 && x.row === 1)).toBeUndefined()
  })

  it('a stack that has been emptied takes either length again', () => {
    const s = stacks('20', [])
    expect(candidateSlots(s).find((x) => x.bay === 1 && x.row === 1)?.tier).toBe(1)
    expect(candidateSlots({ ...s, size: '40' }).find((x) => x.bay === 1 && x.row === 1)?.tier).toBe(1)
  })
})

describe('yard.no-mixed-length-stack', () => {
  const mixed = (): ScenarioConfig => {
    const c = JSON.parse(JSON.stringify(fixtures['asc-1sts-10-boxes-1block'])) as ScenarioConfig
    c.vessels[0].sizeMix = { '20': 1, '40': 1 }
    return c
  }

  it('trips when a TOS ignores the candidates and stacks a 20 ft box on a 40 ft box', () => {
    let forties = 0
    let twenties = 0
    let mixedDone = false
    const sim = createSimulation(mixed(), {
      yardAllocation: (msg) => {
        const req = msg.payload as YardAllocationRequest
        // the first 40 goes to bays 1-2, row 1; the first 20 after it goes on top of it (a 20 on a 40-locked stack)
        if (req.size === '40') return { slotId: yardSlotId(req.blockId, forties === 0 ? 1 : 3, Math.max(1, forties++), 1) }
        if (forties > 0 && !mixedDone) {
          mixedDone = true
          return { slotId: yardSlotId(req.blockId, 1, 1, 2) }
        }
        return { slotId: yardSlotId(req.blockId, 6, 1 + twenties++, 1) }
      },
    })
    sim.runUntil()
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/yard\.no-mixed-length-stack/)
  })
})

describe('no mixed stacks', () => {
  it('with every built-in strategy on mixed 20/40 discharge into a pre-filled yard', () => {
    for (const strategy of ['nearest-wtp', 'random', 'group-by-vessel']) {
      const c = JSON.parse(JSON.stringify(fixtures['yard-no-mixed-length'])) as ScenarioConfig
      c.decisions = { points: { yardAllocation: { strategy } } }
      const sim = createSimulation(c)
      sim.runUntil()
      expect(sim.firstError).toBeNull()
      expect(sim.invariantReport().violations).toEqual([])
      expect(new Set(sim.query.yardSlots().map((s) => s.span))).toEqual(new Set([1, 2]))
    }
  })

  it('nearest-wtp keeps 40s in aligned bay pairs (1-2, 3-4, ...) while such pairs are free', () => {
    const c = JSON.parse(JSON.stringify(fixtures['yard-no-mixed-length'])) as ScenarioConfig
    const sim = createSimulation(c)
    sim.runUntil()
    const forties = sim.query.yardSlots().filter((s) => s.span === 2 && s.tier === 1)
    expect(forties.length).toBeGreaterThan(3)
    expect(forties.filter((s) => s.bay % 2 === 1).length / forties.length).toBeGreaterThan(0.8)
  })

  it('Small automated, pre-filled and run through vessel work, has no mixed stack', () => {
    const c = presets['Small automated']()
    c.endConditions = { moves: 40 }
    const sim = createSimulation(c, {}, { invariants: { sweepEvery: 200 } })
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
  }, 300_000)
})
