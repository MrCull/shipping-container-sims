/**
 * TT-06: the setup dialog's yard fields (block count, bays, tiers, WTP pads,
 * transfer stalls, ASC kinematics) as `withYard`, through the engine API.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { DEFAULT_ASC_KINEMATICS, withYard } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import { SceneModel } from '../modules/sceneModel'

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

  it('ASCs per block: 2 gives a waterside and a landside ASC per block, 1 keeps one, omitted keeps the scenario value', () => {
    const asc = DEFAULT_ASC_KINEMATICS
    const ids = (ascsPerBlock?: 1 | 2) =>
      createSimulation(withYard(fixture, { blocks: [block, block], asc, ascsPerBlock })).query.ascs().map((a) => a.id)
    expect(ids(2)).toEqual(['B01-ASC1', 'B01-ASC2', 'B02-ASC1', 'B02-ASC2'])
    expect(ids(1)).toEqual(['B01-ASC1', 'B02-ASC1'])
    expect(ids(undefined)).toEqual(['B01-ASC1', 'B02-ASC1'])
  })

  it('the scene model draws the same ASCs as the engine and maps their rail segments to blocks', () => {
    const cfg = withYard(fixture, { blocks: [block], asc: DEFAULT_ASC_KINEMATICS, ascsPerBlock: 2 })
    const model = new SceneModel(cfg)
    expect(model.ascIds).toEqual(['B01-ASC1', 'B01-ASC2'])
    expect(model.blockOfAsc('B01-ASC2').id).toBe('B01')
    expect(model.ascPose('B01-ASC1', 0).z).toBeLessThan(model.ascPose('B01-ASC2', 0).z - 12)
    // the parked cranes hold rail segments from the start
    const sim = createSimulation(cfg)
    model.apply({ motion: [], custody: [], entities: [], reservations: sim.query.reservations().map((r) => ({ ...r })), events: [], eventCounts: {} })
    const held = Object.entries(model.activeReservations(0)).filter(([zone]) => /^B01:R\d+$/.test(zone))
    expect(new Set(held.map(([, holder]) => holder))).toEqual(new Set(['B01-ASC1', 'B01-ASC2']))
    expect(model.railSegments('B01').length).toBeGreaterThan(held.length)
  })
})
