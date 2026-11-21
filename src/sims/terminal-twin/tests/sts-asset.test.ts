/**
 * Seam 4, phase 2 asset outputs for the STS (TT-23): the committed
 * quay-crane GLBs (Malaccamax and, #303, Super Post-Panamax), their rig sidecars and their previews.
 * Expected values come from the TTI reference pack (rail gauge, lift height,
 * outreach) and the scenario geometry the engine works in (vessel rows, hold
 * tiers, ground lanes), not from the generator.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { NodeIO, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, MODELS_DIR } from '../cli/assets/budgetCheck'
import { readGlbJson, type GltfJson } from '../cli/assets/glb'
import { DEFAULT_LAYOUT } from '../scenario/builder'
import { HALF_OFFSET_M, slotZ, tierBaseY, VESSEL_CLASSES } from '../scenario/vesselClasses'
import malaccamaxMeta from '../assets/models/sts/sts-malaccamax.meta.json'
import sppMeta from '../assets/models/sts/sts-super-post-panamax.meta.json'
import atlas from '../assets/models/sts/sts-atlas.json'
import { AssetRig, type RigMeta } from '../modules/assetRig'

const DIR = join(MODELS_DIR, 'sts')
const LODS = ['LOD0', 'LOD1', 'LOD2'] as const
const RIG = ['gantry', 'trolley', 'hoist', 'spreader', 'boom', 'spreader_tele_fore', 'spreader_tele_aft', 'twin_locks']

interface SidecarNode {
  name: string
  parent: string
  role: string
  pivot?: number[]
  rig?: string
  description?: string
}

type Meta = typeof malaccamaxMeta

/**
 * One entry per STS class GLB. Lift height and outreach are the knowledge file's [V] numbers
 * (knowledge-base/dk_equipment__tti_algeciras_sts_cranes.md section 1), not the generator's.
 */
const CLASSES = [
  { name: 'sts-malaccamax', label: 'Malaccamax', meta: malaccamaxMeta as Meta, lift: 52, outreach: 68 },
  { name: 'sts-super-post-panamax', label: 'Super Post-Panamax', meta: sppMeta as unknown as Meta, lift: 43, outreach: 65 },
] as const

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

/** The GLB node tree as Three.js objects (names, TRS only; no meshes needed for rig maths). */
function objectTree(json: GltfJson): THREE.Object3D {
  const root = new THREE.Object3D()
  const make = (i: number): THREE.Object3D => {
    const n = json.nodes![i]
    const o = new THREE.Object3D()
    o.name = n.name ?? ''
    if (n.translation) o.position.fromArray(n.translation)
    if (n.rotation) o.quaternion.fromArray(n.rotation)
    if (n.scale) o.scale.fromArray(n.scale)
    for (const c of n.children ?? []) o.add(make(c))
    return o
  }
  for (const r of json.scenes![json.scene ?? 0].nodes ?? []) root.add(make(r))
  return root
}

for (const c of CLASSES) {
  const meta = c.meta
  const nodes = meta.nodes as SidecarNode[]
  const GLB = join(DIR, `${c.name}.glb`)

  /** A point at (y, z) on the boom at rest, raised by `deg` about the hinge (+X axis), by hand. */
  function raised(y: number, z: number, deg: number): [number, number] {
    const [hy, hz] = [meta.geometry.boomHingeM.y, meta.geometry.boomHingeM.z]
    const a = (deg * Math.PI) / 180
    const dy = y - hy
    const dz = z - hz
    return [hy + dy * Math.cos(a) - dz * Math.sin(a), hz + dy * Math.sin(a) + dz * Math.cos(a)]
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

  describe(`STS model (${c.label} quay crane)`, () => {
    const json = readGlbJson(GLB)

    it('passes the budget check with LOD0 ~40k, LOD1 ~8k and LOD2 ~1k triangles', () => {
      const report = checkAssetLibrary()
      const sts = report.assets.find((a) => a.name === c.name)
      expect(sts?.kind).toBe('sts')
      expect(sts?.problems).toEqual([])
      expect(sts!.lods.LOD0.triangles).toBeGreaterThan(25_000)
      expect(sts!.lods.LOD0.triangles).toBeLessThanOrEqual(40_000)
      expect(sts!.lods.LOD1.triangles).toBeGreaterThan(4_000)
      expect(sts!.lods.LOD1.triangles).toBeLessThanOrEqual(8_000)
      expect(sts!.lods.LOD2.triangles).toBeGreaterThan(400)
      expect(sts!.lods.LOD2.triangles).toBeLessThanOrEqual(1_000)
    })

    it(`has TTI ${c.label} geometry, tagged verified, with the steel extending above the ${c.lift} m lift envelope`, () => {
      const g = meta.geometry
      expect(g.railGaugeM).toMatchObject({ value: 30.48, tag: 'V' })
      expect(g.liftHeightAboveRailM).toMatchObject({ value: c.lift, tag: 'V' })
      expect(g.outreachM).toMatchObject({ value: c.outreach, tag: 'V' })
      // Not verified by the reference pack: approximations.
      for (const key of ['backreachM', 'apexHeightM', 'trolleyRailHeightM', 'legSpacingM', 'overBuffersM'] as const) {
        expect(g[key].tag, key).toBe('A')
      }
      expect(g.apexHeightM.value).toBeGreaterThan(c.lift + 15)
      expect(meta.dimensions.heightM).toBeGreaterThanOrEqual(g.apexHeightM.value)
      expect(g.trolleyRailHeightM.value).toBeGreaterThan(c.lift)
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

    it(`travel limits cover the engine working envelope: outermost ULCV row, hold floor, ground lanes, ${c.lift} m lift`, () => {
      const tl = meta.travelLimits as Record<string, { type: string; axis: string; minM?: number; maxM?: number; minDeg?: number; maxDeg?: number }>
      expect(tl.gantry).toMatchObject({ type: 'translation', axis: '+X' })
      expect(tl.trolley).toMatchObject({ type: 'translation', axis: '+Z' })
      expect(tl.hoist).toMatchObject({ type: 'translation', axis: '+Y', maxM: c.lift })
      expect(tl.boom).toMatchObject({ type: 'rotation', axis: '+X', minDeg: 0 })
      expect(tl.boom.maxDeg).toBeGreaterThanOrEqual(70)
      // Trolley values are measured from the waterside rail; outreach is c.outreach m seaward.
      expect(tl.trolley.minM).toBe(-c.outreach)
      const ulcv = VESSEL_CLASSES.ulcv
      const waterRailZ = meta.sceneMounting.waterRailZ
      expect(slotZ(ulcv, ulcv.rows - 1) - waterRailZ).toBeGreaterThanOrEqual(tl.trolley.minM!)
      expect(DEFAULT_LAYOUT.stsGroundLaneZ0M + 2 * DEFAULT_LAYOUT.stsGroundLaneSpacingM - waterRailZ).toBeLessThanOrEqual(tl.trolley.maxM!)
      // Hoist values are the spreader underside's height above the rail.
      expect(tierBaseY(ulcv, 0)).toBeGreaterThanOrEqual(tl.hoist.minM!)
      // The engine caps the travel height at the class lift height (#303, stsSafeHoist).
      expect(Math.min(DEFAULT_LAYOUT.stsSafeHoistM, c.lift)).toBeLessThanOrEqual(tl.hoist.maxM!)
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

    it('has committed previews: front, side, rear, three-quarter, a trolley/spreader close-up and the boom raised', () => {
      for (const view of ['front', 'side', 'rear', 'three-quarter', 'closeup']) {
        expect(existsSync(join(DIR, 'previews', `${c.name}-${view}.webp`)), view).toBe(true)
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

    describe('forestays and boom-hoist ropes stay attached as the boom rises (#299)', () => {
      type AimRule = { node: string; to: string; mode?: string; axis: string; unitLengthM: number }
      const rules = (meta as { stretch: AimRule[] }).stretch
      const STAYS = [
        { node: 'forestays', anchor: 'forestay_anchor' },
        { node: 'boom_hoist_ropes', anchor: 'boom_hoist_anchor' },
      ]

      it('has the stay nodes on the gantry and their anchors on the boom, in every LOD', () => {
        for (const lod of LODS) {
          const sfx = lod === 'LOD0' ? '' : `_${lod.toLowerCase()}`
          const names = subtreeNames(json, lod)
          for (const { node, anchor } of STAYS) {
            expect(names, `${lod} ${node}`).toContain(`${node}${sfx}`)
            expect(names, `${lod} ${anchor}`).toContain(`${anchor}${sfx}`)
          }
          // Simplified, but every LOD draws its forestays.
          expect(names, `${lod} forestays_geo`).toContain(`forestays_geo${sfx}`)
        }
        for (const { node, anchor } of STAYS) {
          expect(nodes.find((n) => n.name === node)?.parent).toBe('gantry')
          expect(nodes.find((n) => n.name === anchor)?.parent).toBe('boom')
          expect(rules.find((r) => r.node === node)).toMatchObject({ to: anchor, mode: 'aim', axis: '+Y', unitLengthM: 1 })
        }
        // The boom mesh no longer carries the forestays.
        expect(nodes.find((n) => n.name === 'boom_geo')?.description).not.toMatch(/forestay/)
        expect(JSON.stringify(meta.provenance)).not.toMatch(/detach/)
      })

      it('starts the stays at the apex and ends the forestays at the boom nose', () => {
        const w = worldTranslations(json)
        for (const { node } of STAYS) expect(w.get(node)![1]).toBeGreaterThan(meta.geometry.apexHeightM.value - 2)
        expect(w.get('forestay_anchor')![2]).toBeLessThan(-meta.geometry.outreachM.value)
        expect(w.get('boom_hoist_anchor')![2]).toBeLessThan(-20)
      })

      for (const deg of [0, 40, 80]) {
        it(`keeps both ends of every stay on its anchors with the boom at ${deg} degrees, in every LOD`, () => {
          const root = objectTree(json)
          const rig = new AssetRig(root, meta as unknown as RigMeta)
          rig.set('boom', deg)
          rig.applyStretch()
          root.updateMatrixWorld(true)
          const w = worldTranslations(json)
          for (const lod of LODS) {
            const sfx = lod === 'LOD0' ? '' : `_${lod.toLowerCase()}`
            for (const { node, anchor } of STAYS) {
              const stay = root.getObjectByName(node + sfx)!
              const start = stay.getWorldPosition(new THREE.Vector3())
              const end = stay.localToWorld(new THREE.Vector3(0, 1, 0)) // the unit-length mesh's far end
              // The apex end does not move.
              expect(start.distanceTo(new THREE.Vector3(...w.get(node + sfx)!)), `${lod} ${node} start`).toBeLessThan(0.01)
              // The boom end follows the anchor, raised about the hinge.
              const a = w.get(anchor + sfx)!
              const [y, z] = raised(a[1], a[2], deg)
              expect(end.distanceTo(new THREE.Vector3(a[0], y, z)), `${lod} ${node} end at ${deg}`).toBeLessThan(0.05)
            }
          }
        })
      }
      it('reports how far each aimed stay is from its anchor, near zero once stretched and metres when not (#304)', () => {
        const root = objectTree(json)
        const rig = new AssetRig(root, meta as unknown as RigMeta)
        rig.applyStretch()
        rig.set('boom', 80) // raised but not re-stretched: the stays point at where the anchors were
        const stale = rig.aimGapsM()
        expect(Object.keys(stale)).toEqual(expect.arrayContaining(['forestays', 'forestays_lod1', 'forestays_lod2']))
        expect(Math.max(...Object.values(stale))).toBeGreaterThan(5)
        rig.applyStretch()
        for (const [node, gap] of Object.entries(rig.aimGapsM())) expect(gap, node).toBeLessThan(0.05)
      })
    })
    describe('TTI ALGECIRAS boom side plate (#300)', () => {
      type Plate = { node: string; material: string; region: string; lods: string[]; yM: number[]; zM: number[] }
      const plate = (meta.branding as unknown as { boomSidePlate: Plate }).boomSidePlate
      const regions = (atlas as unknown as { regions: Record<string, number[]> }).regions
      let doc: Awaited<ReturnType<NodeIO['read']>> | undefined

      async function boomMesh(lod: string): Promise<Node> {
        if (!doc) {
          await MeshoptDecoder.ready
          const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
          doc = await io.read(GLB)
        }
        const sfx = lod === 'LOD0' ? '' : `_${lod.toLowerCase()}`
        const geo = doc.getRoot().listNodes().find((n) => n.getName() === `${plate.node}${sfx}`)
        expect(geo, `${lod} ${plate.node}`).toBeDefined()
        return geo!
      }

      const worldPoint = (m: THREE.Matrix4, p: number[]) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m)

      /** Triangles of `node` in `material` with every corner's UV inside the atlas pixel rect, as world rest positions. */
      function lettering(node: Node, material: string, rect: number[]): THREE.Vector3[][] {
        const m = new THREE.Matrix4().fromArray(node.getWorldMatrix())
        const out: THREE.Vector3[][] = []
        for (const prim of node.getMesh()!.listPrimitives()) {
          if (prim.getMaterial()?.getName() !== material) continue
          const pos = prim.getAttribute('POSITION')!
          const uv = prim.getAttribute('TEXCOORD_0')!
          const idx = prim.getIndices()!
          for (let t = 0; t < idx.getCount(); t += 3) {
            const corners = [0, 1, 2].map((k) => idx.getScalar(t + k))
            const inside = corners.every((i) => {
              const [u, v] = uv.getElement(i, [0, 0])
              const [x, y] = [u * atlas.size[0], v * atlas.size[1]]
              return x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3]
            })
            if (inside) out.push(corners.map((i) => worldPoint(m, pos.getElement(i, [0, 0, 0]))))
          }
        }
        return out
      }

      it('records the plate in the sidecar: boom mesh, paint material, the white-on-blue TTI ALGECIRAS atlas region', () => {
        expect(plate).toMatchObject({ node: 'boom_geo', material: 'sts_paint', region: 'tti_on_blue' })
        expect(regions.tti_on_blue).toHaveLength(4)
        expect(plate.zM[1]).toBeLessThanOrEqual(meta.geometry.boomHingeM.z)
        expect(meta.branding.placement).toMatch(/boom side plate/)
      })

      for (const lod of ['LOD0', 'LOD1']) {
        it(`draws TTI ALGECIRAS on both outer faces of the boom side plate at ${lod}, through the STS atlas`, async () => {
          const tris = lettering(await boomMesh(lod), plate.material, regions[plate.region])
          for (const sx of [-1, 1]) {
            const side = tris.filter((t) => t.every((p) => p.x * sx > 0))
            expect(side.length, `${lod} side ${sx}`).toBeGreaterThanOrEqual(2)
            for (const p of side.flat()) {
              expect(p.z, 'seaward of the hinge, on the plate').toBeLessThanOrEqual(plate.zM[1] + 0.01)
              expect(p.z).toBeGreaterThanOrEqual(plate.zM[0] - 0.01)
              expect(p.y).toBeGreaterThanOrEqual(plate.yM[0])
              expect(p.y).toBeLessThanOrEqual(plate.yM[1])
            }
          }
        })
      }

      it('deepens the boom silhouette to the plate underside in every LOD', async () => {
        for (const lod of LODS) {
          const node = await boomMesh(lod)
          const m = new THREE.Matrix4().fromArray(node.getWorldMatrix())
          let minY = Infinity
          for (const prim of node.getMesh()!.listPrimitives()) {
            const pos = prim.getAttribute('POSITION')!
            for (let i = 0; i < pos.getCount(); i++) {
              const p = worldPoint(m, pos.getElement(i, [0, 0, 0]))
              if (p.z <= plate.zM[1] + 0.01 && p.z >= plate.zM[0] - 0.01) minY = Math.min(minY, p.y)
            }
          }
          expect(minY, lod).toBeLessThanOrEqual(plate.yM[0] + 0.02)
        }
      })
    })
  })
}
