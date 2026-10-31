/**
 * Seam 4, the ASC model (TT-24). Reads only the committed GLB, its sidecar and
 * previews (no Blender), like the CI budget check.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, MODELS_DIR } from '../cli/assets/budgetCheck'
import { readGlbJson } from '../cli/assets/glb'
import { ROW_PITCH_M, TIER_PITCH_M } from '../engine'
import { CONTAINER_DIMS } from '../modules/sceneModel'

const DIR = join(MODELS_DIR, 'asc')
// The sidecar is free-form JSON; the test reads it loosely.
const meta = (): Record<string, any> => JSON.parse(readFileSync(join(DIR, 'asc.meta.json'), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any

describe('ASC model asset', () => {
  it('is committed with its sidecar and the four preview views, and passes the budget check', () => {
    expect(existsSync(join(DIR, 'asc.glb'))).toBe(true)
    for (const view of ['front', 'side', 'rear', 'three-quarter']) {
      expect(existsSync(join(DIR, 'previews', `asc-${view}.webp`))).toBe(true)
    }
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const asc = report.assets.find((a) => a.name === 'asc')
    expect(asc?.kind).toBe('asc')
    expect(Object.keys(asc?.lods ?? {}).sort()).toEqual(['LOD0', 'LOD1', 'LOD2'])
  })

  it('stays near its triangle targets (LOD0 ~15k, LOD1 ~4k, LOD2 ~600)', () => {
    const lods = checkAssetLibrary().assets.find((a) => a.name === 'asc')!.lods
    expect(lods.LOD0.triangles).toBeGreaterThan(11000)
    expect(lods.LOD1.triangles).toBeGreaterThan(2800)
    expect(lods.LOD2.triangles).toBeGreaterThan(400)
  })

  it('has the rig nodes (gantry, trolley, hoist, spreader, twist-locks) in every LOD, so far cranes still move', () => {
    const json = readGlbJson(join(DIR, 'asc.glb'))
    const names = (json.nodes ?? []).map((n) => n.name ?? '')
    for (const n of ['gantry', 'trolley', 'hoist', 'spreader']) {
      expect(names.filter((x) => x === n).length, n).toBe(3)
    }
    expect(names.filter((x) => x === 'ropes').length).toBe(2) // LOD0 and LOD1
    for (const n of ['twistlock_fl', 'twistlock_fr', 'twistlock_rl', 'twistlock_rr']) expect(names, n).toContain(n)
  })

  it('keeps rig nodes exact: they are empties at their pivots, with the meshes in `_geo` children (compression puts its transform on mesh nodes)', () => {
    const json = readGlbJson(join(DIR, 'asc.glb'))
    const rig = new Set(['gantry', 'trolley', 'ropes', 'hoist', 'spreader', 'twistlock_fl', 'twistlock_fr', 'twistlock_rl', 'twistlock_rr'])
    const nodes = (json.nodes ?? []) as { name?: string; mesh?: number; scale?: number[]; translation?: number[] }[]
    const rigNodes = nodes.filter((n) => rig.has(n.name ?? ''))
    expect(rigNodes.length).toBe(9 + 5 + 4)
    for (const n of rigNodes) {
      expect(n.mesh, n.name).toBeUndefined()
      expect(n.scale, n.name).toBeUndefined()
    }
    // Pivots are exact: the trolley sits at the top of the bridge rails, the hoist 4.2 m below it (plane at 18 m).
    expect(nodes.find((n) => n.name === 'trolley')!.translation).toEqual([0, expect.closeTo(22.2, 5), 0])
    expect(nodes.find((n) => n.name === 'hoist')!.translation).toEqual([0, expect.closeTo(-4.2, 5), 0])
    expect(nodes.filter((n) => n.name?.endsWith('_geo') && n.mesh !== undefined).length).toBe(9 + 5 + 3) // LOD0, LOD1, LOD2 (its spreader has no mesh)
  })

  it('records travel limits with pivots at the mechanical axes, and the container attach point', () => {
    const m = meta()
    expect(m.travelLimits.gantry).toMatchObject({ type: 'translation', axis: '+Z' })
    expect(m.travelLimits.trolley).toMatchObject({ type: 'translation', axis: '+X' })
    expect(m.travelLimits.hoist).toMatchObject({ type: 'translation', axis: '+Y', rest: 0, maxM: 0 })
    expect(m.travelLimits.spreader).toMatchObject({ type: 'translation', axis: '+Y' })
    expect(m.travelLimits.twistlock_fl).toMatchObject({ type: 'rotation', axis: '+Y' })
    // The trolley reaches both outer rows; the gantry has a long rail run.
    expect(m.travelLimits.trolley.minM).toBeLessThan(-10)
    expect(m.travelLimits.trolley.maxM).toBeGreaterThan(10)
    expect(m.travelLimits.gantry.maxM - m.travelLimits.gantry.minM).toBeGreaterThan(100)
    // Pivots: hoist at the twist-lock plane (raised), ropes derived from the hoist.
    const node = (name: string) => m.nodes.find((n: { name: string }) => n.name === name)
    expect(node('hoist').pivot[1]).toBeCloseTo(m.hoist.restAttachM, 3)
    // The ropes are a stretch rule (trolley drum to head block), like the STS; the box hangs from the spreader's `container` point.
    expect(m.stretch).toEqual([expect.objectContaining({ node: 'ropes', to: 'hoist', axis: 'Y' })])
    expect(node('ropes').pivot[1]).toBeGreaterThan(m.hoist.restAttachM)
    const attach = m.attachPoints.find((a: { name: string }) => a.name === 'container')
    expect(attach).toMatchObject({ node: 'spreader', position: [0, 0, 0], yawDeg: 90 })
    expect(m.lods.LOD0.maxDistanceM).toBeLessThan(m.lods.LOD1.maxDistanceM)
    // Lowest plane = top of a 40 ft HC standing on the ground (the hoist reaches it).
    expect(m.hoist.restAttachM + m.travelLimits.hoist.minM).toBeCloseTo(CONTAINER_DIMS['40HC'].height, 2)
  })

  it('spans 25.4 m over 8 rows; 8 rows of reference containers fit with clearance at a 5-high stack', () => {
    const m = meta()
    expect(m.dimensions.spanM).toBe(25.4)
    expect(m.stack.rows).toBe(8)
    const widthOfRows = 7 * ROW_PITCH_M + CONTAINER_DIMS['40HC'].width
    expect(m.stack.clearSpanM).toBeGreaterThan(widthOfRows + 1) // at least 0.5 m each side
    const top5 = 5 * TIER_PITCH_M
    expect(m.stack.designTiers).toBeGreaterThanOrEqual(5)
    // A box carried over a full stack: its bottom (plane - 2.896) clears the stack top by the engine's travel clearance.
    expect(m.hoist.restAttachM - CONTAINER_DIMS['40HC'].height).toBeGreaterThanOrEqual(top5 + 0.5)
    // Everything hanging from the hoist at rest stays below the bridge underside.
    expect(m.stack.underBridgeM).toBeGreaterThan(m.hoist.restAttachM + 1)
    expect(m.dimensions.lengthM).toBeLessThan(12) // fits the 12 m ASC_MIN_SEPARATION_M with a gap
  })

  it('carries ZPMC, TTI ALGECIRAS (text only) and "40 t" marks, and tags approximations in provenance', () => {
    const m = meta()
    expect(m.branding.manufacturerWordmark).toBe('ZPMC')
    expect(m.branding.swlMark).toBe('40 t')
    expect(m.branding.operatorBranding).toBe(true) // TTI ALGECIRAS, as text
    expect(m.provenance.some((p: { tag: string }) => p.tag === 'A')).toBe(true)
    expect(m.branding.livery).toBe('TTI ALGECIRAS')
    expect(m.branding.note).toMatch(/no logo artwork/)
    expect(m.nodes.filter((n: { role: string }) => n.role === 'rig').map((n: { name: string }) => n.name)).toEqual(
      expect.arrayContaining(['gantry', 'trolley', 'hoist', 'spreader']),
    )
  })

  it('exposes the amber beacon mounts on the gantry, one per leg, on the rail-end face (TT-128)', () => {
    const mounts = meta().beaconMounts as { name: string; node: string; position: number[]; lens: string }[]
    expect(mounts).toHaveLength(4)
    expect(new Set(mounts.map((b) => b.name)).size).toBe(4)
    for (const b of mounts) {
      expect(b.node).toBe('gantry')
      expect(b.lens).toBe('amber')
      expect(b.position).toHaveLength(3)
      expect(Math.abs(b.position[0])).toBeGreaterThan(meta().stack.clearSpanM / 2) // outside the stack, on the legs
      expect(b.position[1]).toBeGreaterThan(2)
      expect(b.position[1]).toBeLessThan(meta().stack.underBridgeM)
    }
    expect(mounts.some((b) => b.position[0] < 0) && mounts.some((b) => b.position[0] > 0)).toBe(true)
    expect(mounts.some((b) => b.position[2] < 0) && mounts.some((b) => b.position[2] > 0)).toBe(true)
  })

  it('has portal-frame detail from the TTI photos: stairs on a leg, a girder sign band and rail-bogie hazard bollards', () => {
    const m = meta()
    expect(m.branding.placement).toMatch(/TTI ALGECIRAS/)
    expect(m.branding.signBand).toEqual(expect.arrayContaining(['unit number', 'TTI ALGECIRAS', 'ZPMC', '40 t']))
    expect(m.nodes.find((n: { name: string }) => n.name === 'gantry').description).toMatch(/stair/)
  })
})
