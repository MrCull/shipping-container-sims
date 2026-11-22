/**
 * #361: per-box tone jitter. Each box in the default colour mode gets a small, stable brightness and saturation shift
 * (slightly faded or dirty), a pure function of its id, so a stack is not a row of identical clones.
 */
import { describe, expect, it } from 'vitest'
import { TONE_BRIGHTNESS_RANGE, TONE_LEVELS, TONE_SATURATION_RANGE, boxTone, toneFraction } from '../modules/boxLivery'

const ids = Array.from({ length: 5000 }, (_, i) => `TGHU${String(i).padStart(6, '0')}${i % 10}`)

describe('box tone (#361)', () => {
  it('keeps the shift small: about 12 % brightness and 15 % saturation', () => {
    expect(TONE_BRIGHTNESS_RANGE).toBe(0.12)
    expect(TONE_SATURATION_RANGE).toBe(0.15)
  })

  it('gives the same shift for an id on every call', () => {
    for (const id of ids.slice(0, 300)) expect(boxTone(id)).toEqual(boxTone(id))
    expect(boxTone('MSCU1234565')).toEqual(boxTone('MSCU1234565'))
  })

  it('stays within the configured range', () => {
    for (const id of ids) {
      const t = boxTone(id)
      expect(Math.abs(t.brightness)).toBeLessThanOrEqual(TONE_BRIGHTNESS_RANGE)
      expect(Math.abs(t.saturation)).toBeLessThanOrEqual(TONE_SATURATION_RANGE)
    }
  })

  it('varies across ids, over most of the range in both directions, with brightness and saturation independent', () => {
    const b = ids.map((id) => boxTone(id).brightness)
    const s = ids.map((id) => boxTone(id).saturation)
    expect(new Set(b).size).toBe(TONE_LEVELS)
    expect(new Set(s).size).toBe(TONE_LEVELS)
    expect(Math.min(...b)).toBeLessThan(-TONE_BRIGHTNESS_RANGE * 0.9)
    expect(Math.max(...b)).toBeGreaterThan(TONE_BRIGHTNESS_RANGE * 0.9)
    expect(Math.min(...s)).toBeLessThan(-TONE_SATURATION_RANGE * 0.9)
    expect(Math.max(...s)).toBeGreaterThan(TONE_SATURATION_RANGE * 0.9)
    const shifted = ids.map((_, i) => i).filter((i) => b[i] !== 0 && s[i] !== 0)
    const sameSign = shifted.filter((i) => Math.sign(b[i]) === Math.sign(s[i])).length / shifted.length
    expect(Math.abs(sameSign - 0.5)).toBeLessThan(0.05)
  })

  it('packs into the fraction of the livery index: no tone is 0, every tone a distinct fraction that keeps the tile', () => {
    expect(toneFraction(null)).toBe(0)
    expect(toneFraction({ brightness: 0, saturation: 0 })).toBe((8 * 16 + 8) / 256)
    expect(toneFraction({ brightness: TONE_BRIGHTNESS_RANGE, saturation: -TONE_SATURATION_RANGE })).toBe((15 * 16 + 1) / 256)
    const fractions = new Set<number>()
    for (const id of ids) {
      const f = toneFraction(boxTone(id))
      expect(f).toBeGreaterThan(0)
      expect(Math.floor(Math.fround(23 + f))).toBe(23) // a Float32 attribute holds tile + fraction exactly
      expect(Math.fround(23 + f) - 23).toBe(f)
      fractions.add(f)
    }
    expect(fractions.size).toBe(TONE_LEVELS * TONE_LEVELS)
  })
})
