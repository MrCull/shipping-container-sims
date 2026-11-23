/**
 * #360: render-only leasing and old-stock variants. A pure function of the box id and its line picks the livery tile
 * drawn in the default colour mode; the engine line is untouched.
 */
import { describe, expect, it } from 'vitest'
import atlas from '../assets/models/containers/livery-atlas.json'
import { boxHash, boxUnit } from '../modules/boxHash'
import { LEASING_SHARE, isLeasingTile, liveryIndexForBox } from '../modules/boxLivery'

const ids = Array.from({ length: 20000 }, (_, i) => `MSCU${String(i).padStart(6, '0')}${i % 10}`)
const tileOf = (line: string | null) => atlas.liveries.find((l) => l.line === line)!.index

describe('box hash (#360, reused by #361)', () => {
  it('is stable and salted', () => {
    expect(boxHash('MSCU1234565')).toBe(boxHash('MSCU1234565'))
    expect(boxHash('MSCU1234565', 'livery')).not.toBe(boxHash('MSCU1234565', 'tone'))
    expect(boxHash('a')).toBe(0xe40c292c) // FNV-1a 32 of "a" (published test vector)
    for (const id of ids.slice(0, 200)) {
      expect(boxUnit(id)).toBeGreaterThanOrEqual(0)
      expect(boxUnit(id)).toBeLessThan(1)
    }
  })
})

describe('livery tile for a box (#360)', () => {
  it('gives the same tile for the same id on every call', () => {
    for (const id of ids.slice(0, 500)) expect(liveryIndexForBox(id, 'MSC')).toBe(liveryIndexForBox(id, 'MSC'))
  })

  it('makes about half the yard a leasing variant', () => {
    expect(LEASING_SHARE).toBeGreaterThan(0.4)
    expect(LEASING_SHARE).toBeLessThan(0.6)
    const share = ids.filter((id) => isLeasingTile(liveryIndexForBox(id, 'Maersk'))).length / ids.length
    expect(Math.abs(share - LEASING_SHARE)).toBeLessThan(0.02)
  })

  it('weights the leasing pick towards rust, oxblood and brown, and uses every variant', () => {
    const counts = new Map<number, number>()
    for (const id of ids) {
      const t = liveryIndexForBox(id, 'Maersk')
      if (isLeasingTile(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    expect(counts.size).toBe(atlas.leasing.length)
    const byName = (n: string) => counts.get(atlas.leasing.find((l) => l.name === n)!.index) ?? 0
    expect(byName('rust')).toBeGreaterThan(byName('dull blue'))
    expect(byName('oxblood') + byName('brown') + byName('rust')).toBeGreaterThan(ids.length * LEASING_SHARE * 0.5)
  })

  it('a non-leasing box keeps its own line tile', () => {
    const own = ids.map((id) => liveryIndexForBox(id, 'Evergreen')).filter((t) => !isLeasingTile(t))
    expect(own.length).toBeGreaterThan(0)
    expect(new Set(own)).toEqual(new Set([tileOf('Evergreen')]))
  })

  it('an unknown or missing line falls back to the generic tile', () => {
    for (const id of ids.slice(0, 200)) {
      expect(liveryIndexForBox(id, undefined)).toBe(atlas.genericIndex)
      expect(liveryIndexForBox(id, 'No Such Line')).toBe(atlas.genericIndex)
    }
  })
})
