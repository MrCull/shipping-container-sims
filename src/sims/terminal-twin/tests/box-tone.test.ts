/**
 * #361: per-box tone jitter. Each box in the default colour mode gets a small, stable brightness and saturation shift
 * (slightly faded or dirty), a pure function of its id, so a stack is not a row of identical clones.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TONE_BRIGHTNESS_RANGE, TONE_LEVELS, TONE_SATURATION_RANGE, boxTone, tonedColour, toneFraction } from '../modules/boxLivery'
import atlas from '../assets/models/containers/livery-atlas.json'
import { ContainerInstancer } from '../modules/containerInstancer'

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

  it('fits every tone step in one packed digit (codes 1 to 15, 0 reserved for no tone)', () => {
    expect(TONE_LEVELS).toBeLessThanOrEqual(15)
    expect(TONE_LEVELS % 2).toBe(1)
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

  // #362: the close-up and hero faces drawn over a near box take its colour from `CloseupSource.bodyColour`, so a box
  // must get the same tone there as the instanced box's shader gives it, or it changes colour as it changes level of detail
  it('tones a CSS colour exactly as the livery shader tones the box (linear space), so close-up and hero faces match', () => {
    const shader = (css: string, b: number, s: number) => {
      const c = new THREE.Color(css) // linear
      const grey = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
      const f = (v: number) => Math.min(Math.max(grey + (v - grey) * (1 + s), 0) * (1 + b), 1)
      return new THREE.Color(f(c.r), f(c.g), f(c.b))
    }
    for (const id of ids.slice(0, 200)) {
      const tone = boxTone(id)
      for (const l of atlas.liveries) {
        const want = shader(l.body, tone.brightness, tone.saturation)
        const got = new THREE.Color(tonedColour(l.body, tone))
        for (const k of ['r', 'g', 'b'] as const) expect(got[k]).toBeCloseTo(want[k], 2)
      }
    }
  })

  it('leaves a colour as it is with no tone or a zero tone (colour by tints)', () => {
    expect(tonedColour('#8a3b2a', null)).toBe('#8a3b2a')
    expect(tonedColour('#8a3b2a', { brightness: 0, saturation: 0 })).toBe('#8a3b2a')
  })

  // a placeholder box (before the GLBs load) must take the tone the GLB box will get, or it jumps in tone when they load
  it('tones the placeholder box drawn before the GLBs load; a colour-by tint stays flat', () => {
    const tone = boxTone('TGHU0000123')
    expect(tone.brightness !== 0 || tone.saturation !== 0).toBe(true)
    const inst = new ContainerInstancer({ '40': 3 })
    inst.setDrawnRecording(true)
    inst.begin()
    inst.push(0, '40', 0, 1.3, 0, 2, 0, -1, false, tone)
    inst.push(1, '40', 13, 1.3, 0, 2)
    inst.push(2, '40', 26, 1.3, 0, 2, 0, 0x4c9be8, false, null)
    inst.end(new THREE.Vector3(0, 1.3, 20))
    const colour = (key: number) => inst.drawnBoxes().find((b) => b.key === key)!.colour
    const body = atlas.liveries[2].body
    expect(colour(0)).toBe(new THREE.Color(tonedColour(body, tone)).getHex())
    expect(colour(0)).not.toBe(new THREE.Color(body).getHex())
    expect(colour(1)).toBe(new THREE.Color(body).getHex())
    expect(colour(2)).toBe(0x4c9be8)
  })
})
