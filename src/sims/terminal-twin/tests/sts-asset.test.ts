/**
 * Seam 4, phase 2 asset outputs for the STS (TT-23): the committed
 * Malaccamax quay-crane GLB, its rig sidecar and its previews.
 * Expected values come from the TTI reference pack (rail gauge, lift height,
 * outreach) and the scenario geometry the engine works in (vessel rows, hold
 * tiers, ground lanes), not from the generator.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, MODELS_DIR } from '../cli/assets/budgetCheck'
import { readGlbJson, type GltfJson } from '../cli/assets/glb'
import { DEFAULT_LAYOUT } from '../scenario/builder'
import { HALF_OFFSET_M, slotZ, tierBaseY, VESSEL_CLASSES } from '../scenario/vesselClasses'
import meta from '../assets/models/sts/sts-malaccamax.meta.json'

const DIR = join(MODELS_DIR, 'sts')
const GLB = join(DIR, 'sts-malaccamax.glb')
const LODS = ['LOD0', 'LOD1', 'LOD2'] as const
const RIG = ['gantry', 'trolley', 'hoist', 'spreader', 'boom', 'spreader_tele_fore', 'spreader_tele_aft', 'twin_locks']

interface SidecarNode {
  name: string
  parent: string
  role: string
  pivot?: number[]
  rig?: string
}

const nodes = meta.nodes as SidecarNode[]

/** World translation of every named node (rig nodes are translation-only empties). */
function worldTranslations(json: GltfJson): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const visit = (i: number, parent: number[]) => {
    const n = json.nodes![i]
    const t = n.translation ?? [0, 0, 0]
    const w = [parent[0] + t[0], parent[1] + t[1], parent[2] + t[2]]
    if (n.name) out.set(n.name, w)
    for (const c of n.children ?? []) visit(c, w)
  }
  for (const r of json.scenes![json.scene ?? 0].nodes ?? []) visit(r, [0, 0, 0])
  return out
}

function subtreeNames(json: GltfJson, name: string): string[] {
  const start = json.nodes!.findIndex((n) => n.name === name)
  const names: string[] = []
  const visit = (i: number) => {
    names.push(json.nodes![i].name ?? '')
    for (const c of json.nodes![i].children ?? []) visit(c)
  }
  if (start >= 0) visit(start)
  return names
}

describe('STS model (Malaccamax quay crane)', () => {
  const json = readGlbJson(GLB)

  it('passes the budget check with LOD0 ~40k, LOD1 ~8k and LOD2 ~1k triangles', () => {
    const report = checkAssetLibrary()
    const sts = report.assets.find((a) => a.name === 'sts-malaccamax')
    expect(sts?.kind).toBe('sts')
    expect(sts?.problems).toEqual([])
    expect(sts!.lods.LOD0.triangles).toBeGreaterThan(25_000)
    expect(sts!.lods.LOD0.triangles).toBeLessThanOrEqual(40_000)
    expect(sts!.lods.LOD1.triangles).toBeGreaterThan(4_000)
    expect(sts!.lods.LOD1.triangles).toBeLessThanOrEqual(8_000)
    expect(sts!.lods.LOD2.triangles).toBeGreaterThan(400)
    expect(sts!.lods.LOD2.triangles).toBeLessThanOrEqual(1_000)
  })

  it('has TTI Malaccamax geometry, tagged verified, with the steel extending above the 52 m lift envelope', () => {
    const g = meta.geometry
    expect(g.railGaugeM).toMatchObject({ value: 30.48, tag: 'V' })
    expect(g.liftHeightAboveRailM).toMatchObject({ value: 52, tag: 'V' })
    expect(g.outreachM).toMatchObject({ value: 68, tag: 'V' })
    // Not verified by the reference pack: approximations.
    for (const key of ['backreachM', 'apexHeightM', 'trolleyRailHeightM', 'legSpacingM', 'overBuffersM'] as const) {
      expect(g[key].tag, key).toBe('A')
    }
    expect(g.apexHeightM.value).toBeGreaterThan(52 + 15)
    expect(meta.dimensions.heightM).toBeGreaterThanOrEqual(g.apexHeightM.value)
    expect(g.trolleyRailHeightM.value).toBeGreaterThan(52)
    expect(meta.provenance.every((p) => ['V', 'P', 'A', 'M'].includes(p.tag))).toBe(true)
    expect(meta.provenance.some((p) => p.tag === 'A')).toBe(true)
  })

  it('places the waterside rail at the origin and the landside rail one gauge landward (+Z)', () => {
    const w = worldTranslations(json)
    expect(meta.axes.origin).toMatch(/waterside rail/)
    // Gantry rest pivot: crane centre line on the waterside rail, at rail level.
    expect(w.get('gantry')).toEqual([0, 0, 0])
    expect(meta.geometry.railGaugeM.value).toBe(30.48)
  })

  it('has a separate rig (gantry, trolley, hoist, spreader incl. twin-20, boom) in every LOD, twist-locks in LOD0', () => {
    for (const lod of LODS) {
      const sfx = lod === 'LOD0' ? '' : `_${lod.toLowerCase()}`
      const names = subtreeNames(json, lod)
      for (const rig of RIG) expect(names, `${lod} ${rig}`).toContain(`${rig}${sfx}`)
    }
    const lod0 = subtreeNames(json, 'LOD0')
    expect(lod0.filter((n) => n.startsWith('twistlock_') && !n.endsWith('_geo'))).toHaveLength(8)
    // Hierarchy: hoist hangs from the trolley, the spreader from the hoist; the boom hinges on the gantry.
    const parent = (n: string) => nodes.find((x) => x.name === n)?.parent
    expect(parent('trolley')).toBe('gantry')
    expect(parent('hoist')).toBe('trolley')
    expect(parent('spreader')).toBe('hoist')
    expect(parent('boom')).toBe('gantry')
    expect(parent('twin_locks')).toBe('spreader')
  })

  it('puts every rig pivot in the GLB exactly where the sidecar says (rig nodes carry no rotation or scale)', () => {
    const w = worldTranslations(json)
    const withPivot = nodes.filter((n) => n.pivot)
    expect(withPivot.length).toBeGreaterThanOrEqual(RIG.length * 3)
    for (const n of withPivot) {
      const glbNode = json.nodes!.find((x) => x.name === n.name)!
      expect(glbNode.rotation, n.name).toBeUndefined()
      expect(glbNode.scale, n.name).toBeUndefined()
      expect(glbNode.mesh, `${n.name} is a pivot empty`).toBeUndefined()
      const p = w.get(n.name)!
      for (let i = 0; i < 3; i++) expect(p[i], `${n.name}[${i}]`).toBeCloseTo(n.pivot![i], 3)
    }
    // The boom hinges within the girder depth (just under the trolley rails), seaward of the waterside legs.
    const boom = w.get('boom')!
    expect(boom[1]).toBeLessThan(meta.geometry.trolleyRailHeightM.value)
    expect(boom[1]).toBeGreaterThan(meta.geometry.trolleyRailHeightM.value - 4)
    expect(boom[2]).toBeLessThan(0)
  })

  it('travel limits cover the engine working envelope: outermost ULCV row, hold floor, ground lanes, 52 m lift', () => {
    const tl = meta.travelLimits as Record<string, { type: string; axis: string; minM?: number; maxM?: number; minDeg?: number; maxDeg?: number }>
    expect(tl.gantry).toMatchObject({ type: 'translation', axis: '+X' })
    expect(tl.trolley).toMatchObject({ type: 'translation', axis: '+Z' })
    expect(tl.hoist).toMatchObject({ type: 'translation', axis: '+Y', maxM: 52 })
    expect(tl.boom).toMatchObject({ type: 'rotation', axis: '+X', minDeg: 0 })
    expect(tl.boom.maxDeg).toBeGreaterThanOrEqual(70)
    // Trolley values are measured from the waterside rail; outreach is 68 m seaward.
    expect(tl.trolley.minM).toBe(-68)
    const ulcv = VESSEL_CLASSES.ulcv
    const waterRailZ = meta.sceneMounting.waterRailZ
    expect(slotZ(ulcv, ulcv.rows - 1) - waterRailZ).toBeGreaterThanOrEqual(tl.trolley.minM!)
    expect(DEFAULT_LAYOUT.stsGroundLaneZ0M + 2 * DEFAULT_LAYOUT.stsGroundLaneSpacingM - waterRailZ).toBeLessThanOrEqual(tl.trolley.maxM!)
    // Hoist values are the spreader underside's height above the rail.
    expect(tierBaseY(ulcv, 0)).toBeGreaterThanOrEqual(tl.hoist.minM!)
    expect(DEFAULT_LAYOUT.stsSafeHoistM).toBeLessThanOrEqual(tl.hoist.maxM!)
    // Telescopes reach 40 ft from the 20 ft rest position; twin-lift locks drop below the spreader.
    expect(tl.spreader_tele_fore.maxM! - tl.spreader_tele_fore.minM!).toBeCloseTo((12.192 - 6.058) / 2, 2)
    expect(tl.twin_locks).toMatchObject({ type: 'translation', axis: '-Y' })
    for (const n of Object.keys(tl).filter((k) => k.startsWith('twistlock_'))) expect(tl[n]).toMatchObject({ type: 'rotation', maxDeg: 90 })
  })

  it('records the container attach points under the spreader (single box and twin-20 halves)', () => {
    const ap = meta.attachPoints as { name: string; node: string; position: number[] }[]
    const single = ap.find((a) => a.name === 'container')!
    expect(single.node).toBe('spreader')
    expect(single.position).toEqual([0, 0, 0])
    const twin = ap.filter((a) => a.name.startsWith('container_twin_')).map((a) => a.position[0]).sort((a, b) => a - b)
    expect(twin[0]).toBeCloseTo(-HALF_OFFSET_M, 3)
    expect(twin[1]).toBeCloseTo(HALF_OFFSET_M, 3)
  })

  it('has committed previews: front, side, rear, three-quarter and a trolley/spreader close-up', () => {
    for (const view of ['front', 'side', 'rear', 'three-quarter', 'closeup']) {
      expect(existsSync(join(DIR, 'previews', `sts-malaccamax-${view}.webp`)), view).toBe(true)
    }
  })

  it('carries the TTI ALGECIRAS livery as text, ZPMC plates and crane-number plates', () => {
    expect(meta.branding.wordmark).toBe('ZPMC')
    expect(meta.branding.livery).toBe('TTI ALGECIRAS')
    expect(meta.branding.operatorBranding).toBe(true)
    expect(meta.branding.note).toMatch(/no logo artwork/)
    expect(meta.branding.craneNumbers.first).toBe(101)
    expect(meta.branding.craneNumbers.count).toBeGreaterThanOrEqual(24)
  })

  it('exposes the amber beacon mount points on the gantry, two per leg and two per portal beam', () => {
    const mounts = meta.beaconMounts as { name: string; node: string; position: number[]; lens: string }[]
    expect(mounts).toHaveLength(8)
    expect(new Set(mounts.map((b) => b.name)).size).toBe(8)
    for (const b of mounts) {
      expect(b.node).toBe('gantry')
      expect(b.lens).toBe('amber')
      expect(b.position).toHaveLength(3)
    }
    // Both rails (z = 0 and one gauge landward) and both sides of the crane centre line carry beacons.
    const zs = new Set(mounts.map((b) => b.position[2]))
    expect([...zs].sort((a, b) => a - b)).toEqual([0, meta.geometry.railGaugeM.value])
    expect(mounts.some((b) => b.position[0] < 0) && mounts.some((b) => b.position[0] > 0)).toBe(true)
    expect(Math.max(...mounts.map((b) => b.position[1]))).toBeGreaterThan(40) // the portal pair sits high
  })
})
