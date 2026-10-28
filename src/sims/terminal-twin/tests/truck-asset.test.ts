/**
 * Seam 4 — the truck models (TT-26): three tractor cab variants (each with the skeletal chassis) and the
 * standalone chassis. Reads only the committed GLBs, sidecars and previews (no Blender), like the CI budget check.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, MODELS_DIR } from '../cli/assets/budgetCheck'
import { readGlbJson } from '../cli/assets/glb'

const DIR = join(MODELS_DIR, 'trucks')
const CABS = ['truck-cab-high', 'truck-cab-mid', 'truck-cab-day']
const meta = (name: string): Record<string, any> => JSON.parse(readFileSync(join(DIR, `${name}.meta.json`), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any

describe('truck models', () => {
  it('has a GLB, sidecar and previews for every cab variant and the chassis, and passes the budget check', () => {
    for (const name of [...CABS, 'truck-chassis']) {
      expect(existsSync(join(DIR, `${name}.glb`)), name).toBe(true)
      expect(existsSync(join(DIR, `${name}.meta.json`)), name).toBe(true)
      for (const view of ['side', 'three-quarter', 'front', 'rear']) expect(existsSync(join(DIR, 'previews', `${name}-${view}.webp`)), `${name}-${view}`).toBe(true)
    }
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    for (const name of CABS) {
      const a = report.assets.find((x) => x.name === name)!
      expect(a.kind).toBe('truck')
      expect(a.lods.LOD0.triangles).toBeGreaterThan(5000) // ~8k target
      expect(a.lods.LOD1.triangles).toBeGreaterThan(1200) // ~2k
      expect(a.lods.LOD2.triangles).toBeGreaterThan(150) // ~300
    }
  })

  it('has rolling, steering and fifth-wheel rig nodes in every LOD that animates', () => {
    for (const name of CABS) {
      const names = (readGlbJson(join(DIR, `${name}.glb`)).nodes ?? []).map((n) => n.name ?? '')
      for (const n of ['steer_fl', 'steer_fr', 'wheel_fl', 'wheel_fr', 'wheel_r', 'wheel_t1', 'wheel_t2', 'wheel_t3']) {
        expect(names.filter((x) => x === n).length, `${name} ${n}`).toBeGreaterThanOrEqual(2)
      }
      expect(names.filter((x) => x === 'fifth_wheel').length).toBe(3) // articulation survives in all three LODs
      expect(names).toContain('chassis')
    }
  })

  it('records the fifth wheel pivot, rig limits and container attach points at ISO 1161 casting centres', () => {
    for (const name of CABS) {
      const m = meta(name)
      expect(m.travelLimits.fifth_wheel).toMatchObject({ type: 'rotation', axis: '+Y' })
      expect(m.travelLimits.steer_fl).toMatchObject({ type: 'rotation', axis: '+Y' })
      expect(m.travelLimits.wheel_t1).toMatchObject({ type: 'rotation', axis: '+Z' })
      const pins = m.attachPoints.filter((a: { name: string }) => a.name.startsWith('pin_40_'))
      expect(pins).toHaveLength(4)
      for (const p of pins) {
        expect(Math.abs(p.position[0])).toBeCloseTo(5.9925, 3)
        expect(Math.abs(p.position[2])).toBeCloseTo(1.1295, 3)
      }
      const load = (n: string) => m.attachPoints.find((a: { name: string }) => a.name === n)
      expect(load('load_40').position[0]).toBeCloseTo(0, 3)
      expect(load('load_20_front').position[0]).toBeCloseTo(3.0675, 2)
      expect(load('load_20_rear').position[0]).toBeCloseTo(-3.0675, 2)
      expect(load('load_20_front').position[1]).toBeCloseTo(1.3, 3) // box bottom = chassis deck
      expect(m.attachPoints.filter((a: { name: string }) => a.name.startsWith('pin_20_mid_'))).toHaveLength(4) // twin 20s meet at the middle
    }
  })

  it('names the five truck makers on the cabs (wordmarks only, no logos) and tags approximations', () => {
    const makers = new Set<string>()
    for (const name of CABS) {
      const m = meta(name)
      for (const v of m.liveries as { maker: string }[]) makers.add(v.maker)
      expect(m.provenance.some((p: { tag: string }) => p.tag === 'A')).toBe(true)
    }
    expect([...makers].sort()).toEqual(['DAF', 'MAN', 'Mercedes-Benz', 'Scania', 'Volvo'])
  })

  it('has a standalone chassis with the same pins and wheels', () => {
    const m = meta('truck-chassis')
    expect(m.kind).toBe('chassis')
    expect(m.attachPoints.filter((a: { name: string }) => a.name.startsWith('pin_40_'))).toHaveLength(4)
    expect(m.travelLimits.wheel_t2).toBeDefined()
    expect(m.travelLimits.fifth_wheel).toBeUndefined()
  })
})
