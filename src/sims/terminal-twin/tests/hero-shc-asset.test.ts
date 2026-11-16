/**
 * Seam 4, the hero SHC body (#275): `hero-equipment/hero-shc.glb`, `shc.glb` LOD0 without the spreader subtree. Reads
 * only the committed GLBs, sidecar and budgets (no Blender). The source of truth for names, pivots and size is
 * `shc.glb` LOD0: the hero body replaces it and the rig drives same-named nodes, so a node missing or moved here would
 * silently freeze that part.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getBounds, NodeIO, type Document, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkAssetLibrary, loadBudgets, MODELS_DIR } from '../cli/assets/budgetCheck'

const DIR = join(MODELS_DIR, 'hero-equipment')
/** Rig nodes `ShcRig` drives (the `_geo` children are meshes, not rig nodes). */
const RIG_NAME = /^(steer_|wheel_|twistlock_)(fl|fr|rl|rr)$|^(hoist|spreader)$/
const LEFT_OUT = /^(spreader|twistlock_\w+)/

let io: NodeIO
let source: Node
let hero: Node

const child = (node: Node, name: string): Node | undefined => node.listChildren().find((c) => c.getName() === name)

async function lod0(file: string, rootName: string): Promise<Node> {
  const doc: Document = await io.read(join(MODELS_DIR, file))
  const root = doc.getRoot().listScenes()[0].listChildren()[0]
  expect(root.getName()).toBe(rootName)
  const lod = child(root, 'LOD0')
  expect(lod, `${file} LOD0`).toBeDefined()
  return lod!
}

/** Rig nodes below `lod` by name, with their world pivot and world rotation, skipping the spreader subtree. */
function rig(lod: Node) {
  const out = new Map<string, { t: number[]; r: number[] }>()
  const walk = (n: Node) => {
    if (LEFT_OUT.test(n.getName())) return
    if (RIG_NAME.test(n.getName())) out.set(n.getName(), { t: n.getWorldTranslation(), r: n.getWorldRotation() })
    n.listChildren().forEach(walk)
  }
  lod.listChildren().forEach(walk)
  return out
}

/** World bounds of every mesh below `lod` outside the spreader subtree. */
function bounds(lod: Node) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const walk = (n: Node) => {
    if (LEFT_OUT.test(n.getName())) return
    if (n.getMesh()) {
      const b = getBounds(n)
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], b.min[i])
        max[i] = Math.max(max[i], b.max[i])
      }
    }
    n.listChildren().forEach(walk)
  }
  lod.listChildren().forEach(walk)
  return { min, max }
}

beforeAll(async () => {
  await MeshoptDecoder.ready
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  source = await lod0('shc/shc.glb', 'shc')
  hero = await lod0('hero-equipment/hero-shc.glb', 'hero-shc')
})

describe('hero SHC body', () => {
  it('has a GLB, a sidecar and a preview, and the sidecar names the source and what was left out', () => {
    for (const f of ['hero-shc.glb', 'hero-shc.meta.json', join('previews', 'hero-shc-view.webp')]) {
      expect(existsSync(join(DIR, f)), f).toBe(true)
    }
    const meta = JSON.parse(readFileSync(join(DIR, 'hero-shc.meta.json'), 'utf8'))
    expect(meta.kind).toBe('hero-shc')
    expect(meta.heroEquipment.sourceAsset).toBe('shc')
    expect(meta.heroEquipment.leftOut).toEqual(['spreader', 'twistlock_fl', 'twistlock_fr', 'twistlock_rl', 'twistlock_rr'])
  })

  it('passes the budget check as the hero-shc kind, inside 30 000 triangles, 12 draw calls and 1.2 MB, with more detail than shc.glb LOD0', () => {
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const budget = loadBudgets().kinds['hero-shc']
    expect(budget.lods.LOD0).toEqual({ maxTriangles: 30000, maxDrawCalls: 12 })
    expect(budget.maxFileBytes).toBe(1200000)
    const a = report.assets.find((x) => x.name === 'hero-shc')!
    expect(a.kind).toBe('hero-shc')
    expect(a.problems).toEqual([])
    expect(a.lods.LOD0.triangles).toBeLessThanOrEqual(30000)
    expect(a.lods.LOD0.drawCalls).toBeLessThanOrEqual(12)
    expect(a.bytes).toBeLessThanOrEqual(1200000)
    const plain = report.assets.find((x) => x.name === 'shc')!.lods.LOD0.triangles
    expect(a.lods.LOD0.triangles).toBeGreaterThan(plain * 1.5)
  })

  it('has every non-spreader rig node of shc.glb LOD0 with the same world pivot (1 mm) and rotation, each an empty with a `_geo` mesh', () => {
    const want = rig(source)
    const got = rig(hero)
    expect(want.size).toBe(9) // 4 steer, 4 wheel, hoist
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort())
    for (const [name, w] of want) {
      const g = got.get(name)!
      g.t.forEach((c, i) => expect(Math.abs(c - w.t[i]), `${name} pivot axis ${i}`).toBeLessThanOrEqual(0.001))
      g.r.forEach((c, i) => expect(c, `${name} rotation ${i}`).toBeCloseTo(w.r[i], 5))
    }
    hero.traverse((n) => {
      if (!RIG_NAME.test(n.getName())) return
      expect(n.getMesh(), `${n.getName()} is an empty`).toBeNull()
      expect(child(n, `${n.getName()}_geo`)?.getMesh(), `${n.getName()}_geo`).toBeTruthy()
    })
  })

  it('has no spreader or twist-lock node (the #273 hero spreader stays under LOD0)', () => {
    const names: string[] = []
    hero.traverse((n) => void names.push(n.getName()))
    expect(names.filter((n) => LEFT_OUT.test(n))).toEqual([])
    expect(child(hero, 'frame')?.getMesh()).toBeTruthy()
    expect(child(hero, 'plates')?.getMesh()).toBeTruthy()
  })

  it('keeps the fleet-number plate material that the renderer finds by name (shc_plate)', () => {
    const plates = child(hero, 'plates')!.getMesh()!
    expect(plates.listPrimitives().map((p) => p.getMaterial()?.getName())).toEqual(['shc_plate'])
  })

  it('has the overall dimensions of shc.glb LOD0 without the spreader within 1 cm', () => {
    const want = bounds(source)
    const got = bounds(hero)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(got.min[i] - want.min[i]), `min axis ${i}: ${got.min[i]} vs ${want.min[i]}`).toBeLessThanOrEqual(0.01)
      expect(Math.abs(got.max[i] - want.max[i]), `max axis ${i}: ${got.max[i]} vs ${want.max[i]}`).toBeLessThanOrEqual(0.01)
    }
  })
})
