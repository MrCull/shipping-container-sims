/**
 * TT-06: ASC block storage, import flow from vessel to yard stack, through
 * the public engine API (seam 1) and the yardAllocation decision point (seam 2).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'

const FIXTURE = 'asc-1sts-10-boxes-1block'
const fixture = fixtures[FIXTURE]

describe('import fixture: 1 STS discharges 10 boxes to 1 block', () => {
  it('runs end to end with no invariant violations', () => {
    const sim = createSimulation(fixture)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('custody history is vessel slot → STS → ground position → SHC → WTP pad → ASC → yard slot', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const boxes = sim.query.containers()
    expect(boxes).toHaveLength(10)
    for (const { id } of boxes) {
      const kinds = sim.query.container(id).custodyHistory.map((h) => h.owner.kind)
      expect(kinds, id).toEqual(['vesselSlot', 'sts', 'groundPosition', 'shc', 'wtpPad', 'asc', 'yardSlot'])
    }
  })
})
