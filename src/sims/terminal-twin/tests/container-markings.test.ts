/**
 * Container markings (#119): the pure description of what is printed on a box's faces. The check digit, the
 * ISO-type plate, the laden-only seal, the heavy-only SUPER HEAVY triangle and per-box deterministic wear.
 */
import { describe, expect, it } from 'vitest'
import { describeMarkings, plateFor, type MarkingsInput } from '../modules/containerMarkings'
import { isValidIso6346, iso6346CheckDigit, makeIso6346Id } from '../scenario/iso6346'
import { isoTypeOf, tareKgOf } from '../scenario/containerProps'

const box = (over: Partial<MarkingsInput> = {}): MarkingsInput => ({
  id: 'CSQU3054383',
  size: '40HC',
  line: 'HMM',
  isoType: '45G1',
  laden: true,
  heavy: false,
  ...over,
})

describe('door end identity', () => {
  it('splits the id into owner prefix, serial and a correct check digit', () => {
    const d = describeMarkings(box()).door
    expect(d.ownerPrefix).toBe('CSQU')
    expect(d.serial).toBe('305438')
    expect(d.checkDigit).toBe(3)
    expect(d.isoType).toBe('45G1')
    expect(isValidIso6346(`${d.ownerPrefix}${d.serial}${d.checkDigit}`)).toBe(true)
  })

  it('recomputes the check digit for generated ids', () => {
    for (const serial of [1, 77, 123456, 999999]) {
      const id = makeIso6346Id('HDMU', serial)
      const d = describeMarkings(box({ id })).door
      expect(d.checkDigit).toBe(iso6346CheckDigit(id.slice(0, 10)))
      expect(`${d.ownerPrefix}${d.serial}${d.checkDigit}`).toBe(id)
    }
  })
})

describe('weight plate', () => {
  it('matches the reference photo for a 45G1', () => {
    const p = plateFor('45G1')
    expect(p.maxGrossKg).toBe(32500)
    expect(p.maxGrossLbs).toBe(71650)
    expect(p.cuCapM3).toBe(76.4)
    expect(p.cuCapCuFt).toBe(2700)
  })

  it.each(['22G1', '42G1', '45G1', '22R1', '42R1', '45R1'])('%s is consistent: net = max gross - tare, lbs follow kg', (iso) => {
    const p = plateFor(iso)
    expect(p.netKg).toBe(p.maxGrossKg - p.tareKg)
    for (const [kg, lbs] of [
      [p.maxGrossKg, p.maxGrossLbs],
      [p.tareKg, p.tareLbs],
      [p.netKg, p.netLbs],
    ]) {
      expect(Math.abs(lbs - kg * 2.20462)).toBeLessThanOrEqual(5)
      expect(lbs % 10).toBe(0)
    }
    expect(Math.abs(p.cuCapCuFt - p.cuCapM3 * 35.3147)).toBeLessThanOrEqual(5)
  })

  it('takes tare from the same table as the box properties', () => {
    for (const [iso, size, reefer] of [
      ['22G1', '20', false],
      ['42R1', '40', true],
      ['45G1', '40HC', false],
    ] as const) {
      expect(isoTypeOf(size, reefer)).toBe(iso)
      expect(plateFor(iso).tareKg).toBe(tareKgOf(size, reefer))
    }
  })

  it('differs by ISO type (a 20 ft holds less than a 40 ft HC)', () => {
    expect(plateFor('22G1').cuCapM3).toBeLessThan(plateFor('45G1').cuCapM3)
    expect(plateFor('22G1').tareKg).toBeLessThan(plateFor('45G1').tareKg)
  })

  it('falls back to the size when the ISO type is unknown or absent', () => {
    expect(describeMarkings(box({ isoType: undefined, size: '20' })).door.isoType).toBe('22G1')
    expect(plateFor('ZZZZ').maxGrossKg).toBeGreaterThan(0)
  })
})

describe('door furniture', () => {
  it('shows the bolt seal only when laden', () => {
    expect(describeMarkings(box({ laden: true })).door.boltSeal).toBe(true)
    expect(describeMarkings(box({ laden: false })).door.boltSeal).toBe(false)
  })

  it('shows SUPER HEAVY only when heavy-rated', () => {
    expect(describeMarkings(box({ heavy: true })).door.superHeavy).toBe(true)
    expect(describeMarkings(box({ heavy: false })).door.superHeavy).toBe(false)
    expect(describeMarkings(box({ heavy: undefined })).door.superHeavy).toBe(false)
  })

  it('always carries a CSC plate', () => {
    expect(describeMarkings(box()).door.cscPlate).toBe(true)
  })
})

describe('sides and roof', () => {
  it('prints the box number and the line name in the line colour, no logo', () => {
    const m = describeMarkings(box({ line: 'MSC' }))
    expect(m.side.boxNumber).toBe('CSQU 305438 3')
    expect(m.roof.boxNumber).toBe('CSQU 305438 3')
    expect(m.side.lineName).toBe('MSC')
    expect(m.side.lineColour).toBe('#1d1d1b')
    expect(m.side).not.toHaveProperty('logo')
  })

  it('uses the generic grey livery for an unknown line', () => {
    expect(describeMarkings(box({ line: 'Nobody' })).side.lineColour).toBe('#ffffff')
  })
})

describe('wear', () => {
  it('is deterministic per box', () => {
    expect(describeMarkings(box()).wear).toEqual(describeMarkings(box()).wear)
  })

  it('differs between boxes and stays inside its ranges', () => {
    const seen = new Set<string>()
    for (let serial = 1; serial <= 40; serial++) {
      const w = describeMarkings(box({ id: makeIso6346Id('MSCU', serial) })).wear
      seen.add(JSON.stringify(w))
      expect(w.fade).toBeGreaterThanOrEqual(0)
      expect(w.fade).toBeLessThanOrEqual(1)
      for (const s of w.rustStreaks) {
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.x).toBeLessThanOrEqual(1)
      }
      for (const d of w.dents) expect(d.r).toBeGreaterThan(0)
    }
    expect(seen.size).toBeGreaterThan(30)
  })

  it('does not depend on the laden state or the line', () => {
    expect(describeMarkings(box({ laden: false, line: 'ZIM' })).wear).toEqual(describeMarkings(box()).wear)
  })
})
