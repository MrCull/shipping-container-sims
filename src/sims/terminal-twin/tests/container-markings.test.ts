/**
 * Container markings (#119): the pure description of what is printed on a box's faces. The check digit, the
 * ISO-type plate, the laden-only seal, the heavy-only SUPER HEAVY triangle and per-box deterministic wear.
 */
import { describe, expect, it } from 'vitest'
import { describeMarkings, plateFor, type MarkingsInput, type WeightPlate } from '../modules/containerMarkings'
import { isValidIso6346, iso6346CheckDigit, makeIso6346Id } from '../scenario/iso6346'
import { isoTypeOf, tareKgOf } from '../scenario/containerProps'

/** The plate of a type that has one. */
const plateOf = (iso: string): WeightPlate => {
  const p = plateFor(iso)
  if (!p) throw new Error(`no plate for ${iso}`)
  return p
}

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

  it("uses the id's own check digit when it has one, computing only when absent", () => {
    // a deliberately wrong 11th character is printed as is; the engine's ids are valid, so they agree with the computation
    expect(describeMarkings(box({ id: 'CSQU3054380' })).door.checkDigit).toBe(0)
    expect(describeMarkings(box({ id: 'CSQU3054380' })).side.boxNumber).toBe('CSQU 305438 0')
    expect(describeMarkings(box({ id: 'CSQU305438' })).door.checkDigit).toBe(3)
  })

  it('reads the check digit of generated ids', () => {
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
    const p = plateOf('45G1')
    expect(p.maxGrossKg).toBe(32500)
    expect(p.maxGrossLbs).toBe(71650)
    expect(p.cuCapM3).toBe(76.4)
    expect(p.cuCapCuFt).toBe(2700)
  })

  it.each(['22G1', '42G1', '45G1', '22R1', '42R1', '45R1', '22U1', '42U1', '22P1', '42P1', '22T1'])('%s is consistent: net = max gross - tare, lbs follow kg', (iso) => {
    const p = plateOf(iso)
    expect(p.netKg).toBe(p.maxGrossKg - p.tareKg)
    for (const [kg, lbs] of [
      [p.maxGrossKg, p.maxGrossLbs],
      [p.tareKg, p.tareLbs],
      [p.netKg, p.netLbs],
    ]) {
      expect(Math.abs(lbs - kg * 2.20462)).toBeLessThanOrEqual(5)
      expect(lbs % 10).toBe(0)
    }
    if (p.cuCapM3 !== undefined) expect(Math.abs((p.cuCapCuFt ?? 0) - p.cuCapM3 * 35.3147)).toBeLessThanOrEqual(5)
  })

  it('takes tare from the same table as the box properties', () => {
    for (const [iso, size, reefer] of [
      ['22G1', '20', false],
      ['42R1', '40', true],
      ['45G1', '40HC', false],
    ] as const) {
      expect(isoTypeOf(size, reefer)).toBe(iso)
      expect(plateOf(iso).tareKg).toBe(tareKgOf(size, reefer))
    }
  })

  it('differs by ISO type (a 20 ft holds less than a 40 ft HC)', () => {
    expect(plateOf('22G1').cuCapM3).toBeLessThan(plateOf('45G1').cuCapM3 ?? 0)
    expect(plateOf('22G1').tareKg).toBeLessThan(plateOf('45G1').tareKg)
  })

  it('never shows the dry plate for another type group', () => {
    const dry = plateOf('22G1')
    for (const iso of ['22U1', '22P1', '22T1']) expect(plateOf(iso)).not.toEqual(dry)
    expect(plateOf('22P1').cuCapM3).toBeUndefined() // a flat rack has no volume line
  })

  it("uses the size's general-purpose type when the ISO type is absent", () => {
    expect(describeMarkings(box({ isoType: undefined, size: '20' })).door.isoType).toBe('22G1')
  })

  it('has no plate for a type without a row, and still prints its code', () => {
    expect(plateFor('ZZZZ')).toBeNull()
    expect(plateFor('45T1')).toBeNull()
    const d = describeMarkings(box({ isoType: '45U1' })).door
    expect(d.isoType).toBe('45U1')
    expect(d.plate).toBeNull()
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
