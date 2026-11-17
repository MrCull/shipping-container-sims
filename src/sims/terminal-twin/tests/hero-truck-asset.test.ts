/**
 * Seam 4, the hero truck (#276): `hero-equipment/hero-truck-chassis.glb` (truck-chassis.glb LOD0 in detail) and
 * `hero-truck-cab-{high,mid,day}.glb` (the `fifth_wheel` subtree of truck-cab-<shape>.glb LOD0 in detail). Reads only the
 * committed GLBs, sidecars and budgets (no Blender). The source of truth for names, pivots, attach points and size is the
 * truck GLBs' LOD0: the hero pieces replace it and `TruckRig` drives same-named nodes, so a node missing or moved here
 * would freeze a wheel, and a moved attach point would float the box.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getBounds, NodeIO, type Document, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkAssetLibrary, loadBudgets, MODELS_DIR } from '../cli/assets/budgetCheck'

const DIR = join(MODELS_DIR, 'hero-equipment')
const SHAPES = ['high', 'mid', 'day'] as const
/** Rig nodes `TruckRig` drives (the `_geo` children are meshes, not rig nodes). */
const RIG_NAME = /^(fifth_wheel|steer_(fl|fr)|wheel_(fl|fr|r|t1|t2|t3))$/

interface Piece {
  name: string
  kind: 'hero-truck-chassis' | 'hero-truck-cab'
  sourceFile: string
  sourceRoot: string
  /** The source subtree this piece replaces: the whole LOD0 (chassis, minus the tractor) or LOD0's fifth_wheel. */
  sourcePart: (lod: Node) => Node[]
  rig: string[]
  livery: string
}

const child = (node: Node, name: string): Node | undefined => node.listChildren().find((c) => c.getName() === name)
const PIECES: Piece[] = [
  {
    name: 'hero-truck-chassis',
    kind: 'hero-truck-chassis',
    sourceFile: 'trucks/truck-chassis.glb',
    sourceRoot: 'truck-chassis',
    sourcePart: (lod) => lod.listChildren(),
    rig: ['wheel_t1', 'wheel_t2', 'wheel_t3'],
    livery: 'chassis',
  },
  ...SHAPES.map(
    (s): Piece => ({
      name: `hero-truck-cab-${s}`,
      kind: 'hero-truck-cab',
      sourceFile: `trucks/truck-cab-${s}.glb`,
      sourceRoot: `truck-cab-${s}`,
      sourcePart: (lod) => [child(lod, 'fifth_wheel')!],
      rig: ['fifth_wheel', 'steer_fl', 'steer_fr', 'wheel_fl', 'wheel_fr', 'wheel_r'],
      livery: 'tractor',
    }),
  ),
]

let io: NodeIO
const loaded = new Map<string, { source: Node[]; hero: Node }>()

async function lod0(file: string, rootName: string): Promise<Node> {
  const doc: Document = await io.read(join(MODELS_DIR, file))
  const root = doc.getRoot().listScenes()[0].listChildren()[0]
  expect(root.getName()).toBe(rootName)
  const lod = child(root, 'LOD0')
  expect(lod, `${file} LOD0`).toBeDefined()
  return lod!
}

function walk(nodes: Node[], visit: (n: Node) => void) {
  const go = (n: Node) => {
    visit(n)
    n.listChildren().forEach(go)
  }
  nodes.forEach(go)
}

function rig(nodes: Node[]) {
  const out = new Map<string, { t: number[]; r: number[] }>()
  walk(nodes, (n) => {
    if (RIG_NAME.test(n.getName())) out.set(n.getName(), { t: n.getWorldTranslation(), r: n.getWorldRotation() })
  })
  return out
}

function bounds(nodes: Node[]) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  walk(nodes, (n) => {
    if (!n.getMesh()) return
    const b = getBounds(n)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i])
      max[i] = Math.max(max[i], b.max[i])
    }
  })
  return { min, max }
}

const meta = (file: string): Record<string, any> => JSON.parse(readFileSync(join(MODELS_DIR, file), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  await MeshoptDecoder.ready
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  for (const p of PIECES) {
    const source = p.sourcePart(await lod0(p.sourceFile, p.sourceRoot)).filter((n) => p.kind === 'hero-truck-cab' || n.getName() !== 'fifth_wheel')
    loaded.set(p.name, { source, hero: await lod0(`hero-equipment/${p.name}.glb`, p.name) })
  }
})

describe.each(PIECES)('hero truck piece $name', (p) => {
  it('has a GLB, a sidecar and a preview, and the sidecar names its kind and source', () => {
    for (const f of [`${p.name}.glb`, `${p.name}.meta.json`, join('previews', `${p.name}-view.webp`)]) expect(existsSync(join(DIR, f)), f).toBe(true)
    const m = meta(`hero-equipment/${p.name}.meta.json`)
    expect(m.kind).toBe(p.kind)
    expect(m.heroEquipment.sourceAsset).toBe(p.sourceRoot)
  })

  it('passes the budget check inside its kind budget (chassis 10 000 triangles and 6 draw calls, cab 15 000 and 8, 800 kB), with more detail than the source', () => {
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const budget = loadBudgets().kinds[p.kind]
    expect(budget.lods.LOD0).toEqual(p.kind === 'hero-truck-chassis' ? { maxTriangles: 10000, maxDrawCalls: 6 } : { maxTriangles: 15000, maxDrawCalls: 8 })
    expect(budget.maxFileBytes).toBe(800000)
    expect(budget.requiredNodes).toEqual(expect.arrayContaining(p.rig))
    const a = report.assets.find((x) => x.name === p.name)!
    expect(a.kind).toBe(p.kind)
    expect(a.problems).toEqual([])
    expect(a.bytes).toBeLessThanOrEqual(800000)
    const plain = report.assets.find((x) => x.name === 'truck-chassis')!.lods.LOD0.triangles
    expect(a.lods.LOD0.triangles).toBeGreaterThan(plain * 1.5)
  })

  it('has every rig node of the source LOD0 part with the same world pivot (1 mm) and rotation; moving nodes are empties with a `_geo` mesh', () => {
    const { source, hero } = loaded.get(p.name)!
    const want = rig(source)
    const got = rig([hero])
    expect([...want.keys()].sort()).toEqual([...p.rig].sort())
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort())
    // Pivots from the source sidecar: in the source GLB a wheel is a mesh node, and mesh quantization moves its origin
    // along the axle (wheel_fl sits 4 cm outboard), which leaves the rotation axis but not the node position unchanged.
    const pivots = new Map<string, number[]>(meta(p.sourceFile.replace('.glb', '.meta.json')).nodes.filter((n: { pivot?: number[] }) => n.pivot).map((n: { name: string; pivot: number[] }) => [n.name, n.pivot]))
    for (const [name, w] of want) {
      const g = got.get(name)!
      const pivot = pivots.get(name)!
      expect(pivot, `${name} pivot in the source sidecar`).toBeDefined()
      g.t.forEach((c, i) => expect(Math.abs(c - pivot[i]), `${name} pivot axis ${i}`).toBeLessThanOrEqual(0.001))
      // on the rotation axis line of the source node: wheels roll about +Z, so x and y match the source GLB node too
      if (name.startsWith('wheel_')) for (const i of [0, 1]) expect(Math.abs(g.t[i] - w.t[i]), `${name} axle axis ${i}`).toBeLessThanOrEqual(0.001)
      g.r.forEach((c, i) => expect(c, `${name} rotation ${i}`).toBeCloseTo(w.r[i], 5))
    }
    hero.traverse((n) => {
      if (!/^wheel_/.test(n.getName()) || n.getName().endsWith('_geo')) return
      expect(n.getMesh(), `${n.getName()} is an empty`).toBeNull()
      expect(child(n, `${n.getName()}_geo`)?.getMesh(), `${n.getName()}_geo`).toBeTruthy()
    })
  })

  it('keeps the load_* attach points and load configurations of the source within 1 mm', () => {
    const src = meta(p.sourceFile.replace('.glb', '.meta.json'))
    const m = meta(`hero-equipment/${p.name}.meta.json`)
    const loads = (x: Record<string, any>): { name: string; position: number[] }[] => x.attachPoints.filter((a: { name: string }) => a.name.startsWith('load_')) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(loads(m).map((a) => a.name)).toEqual(loads(src).map((a) => a.name))
    expect(loads(src)).toHaveLength(5)
    loads(src).forEach((a, i) => a.position.forEach((c, k) => expect(Math.abs(loads(m)[i].position[k] - c), `${a.name} ${k}`).toBeLessThanOrEqual(0.001)))
    expect(m.loadConfigurations).toEqual(src.loadConfigurations)
  })

  it('has the overall dimensions of the source part within 1 cm', () => {
    const { source, hero } = loaded.get(p.name)!
    const want = bounds(source)
    const got = bounds([hero])
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(got.min[i] - want.min[i]), `min axis ${i}: ${got.min[i]} vs ${want.min[i]}`).toBeLessThanOrEqual(0.01)
      expect(Math.abs(got.max[i] - want.max[i]), `max axis ${i}: ${got.max[i]} vs ${want.max[i]}`).toBeLessThanOrEqual(0.01)
    }
  })

  it('carries the livery material (truck_atlas, UVs on atlas tile 0) on the mesh the sidecar names, like the source', () => {
    const { hero } = loaded.get(p.name)!
    const m = meta(`hero-equipment/${p.name}.meta.json`)
    expect(m.livery).toMatchObject({ material: 'truck_atlas', mesh: p.livery, tile: 0 })
    const mesh = child(p.kind === 'hero-truck-cab' ? child(hero, 'fifth_wheel')! : hero, p.livery)!.getMesh()!
    for (const prim of mesh.listPrimitives()) {
      expect(prim.getMaterial()?.getName()).toBe('truck_atlas')
      expect(prim.getMaterial()?.getBaseColorTexture()).toBeTruthy()
      const uv = prim.getAttribute('TEXCOORD_0')!
      const lo = [Infinity, Infinity]
      const hi = [-Infinity, -Infinity]
      for (let k = 0, e: number[] = []; k < uv.getCount(); k++) {
        uv.getElement(k, e) // decodes the quantized (normalized) UVs
        for (const i of [0, 1]) [lo[i], hi[i]] = [Math.min(lo[i], e[i]), Math.max(hi[i], e[i])]
      }
      // tile 0 of the 4 x 2 atlas: u in [0, 1/4], v (glTF, top-left origin) in [0, 1/2]
      expect(lo[0]).toBeGreaterThanOrEqual(-1e-3)
      expect(hi[0]).toBeLessThanOrEqual(0.25 + 1e-3) // quantization rounding at the tile edge
      expect(lo[1]).toBeGreaterThanOrEqual(-1e-3)
      expect(hi[1]).toBeLessThanOrEqual(0.5 + 1e-3)
    }
    const names = new Set<string>()
    hero.traverse((n) => n.getMesh()?.listPrimitives().forEach((pr) => names.add(pr.getMaterial()?.getName() ?? '')))
    expect([...names]).toEqual(['truck_atlas'])
  })
})

describe('hero truck livery by material name (#276)', () => {
  // TruckRig's livery material is a clone of the truck-cab-<shape>.glb material and keeps its name; the hero meshes
  // adopt it by that name (`HeroMount.materials`). A rename on either side would leave the hero truck on tile 0 silently.
  it.each(SHAPES)('every material of trucks/truck-cab-%s.glb (the rig material TruckRig clones) is named truck_atlas, as the hero files are', async (shape) => {
    const doc = await io.read(join(MODELS_DIR, `trucks/truck-cab-${shape}.glb`))
    expect(doc.getRoot().listMaterials().map((m) => m.getName())).toEqual(['truck_atlas'])
    expect(meta(`hero-equipment/hero-truck-cab-${shape}.meta.json`).livery.material).toBe('truck_atlas')
  })
})
