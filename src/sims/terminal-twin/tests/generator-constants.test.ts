/**
 * The Blender generators (Python) and the renderer (TypeScript) share a few dimensions by hand-copied constants: the
 * door bar positions the lettering is laid out around, and the corrugation profile the hero decal is lit with. This
 * reads the generators and fails when a copy has drifted, and checks the hero depth bias covers the deepest recess.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOOR_BANDS, DOOR_BAR_INNER_M, DOOR_BAR_OUTER_M, DOOR_HEADER_M, DOOR_LEAF_M, DOOR_SILL_M } from '../modules/containerTextures'
import atlas from '../assets/models/containers/livery-atlas.json'
import { liveryBodyColour } from '../modules/containerAssets'
import { HERO_DEPTH_BIAS_M, HERO_GENERATOR_CONSTANTS as C, heroMarkInsetM } from '../modules/heroMarkings'

const dir = join(__dirname, '../assets/generators/tt_assets')
const containers = readFileSync(join(dir, 'containers.py'), 'utf8')
const hero = readFileSync(join(dir, 'hero_containers.py'), 'utf8')
const liveries = readFileSync(join(dir, 'liveries.py'), 'utf8')

function num(source: string, name: string): number {
  const m = new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, 'm').exec(source)
  if (!m) throw new Error(`${name} not found in the generator`)
  return Number(m[1])
}

describe('generator constants copied into the renderer', () => {
  it('castings, rails, rib depth, hero pitch and door bands agree', () => {
    const cast = /^CAST_L, CAST_W, CAST_H = ([0-9.]+), ([0-9.]+), ([0-9.]+)/m.exec(containers)!
    expect([Number(cast[1]), Number(cast[2])]).toEqual([C.castLengthM, C.castWidthM])
    expect(num(containers, 'BOTTOM_RAIL_TOP')).toBe(C.railBottomM)
    expect(num(containers, 'TOP_RAIL_DEPTH')).toBe(C.railTopM)
    expect(num(liveries, 'RIB_DEPTH_M')).toBe(C.ribDepthM)
    expect(num(hero, 'HERO_PITCH_M')).toBe(C.heroPitchM)
    expect(num(hero, 'DOOR_BANDS')).toBe(C.doorBands)
    // the close-up door tile paints and shades the same bands between the same rails
    expect(DOOR_BANDS).toBe(C.doorBands)
    expect(DOOR_SILL_M).toBe(C.railBottomM)
    expect(DOOR_HEADER_M).toBe(C.railTopM)
  })

  it('door bars sit where the lettering is laid out around them', () => {
    const fracs = /^DOOR_BAR_FRACS = \(([0-9.]+), ([0-9.]+)\)/m.exec(containers)!
    const leaf = 2.438 / 2 - C.castWidthM + 0.007 // `fy` in the generators
    expect(DOOR_LEAF_M).toBeCloseTo(leaf, 6)
    expect(DOOR_BAR_INNER_M).toBeCloseTo(Number(fracs[1]) * leaf, 6)
    expect(DOOR_BAR_OUTER_M).toBeCloseTo(Number(fracs[2]) * leaf, 6)
  })

  it('the hero depth bias covers the deepest recess, and a door decal lies on the crests behind the bars', () => {
    expect(hero).toContain(`valley, crest = hl - ${C.doorValleyInsetM}, hl - ${C.doorValleyInsetM} + RIB_DEPTH_M`)
    expect(HERO_DEPTH_BIAS_M).toBeGreaterThan(C.doorValleyInsetM)
    const crestInset = C.doorValleyInsetM - C.ribDepthM
    expect(heroMarkInsetM('door')).toBeLessThanOrEqual(crestInset)
    expect(heroMarkInsetM('door')).toBeGreaterThan(0.022) // the bars' centre line is 22 mm inside the frame
  })
})

/** Muted weathered palette (#359): a real yard is oxidised and faded, so no livery body is a clean primary. */
const LIVERY_MAX_SATURATION = 0.65 // HSV saturation
const LIVERY_MAX_VALUE = 0.85 // HSV value: a little darker than a fresh paint chip
const MIN_WORDMARK_CONTRAST = 3 // WCAG ratio for large text

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}
function luminance(hex: string): number {
  const lin = rgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('livery palette (#359)', () => {
  const generated = [...liveries.matchAll(/'body': '(#[0-9a-f]{6})', 'text': '(#[0-9a-f]{6})'/g)].map((m) => ({ body: m[1], text: m[2] }))

  it('the atlas json, the placeholder colour and the generator hold the same body colours', () => {
    expect(generated.length).toBe(atlas.liveries.length)
    atlas.liveries.forEach((l, i) => {
      expect(l.body, l.line ?? 'generic').toBe(generated[i].body)
      expect(liveryBodyColour(i)).toBe(generated[i].body)
    })
  })

  it('every body is muted: under the saturation and value ceilings', () => {
    for (const { line, body } of atlas.liveries) {
      const c = rgb(body)
      const max = Math.max(...c)
      const sat = max === 0 ? 0 : (max - Math.min(...c)) / max
      expect(sat, `${line ?? 'generic'} ${body}`).toBeLessThanOrEqual(LIVERY_MAX_SATURATION)
      expect(max, `${line ?? 'generic'} ${body}`).toBeLessThanOrEqual(LIVERY_MAX_VALUE)
    }
  })

  it('every wordmark stays readable on its body', () => {
    for (const { line, body, text } of atlas.liveries) expect(contrast(body, text), line ?? 'generic').toBeGreaterThanOrEqual(MIN_WORDMARK_CONTRAST)
  })
})

describe('leasing and old-stock tiles (#360)', () => {
  const leasingNames = [...liveries.matchAll(/\{'leasing': '([a-z -]+)', 'weight': (\d+)/g)].map((m) => ({ name: m[1], weight: Number(m[2]) }))

  it('the atlas json holds the generator leasing tiles after the line tiles, with no wordmark', () => {
    expect(leasingNames.length).toBeGreaterThanOrEqual(7)
    expect(atlas.leasing.map(({ name, weight }) => ({ name, weight }))).toEqual(leasingNames)
    atlas.leasing.forEach((l, i) => {
      expect(l.index).toBe(atlas.genericIndex + 1 + i)
      expect(atlas.liveries[l.index]).toMatchObject({ line: null, wordmark: '', ownerPrefix: '' })
    })
  })

  it('include rust, brown and off-white, weighted towards rust, oxblood and brown', () => {
    const body = (name: string) => atlas.liveries[atlas.leasing.find((l) => l.name === name)!.index].body
    expect(body('rust')).toBe('#8a4a3a')
    expect(body('brown')).toBe('#6b4a38')
    expect(body('off-white')).toBe('#d6d3c9')
    const w = (name: string) => atlas.leasing.find((l) => l.name === name)!.weight
    for (const other of ['dull blue', 'faded green', 'grey', 'off-white']) {
      for (const heavy of ['rust', 'oxblood', 'brown']) expect(w(heavy)).toBeGreaterThan(w(other))
    }
  })

  it('the atlas grid holds every tile at the original tile size, and the far atlas has the same layout', () => {
    const tiles = atlas.liveries.length
    expect(tiles).toBe(atlas.genericIndex + 1 + atlas.leasing.length)
    expect(atlas.tileCols * atlas.tileRows).toBeGreaterThanOrEqual(tiles)
    expect(atlas.tileCols * (atlas.tileRows - 1)).toBeLessThan(tiles) // no empty row
    expect(atlas.size[0] * atlas.tileSizeUv[0]).toBe(1024)
    expect(atlas.size[1] * atlas.tileSizeUv[1]).toBeCloseTo(2048 / 6, 6)
    expect(atlas.far.size[0] / atlas.far.size[1]).toBe(atlas.size[0] / atlas.size[1])
  })
})
