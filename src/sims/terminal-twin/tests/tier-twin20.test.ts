/**
 * #187: the tier stow sequence keeps twin-20 lift pairing. The aft and fore 20 ft halves of one cell stay adjacent
 * in the order even when their lines (yard groups) differ, and the pairs come first inside their tier.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, orderDischarge, type OrderBox, type OrderCell, type OrderEntry } from '../engine'
import { fixtures } from '../scenario/fixtures'

const PORTS = ['ESALG', 'MAPTM']
const cell = (row: number, tier: number, half: OrderCell['half'] = null): OrderCell => ({ bay: 1, row, tier, deck: false, half })
const box = (line: string, size = '40', pod = 'ESALG'): OrderBox => ({
  line,
  size,
  props: {
    direction: 'IMPORT',
    isoType: '22G1',
    pol: 'SGSIN',
    pod,
    tareKg: 2000,
    cargoKg: 10000,
    weightClass: 'MEDIUM',
    plannedDepartureS: 1000,
    inbound: { kind: 'vessel', id: 'V001' },
    outbound: { kind: 'truck' },
    bookingRef: 'B',
    holds: [],
  },
})
const names = (list: OrderEntry<OrderCell>[]) => list.map((e) => `${e.slot.row}/${e.slot.tier}${e.slot.half ?? ''}`)

describe('tier stow sequence keeps twin-20 pairs together', () => {
  it('discharge: halves of one cell with different lines stay adjacent, pairs first in the tier, tier order kept', () => {
    const entries: OrderEntry<OrderCell>[] = [
      { slot: cell(1, 2), box: box('AAA') },
      { slot: cell(2, 1), box: box('AAA') },
      { slot: cell(3, 1, 'aft'), box: box('MSC', '20') },
      { slot: cell(4, 1), box: box('BBB') },
      { slot: cell(3, 1, 'fore'), box: box('ZIM', '20') },
    ]
    expect(names(orderDischarge(entries, PORTS))).toEqual(['1/2', '3/1aft', '3/1fore', '2/1', '4/1'])
  })

  it('engine: the twin-20 fixture lifts its pairs together under the default tier sequence', () => {
    const sim = createSimulation(fixtures['twin-20-lift'])
    sim.runUntil({ maxEvents: 100_000 })
    const twins = sim.eventLog().filter((e) => e.type === 'StsPicked' && (e.payload as { twin?: unknown }).twin)
    expect(twins.length).toBe(2)
  })
})
