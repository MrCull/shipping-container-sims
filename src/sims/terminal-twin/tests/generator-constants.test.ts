/**
 * The Blender generators (Python) and the renderer (TypeScript) share a few dimensions by hand-copied constants: the
 * door bar positions the lettering is laid out around, and the corrugation profile the hero decal is lit with. This
 * reads the generators and fails when a copy has drifted, and checks the hero depth bias covers the deepest recess.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOOR_BAR_INNER_M, DOOR_BAR_OUTER_M, DOOR_LEAF_M } from '../modules/containerTextures'
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
