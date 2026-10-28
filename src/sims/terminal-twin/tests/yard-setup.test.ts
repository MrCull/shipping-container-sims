/**
 * TT-06: the setup dialog's yard fields (block count, bays, tiers, WTP pads,
 * transfer stalls, ASC kinematics) as `withYard`, through the engine API.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { DEFAULT_ASC_KINEMATICS, withYard } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'

const fixture = fixtures['asc-1sts-10-boxes-1block']
const block = { bays: 6, tiers: 3, wtpPads: 3, transferStalls: 4 }

describe('withYard (setup dialog)', () => {
  it('sets block count, bays, tiers, WTP pads and transfer stalls and leaves the input alone', () => {
    const before = JSON.stringify(fixture)
    const cfg = withYard(fixture, { blocks: [block, { ...block, bays: 9 }], asc: DEFAULT_ASC_KINEMATICS })
    expect(JSON.stringify(fixture)).toBe(before)
    expect(cfg.yard!.blocks.map((b) => [b.id, b.bays, b.tiers, b.wtpPads, b.transferStalls])).toEqual([
      ['B01', 6, 3, 3, 4],
      ['B02', 9, 3, 3, 4],
    ])
    expect(cfg.yard!.blocks[0].x).toBe(fixture.yard!.blocks[0].x)
    expect(cfg.yard!.blocks[1].x).toBeGreaterThan(cfg.yard!.blocks[0].x + 28)
  })

  it('runs with the edited yard: one ASC per block, no violations', () => {
    const cfg = withYard(fixture, { blocks: [block, block], asc: DEFAULT_ASC_KINEMATICS })
    const sim = createSimulation(cfg)
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.query.ascs().map((a) => a.id)).toEqual(['B01-ASC1', 'B02-ASC1'])
    expect(sim.query.yardBlocks().map((b) => b.bays)).toEqual([6, 6])
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.query.yardSlots().length).toBeGreaterThan(0)
  })

  it('ASC kinematics change the cycle time: a faster gantry shortens the first stacking', () => {
    const stackedAt = (gantryV: number) => {
      const cfg = withYard(fixture, {
        blocks: [block],
        asc: { ...DEFAULT_ASC_KINEMATICS, gantry: { ...DEFAULT_ASC_KINEMATICS.gantry, vMax: gantryV } },
      })
      const sim = createSimulation(cfg)
      sim.runUntil({ eventType: 'AscStacked' })
      return sim.now
    }
    expect(stackedAt(8)).toBeLessThan(stackedAt(0.5))
  })
})
