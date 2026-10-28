/**
 * Seam 4 — the ASC model (TT-24). Reads only the committed GLB, its sidecar and
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
    expect(node('ropes').derived.from).toBe('hoist')
    const attach = m.attachPoints.find((a: { name: string }) => a.name === 'container_attach')
    expect(attach.parent).toBe('hoist')
    expect(attach.position[1]).toBeCloseTo(m.hoist.restAttachM, 3)
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

  it('carries ZPMC and "40 t" marks, no operator branding, and tags approximations in provenance', () => {
    const m = meta()
    expect(m.branding.manufacturerWordmark).toBe('ZPMC')
    expect(m.branding.swlMark).toBe('40 t')
    expect(m.branding.operatorBranding).toBe(false)
    expect(m.provenance.some((p: { tag: string }) => p.tag === 'A')).toBe(true)
    expect(JSON.stringify(m)).not.toMatch(/TTI|Algeciras/i)
    expect(m.nodes.filter((n: { role: string }) => n.role === 'rig').map((n: { name: string }) => n.name)).toEqual(
      expect.arrayContaining(['gantry', 'trolley', 'hoist', 'spreader']),
    )
  })
})
