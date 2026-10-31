import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildBackdrop, backdropModelAssets, sceneryFor } from '../modules/backdrop'
import { presets, SMALL_PRESET_NAME } from '../scenario/presets'
import { terminalForScenario, terminalPresetInfo } from '../terminals'
import { NORTH_QUAY_LENGTH_M, PEAK_DAY_PRESET_NAME, ROCK, TTI_PRESET_NAME } from '../terminals/tti-algeciras/constants'

describe('terminal registry', () => {
  it('claims the two TTI presets for TTI Algeciras and nothing else', () => {
    expect(terminalForScenario(TTI_PRESET_NAME)?.id).toBe('tti-algeciras')
    expect(terminalForScenario(PEAK_DAY_PRESET_NAME)?.id).toBe('tti-algeciras')
    expect(terminalForScenario(SMALL_PRESET_NAME)).toBeNull()
    expect(terminalForScenario('tracer')).toBeNull()
    expect(terminalPresetInfo(PEAK_DAY_PRESET_NAME)?.daylightLockDefault).toBe(true)
    expect(terminalPresetInfo(TTI_PRESET_NAME)?.derivedBays).toBe(true)
    expect(terminalPresetInfo(SMALL_PRESET_NAME)).toBeNull()
  })

  it('every preset of a terminal exists', () => {
    for (const name of [TTI_PRESET_NAME, PEAK_DAY_PRESET_NAME]) expect(Object.keys(presets)).toContain(name)
  })

  it('no generic module outside the terminal folder names a TTI preset', () => {
    const root = join(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (['tests', 'terminals', 'assets', 'node_modules'].includes(e.name)) continue
          walk(p)
        } else if (/\.(ts|vue)$/.test(e.name) && !/presets\.ts$/.test(e.name)) {
          if (/TTI_PRESET_NAME|PEAK_DAY_PRESET_NAME|TTI_DERIVED_BAYS_PRESETS/.test(readFileSync(p, 'utf8'))) offenders.push(p.slice(root.length))
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})

describe('scenery by terminal', () => {
  it('gives TTI the Algeciras scenery and a generic preset the plain coastline', () => {
    expect(sceneryFor(TTI_PRESET_NAME).kind).toBe('tti')
    expect(sceneryFor(SMALL_PRESET_NAME).kind).toBe('generic')
    expect(sceneryFor('tracer').parts).not.toContain('rock')
    expect(backdropModelAssets(sceneryFor(TTI_PRESET_NAME))).toEqual(['backdrop-rock', 'backdrop-hills', 'backdrop-coast'])
    expect(backdropModelAssets(sceneryFor(SMALL_PRESET_NAME))).toEqual([])
  })

  it('places the Rock at true scale about 9 km east of the quay, inside the fog', () => {
    expect(ROCK.lengthM).toBe(5200)
    expect(ROCK.widthM).toBe(1200)
    expect(ROCK.heightM).toBe(426)
    expect(ROCK.distanceM).toBeGreaterThanOrEqual(8800)
    expect(ROCK.distanceM).toBeLessThanOrEqual(9500)
    const scenery = sceneryFor(TTI_PRESET_NAME)
    expect(scenery.fogFarM).toBeGreaterThan(ROCK.distanceM + ROCK.widthM)
    const b = buildBackdrop(scenery, 850)
    const rock = b.group.getObjectByName('rock') as THREE.Mesh
    rock.geometry.computeBoundingBox()
    const box = rock.geometry.boundingBox!
    expect(box.max.y).toBeCloseTo(426, 0)
    expect(rock.scale.y).toBe(1)
    expect(box.max.x - box.min.x).toBeCloseTo(5200, 0)
    expect(box.max.z - box.min.z).toBeCloseTo(1200, 0)
    expect(rock.position.z).toBeCloseTo(-ROCK.distanceM, 0)
    expect(rock.position.x).toBeCloseTo(425 + ROCK.offsetSouthM, 0)
    const quay = b.group.getObjectByName('northQuay') as THREE.Group
    expect(quay.children[0]).toBeDefined()
    expect(NORTH_QUAY_LENGTH_M).toBe(550)
    b.dispose()
  })

  it('the Rock profile has a steep north face and its summit in the north half', () => {
    const p = ROCK.profile
    expect(p[0][1]).toBe(0)
    expect(p[p.length - 1][1]).toBe(0)
    expect(Math.max(...p.map((q) => q[1]))).toBe(426)
    const north = p.find((q) => q[1] >= 250)!
    expect((north[0] - p[0][0]) / north[1]).toBeLessThan(0.5) // steeper than 2:1
    expect(p.find((q) => q[1] === 426)![0]).toBeLessThan(0)
  })
})
