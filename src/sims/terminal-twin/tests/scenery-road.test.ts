/**
 * Ticket #172: the Isla Verde scenery road stops at the land edge north of the TTI terminal. North of the North Quay a
 * sea channel lies between the terminal and the land beyond, so no part of the road (stand-in or GLB) may stand over it.
 * The road still reaches the engine's access road junction and runs inland from there to the south end.
 */
import { join } from 'node:path'
import { NodeIO, type Node as GltfNode } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { MODELS_DIR } from '../cli/assets/budgetCheck'
import { buildLandsideGraph } from '../engine'
import { buildBackdrop, sceneryFor } from '../modules/backdrop'
import { clipMeshToHalfSpace, type HullMeshData } from '../modules/meshClip'
import type { InfraAssets } from '../modules/infrastructureAssets'
import { presets } from '../scenario/presets'
import { TTI_GROUND, TTI_PRESET_NAME, TTI_ROAD_NORTH_END_X } from '../terminals/tti-algeciras/constants'

/** Every triangle corner of a mesh's positions, as a flat array (non-indexed or indexed). */
function xsOf(mesh: HullMeshData): number[] {
  const pos = mesh.attributes.position.array
  const n = mesh.index ? mesh.index.length : pos.length / 3
  return Array.from({ length: n }, (_, k) => pos[(mesh.index ? mesh.index[k] : k) * 3])
}

describe('clipMeshToHalfSpace', () => {
  const tri = (): HullMeshData => ({
    index: null,
    attributes: {
      position: { array: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]), itemSize: 3 },
      uv: { array: Float32Array.from([0, 0, 1, 0, 0, 1]), itemSize: 2 },
    },
  })

  it('keeps a triangle wholly on the kept side unchanged', () => {
    const mesh: HullMeshData = { index: null, attributes: { position: { array: Float32Array.from([6, 0, 0, 10, 0, 0, 6, 4, 0]), itemSize: 3 } } }
    const out = clipMeshToHalfSpace(mesh, 0, 5)
    expect(Array.from(out.position)).toEqual([6, 0, 0, 10, 0, 0, 6, 4, 0])
  })

  it('drops a triangle wholly beyond the line', () => {
    const out = clipMeshToHalfSpace(tri(), 0, 11)
    expect(out.position.length).toBe(0)
  })

  it('cuts a straddling triangle at the line and interpolates its other attributes', () => {
    const out = clipMeshToHalfSpace(tri(), 0, 5)
    // the corners at x = 0 go, the cut points lie on the line x = 5: one triangle (5,0), (10,0), (5,5)
    expect(out.position.length).toBe(9)
    const xs = Array.from(out.position).filter((_, i) => i % 3 === 0)
    expect(Math.min(...xs)).toBeCloseTo(5, 6)
    expect(Array.from(out.position)).toEqual(expect.arrayContaining([5, 0, 0, 5, 5, 0]))
    // uv interpolated where the edge is cut: half way along (0,0)-(1,0) and (1,0)-(0,1)
    expect(Array.from(out.uv)).toEqual(expect.arrayContaining([0.5, 0, 0.5, 0.5]))
  })

  it('reads an indexed mesh and writes a non-indexed one', () => {
    const indexed: HullMeshData = {
      index: [0, 1, 2],
      attributes: { position: { array: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]), itemSize: 3 } },
    }
    const out = clipMeshToHalfSpace(indexed, 0, 5)
    expect(out.position.length % 9).toBe(0)
    expect(Math.min(...Array.from(out.position).filter((_, i) => i % 3 === 0))).toBeCloseTo(5, 6)
  })
})

describe('TTI scenery road and the north land edge', () => {
  const config = presets[TTI_PRESET_NAME]()
  const graph = buildLandsideGraph(config)
  const midX = config.quay.lengthM / 2

  it('ends at the terminal north land edge, the North Quay face, with the sea channel beyond it', () => {
    expect(TTI_ROAD_NORTH_END_X).toBe(-TTI_GROUND.northQuayEdgeM)
    // the engine's access road junction (the terminal road's start) and everything south of it stay on the road
    expect(graph.nodes['ls:AJ'].x).toBeGreaterThan(TTI_ROAD_NORTH_END_X)
  })

  it('stand-in: the road spans from the land edge to the south end, never north of it', () => {
    const b = buildBackdrop(sceneryFor(TTI_PRESET_NAME), config.quay.lengthM)
    const road = b.group.getObjectByName('landside') as THREE.Mesh
    const box = road.geometry.boundingBox ?? (road.geometry.computeBoundingBox(), road.geometry.boundingBox!)
    const world = box.clone().translate(road.position)
    expect(world.min.x).toBeGreaterThanOrEqual(TTI_ROAD_NORTH_END_X - 1e-6)
    expect(world.min.x).toBeLessThan(TTI_ROAD_NORTH_END_X + 5)
    // runs inland from the junction to the south end of the stand-in (the access road starts 950 m south)
    expect(world.max.x).toBeGreaterThan(graph.nodes['ls:AS'].x)
    b.dispose()
  })

  describe('scenery-landside GLB', () => {
    beforeAll(async () => {
      await MeshoptDecoder.ready
    })

    /** The LOD0 positions of the scenery GLB, node transforms applied (scale and translation only, as the hull test does). */
    async function landsideLod0(): Promise<HullMeshData> {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      const doc = await io.read(join(MODELS_DIR, 'infrastructure', 'scenery-landside.glb'))
      const nodes = doc.getRoot().listNodes()
      const parent = new Map<GltfNode, GltfNode>()
      for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n)
      const frame = (nd: GltfNode) => {
        const chain: GltfNode[] = []
        for (let c: GltfNode | undefined = nd; c; c = parent.get(c)) chain.unshift(c)
        let s = [1, 1, 1]
        let t = [0, 0, 0]
        for (const c of chain) {
          t = t.map((v, i) => v + s[i] * c.getTranslation()[i])
          s = s.map((v, i) => v * c.getScale()[i])
        }
        return { s, t }
      }
      const out: number[] = []
      const walk = (nd: GltfNode) => {
        const mesh = nd.getMesh()
        if (mesh) {
          const { s, t } = frame(nd)
          for (const prim of mesh.listPrimitives()) {
            const acc = prim.getAttribute('POSITION')!
            const pos = acc.getArray()!
            const unit = acc.getNormalized() ? ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[acc.getComponentType()] : 1
            const idx = prim.getIndices()?.getArray() ?? null
            const count = idx ? idx.length : pos.length / 3
            for (let k = 0; k < count; k++) {
              const v = idx ? idx[k] : k
              for (let c = 0; c < 3; c++) out.push((pos[v * 3 + c] / unit) * s[c] + t[c])
            }
          }
        }
        for (const c of nd.listChildren()) walk(c)
      }
      const lod0 = nodes.find((n) => n.getName() === 'LOD0')
      if (!lod0) throw new Error('scenery-landside has no LOD0 node')
      walk(lod0)
      return { index: null, attributes: { position: { array: Float32Array.from(out), itemSize: 3 } } }
    }

    it('as authored, runs over the sea channel (the case this ticket fixes)', async () => {
      const lod = await landsideLod0()
      const worldMin = Math.min(...xsOf(lod)) + midX
      expect(worldMin).toBeLessThan(TTI_ROAD_NORTH_END_X)
    })

    it('once the terminal scenery loads it, no part of the road lies north of the land edge', async () => {
      const lod = await landsideLod0()
      const b = buildBackdrop(sceneryFor(TTI_PRESET_NAME), config.quay.lengthM)
      const road = b.group.getObjectByName('landside') as THREE.Mesh
      const material = new THREE.MeshLambertMaterial()
      const assets = {
        material,
        geometries: { 'scenery-landside': new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lod.attributes.position.array as Float32Array, 3)) },
      } as unknown as InfraAssets
      b.useModels(assets)
      expect(b.models).toBe('glb')
      expect(road.material).toBe(material)
      road.geometry.computeBoundingBox()
      const world = road.geometry.boundingBox!.clone().translate(road.position)
      expect(world.min.x).toBeGreaterThanOrEqual(TTI_ROAD_NORTH_END_X - 1e-3)
      // the road still runs inland from the junction to the south end of the GLB
      expect(world.max.x).toBeGreaterThan(graph.nodes['ls:AS'].x)
      expect(road.geometry.attributes.position.count).toBeGreaterThan(100)
      b.dispose()
    })
  })
})
