/**
 * Maritime location notation (TT-R08): table-driven checks of the pure formatter. Internal ids stay as they are.
 */
import { describe, expect, it } from 'vitest'
import { createLocationNotation, vesselBayNumber, vesselRowNumber, vesselTierNumber, yardBayNumber } from '../modules/locationNotation'
import { vesselSlotId } from '../scenario/vesselClasses'
import { yardSlotId } from '../engine'
import type { ScenarioConfig } from '../scenario/types'

// feeder: 7 bays, 8 rows (even beam), 4 hold tiers; ulcv: 24 bays, 23 rows (odd beam), 10 hold tiers.
const config = {
  vessels: [
    { id: 'V1', name: 'MSC Aurora', sizeClass: 'feeder' },
    { id: 'V2', name: 'Maersk Elba', sizeClass: 'ulcv' },
  ],
  yard: { blocks: [{ id: 'B01' }, { id: 'B02' }] },
} as unknown as Pick<ScenarioConfig, 'vessels' | 'yard'>
const loc = createLocationNotation(config)

describe('vessel bays count from the bow, odd for 20 ft halves and even for the 40 ft cell between them', () => {
  it.each([
    // [internal bay from aft, bays, half, maritime bay]
    [6, 7, null, 2], // bow-most cell
    [6, 7, 'fore', 1],
    [6, 7, 'aft', 3],
    [5, 7, null, 4],
    [5, 7, 'fore', 3], // the fore half of the second cell is the aft half of the first
    [0, 7, null, 14], // stern-most cell
    [0, 7, 'aft', 15],
  ] as const)('bay %i of %i (%s) is %i', (bay, bays, half, expected) => {
    expect(vesselBayNumber(bay, bays, half)).toBe(expected)
  })
})

describe('vessel rows: centreline 00 on an odd beam, starboard odd, port even', () => {
  it.each([
    // odd beam (23 rows, centre row 11; the quay side, row 0, is port)
    [11, 23, 0],
    [12, 23, 1],
    [13, 23, 3],
    [22, 23, 21],
    [10, 23, 2],
    [0, 23, 22],
    // even beam (8 rows): no centreline, 01 starboard and 02 port are the innermost
    [4, 8, 1],
    [3, 8, 2],
    [7, 8, 7],
    [0, 8, 8],
  ])('row %i of %i is %i', (row, rows, expected) => {
    expect(vesselRowNumber(row, rows)).toBe(expected)
  })
})

describe('vessel tiers: hold 02, 04, ...; deck 82, 84, ...', () => {
  it.each([
    [0, 4, 2],
    [3, 4, 8],
    [4, 4, 82],
    [6, 4, 86],
    [10, 10, 82],
  ])('tier %i with %i hold tiers is %i', (tier, hold, expected) => {
    expect(vesselTierNumber(tier, hold)).toBe(expected)
  })
})

describe('slot ids map to the notation', () => {
  it('the spec example: second cell from the bow, deck tier 82', () => {
    expect(loc.vesselSlot(vesselSlotId('V1', 5, 3, 4))?.notation).toBe('VESSEL.V01.04.02.82')
  })
  it('shows the vessel name beside the vessel location', () => {
    expect(loc.vesselSlot(vesselSlotId('V1', 5, 3, 4))?.text).toBe('MSC Aurora · VESSEL.V01.04.02.82')
    expect(loc.owner('vesselSlot', vesselSlotId('V1', 5, 3, 4))).toBe('MSC Aurora · VESSEL.V01.04.02.82')
  })
  it('both 20 ft halves and the whole cell of one cell', () => {
    expect(loc.vesselSlot(vesselSlotId('V1', 5, 3, 0, 'fore'))?.notation).toBe('VESSEL.V01.03.02.02')
    expect(loc.vesselSlot(vesselSlotId('V1', 5, 3, 0))?.notation).toBe('VESSEL.V01.04.02.02')
    expect(loc.vesselSlot(vesselSlotId('V1', 5, 3, 0, 'aft'))?.notation).toBe('VESSEL.V01.05.02.02')
  })
  it('an odd beam has a centreline row 00', () => {
    expect(loc.vesselSlot(vesselSlotId('V2', 22, 11, 10))?.notation).toBe('VESSEL.V02.04.00.82')
  })
  it('an id of another scenario is not formatted', () => {
    expect(loc.vesselSlot(vesselSlotId('V9', 1, 1, 1))).toBeNull()
    expect(loc.vesselSlot('nonsense')).toBeNull()
  })
})

describe('yard slots', () => {
  it.each([
    ['B01', 2, 2, 1, '20', 'YARD.B01.03.02.1'],
    ['B01', 2, 2, 1, '40', 'YARD.B01.04.02.1'],
    ['B01', 1, 8, 5, '20', 'YARD.B01.01.08.5'],
    ['B01', 1, 8, 5, '40HC', 'YARD.B01.02.08.5'],
    ['B02', 10, 1, 3, '40', 'YARD.B02.20.01.3'],
  ] as const)('%s bay %i row %i tier %i (%s ft) is %s', (block, bay, row, tier, size, expected) => {
    expect(loc.yardSlot(yardSlotId(block, bay, row, tier), size)?.notation).toBe(expected)
  })
  it('a 20 ft box is the default and the 40 ft bay lies between its two odd 20 ft bays', () => {
    expect(loc.yardSlot(yardSlotId('B01', 3, 4, 2))?.text).toBe('YARD.B01.05.04.2')
    expect(yardBayNumber(3, '40')).toBe(6)
  })
  it('other custody owners are shown as they are', () => {
    expect(loc.owner('sts', 'STS1')).toBe('sts:STS1')
    expect(loc.owner('yardSlot', yardSlotId('B01', 2, 2, 1), '40')).toBe('YARD.B01.04.02.1')
  })
})

describe('scanning an event payload', () => {
  it('lists the slot ids of both kinds and sizes yard slots by the payload box', () => {
    const json = JSON.stringify({ containerId: 'c1', slotId: vesselSlotId('V1', 5, 3, 4), yardSlotId: yardSlotId('B01', 2, 2, 1) }, null, 2)
    expect(loc.scan(json, () => '40')).toEqual([
      { id: 'V1:05-03-04', text: 'MSC Aurora · VESSEL.V01.04.02.82' },
      { id: 'B01:02-2-1', text: 'YARD.B01.04.02.1' },
    ])
  })
})
