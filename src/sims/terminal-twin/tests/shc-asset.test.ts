/**
 * Seam 4 — the SHC model (TT-25). Reads only the committed GLB, its sidecar and
 * previews (no Blender), like the CI budget check.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, MODELS_DIR } from '../cli/assets/budgetCheck'
import { readGlbJson } from '../cli/assets/glb'
import { CONTAINER_DIMS } from '../modules/sceneModel'

const DIR = join(MODELS_DIR, 'shc')
// The sidecar is free-form JSON; the test reads it loosely.
const meta = (): Record<string, any> => JSON.parse(readFileSync(join(DIR, 'shc.meta.json'), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any

describe('SHC model asset', () => {
  it('is committed with its sidecar and the four preview views, and passes the budget check', () => {
    expect(existsSync(join(DIR, 'shc.glb'))).toBe(true)
    for (const view of ['front', 'side', 'rear', 'three-quarter']) {
      expect(existsSync(join(DIR, 'previews', `shc-${view}.webp`))).toBe(true)
    }
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const shc = report.assets.find((a) => a.name === 'shc')
    expect(shc?.kind).toBe('shc')
    expect(Object.keys(shc?.lods ?? {}).sort()).toEqual(['LOD0', 'LOD1', 'LOD2'])
  })

  it('stays near its triangle targets (LOD0 ~12k, LOD1 ~3k, LOD2 ~400)', () => {
    const lods = checkAssetLibrary().assets.find((a) => a.name === 'shc')!.lods
    expect(lods.LOD0.triangles).toBeGreaterThan(9000)
    expect(lods.LOD1.triangles).toBeGreaterThan(2000)
    expect(lods.LOD2.triangles).toBeGreaterThan(250)
  })

  it('has the rig nodes: four steered wheel corners, hoist, spreader and twist-locks, in every animated LOD', () => {
    const json = readGlbJson(join(DIR, 'shc.glb'))
    const names = (json.nodes ?? []).map((n) => n.name ?? '')
    for (const corner of ['fl', 'fr', 'rl', 'rr']) {
      expect(names.filter((n) => n === `steer_${corner}`).length).toBeGreaterThanOrEqual(2)
      expect(names.filter((n) => n === `wheel_${corner}`).length).toBeGreaterThanOrEqual(2)
    }
    for (const n of ['hoist', 'spreader', 'twistlock_fl', 'twistlock_fr', 'twistlock_rl', 'twistlock_rr']) {
      expect(names).toContain(n)
    }
  })

  it('keeps rig nodes exact: they are empties, with the meshes in `_geo` children (compression puts its transform on mesh nodes)', () => {
    const json = readGlbJson(join(DIR, 'shc.glb'))
    const rig = /^(steer_|wheel_|twistlock_)(fl|fr|rl|rr)$|^(hoist|spreader)$/
    const nodes = (json.nodes ?? []) as { name?: string; mesh?: number; scale?: number[] }[]
    const rigNodes = nodes.filter((n) => rig.test(n.name ?? ''))
    expect(rigNodes.length).toBeGreaterThanOrEqual(2 * 12)
    for (const n of rigNodes) {
      expect(n.mesh, n.name).toBeUndefined()
      expect(n.scale, n.name).toBeUndefined()
    }
    expect(nodes.filter((n) => n.name?.endsWith('_geo') && n.mesh !== undefined).length).toBeGreaterThanOrEqual(rigNodes.length - 3)
  })

  it('records rig travel limits with pivots at the mechanical axes, and the container attach point', () => {
    const m = meta()
    expect(m.travelLimits.steer_fl).toMatchObject({ type: 'rotation', axis: '+Y' })
    expect(m.travelLimits.wheel_fl).toMatchObject({ type: 'rotation', axis: '+Z' })
    expect(m.travelLimits.hoist).toMatchObject({ type: 'translation', axis: '+Y', rest: 0 })
    expect(m.travelLimits.hoist.minM).toBeLessThan(-2)
    expect(m.travelLimits.hoist.maxM).toBe(0)
    expect(m.travelLimits.twistlock_fl).toMatchObject({ type: 'rotation', axis: '+Y' })
    const wheelNode = m.nodes.find((n: { name: string }) => n.name === 'wheel_fl')
    expect(wheelNode.pivot[1]).toBeCloseTo(m.wheel.radiusM, 2) // axle height = tyre radius
    const attach = m.attachPoints.find((a: { name: string }) => a.name === 'container_attach')
    expect(attach.parent).toBe('hoist')
    expect(attach.position[1]).toBeGreaterThan(CONTAINER_DIMS['40HC'].height) // raised above a box standing on the ground
  })

  it('a 40 ft high-cube container fits inside the tunnel at true scale (open ends, clear height and width)', () => {
    const t = meta().tunnel
    const box = CONTAINER_DIMS['40HC']
    expect(t.clearWidthM).toBeGreaterThan(box.width + 0.5)
    expect(t.clearHeightM).toBeGreaterThan(box.height * 2) // can carry over a stacked box on the pad
    expect(t.openEnds).toBe(true)
    expect(box.length).toBeGreaterThan(t.frameLengthM) // the box overhangs the frame fore and aft, as on a real SHC
  })

  it('tags approximations and the Kalmar branding in provenance, with no operator branding', () => {
    const m = meta()
    expect(m.provenance.some((p: { tag: string }) => p.tag === 'A')).toBe(true)
    expect(JSON.stringify(m.branding)).toMatch(/KALMAR/)
    expect(m.branding.operatorBranding).toBe(false)
    expect(JSON.stringify(m)).not.toMatch(/TTI|Algeciras/i)
  })
})
