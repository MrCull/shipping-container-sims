/**
 * Seam 4, the hero spreaders (#273): one GLB per source rig (STS, ASC, SHC). Reads only the committed GLBs, sidecars
 * and budgets (no Blender). The source of truth for names, pivots and size is the source rig's own committed GLB:
 * a hero spreader is added under that rig's `spreader` node with an identity transform, so it must fit that frame.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBounds, NodeIO, type Document, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkAssetLibrary, loadBudgets, MODELS_DIR } from '../cli/assets/budgetCheck'
import { QUALITY_LEVELS, QUALITY_PROFILES } from '../modules/quality'

const DIR = join(MODELS_DIR, 'hero-equipment')
const SOURCES = { sts: 'sts/sts-malaccamax.glb', asc: 'asc/asc.glb', shc: 'shc/shc.glb' } as const
type Kind = keyof typeof SOURCES
const KINDS = Object.keys(SOURCES) as Kind[]
/** Rig nodes the kind code animates below `spreader` (the `_geo` children are meshes, not rig nodes). */
const RIG_NAME = /^(?!.*_geo$)(twistlock_\w+|spreader_tele_(fore|aft)|twin_locks)$/

let io: NodeIO
const docs = new Map<string, Document>()

async function read(file: string): Promise<Document> {
  if (!docs.has(file)) docs.set(file, await io.read(join(MODELS_DIR, file)))
  return docs.get(file)!
}

const child = (node: Node, name: string): Node | undefined => node.listChildren().find((c) => c.getName() === name)

function find(node: Node, name: string): Node | undefined {
  if (node.getName() === name) return node
  for (const c of node.listChildren()) {
    const hit = find(c, name)
    if (hit) return hit
  }
  return undefined
}

/** The frame node (the rig's `spreader` in LOD0, or the hero file's `LOD0`), its rig nodes by name with their pivot in that frame, and its bounds in that frame. */
function describeFrame(frame: Node) {
  const origin = frame.getWorldTranslation()
  const rel = (p: number[]) => p.map((c, i) => c - origin[i])
  const pivots = new Map<string, number[]>()
  frame.traverse((n) => {
    if (n !== frame && RIG_NAME.test(n.getName())) pivots.set(n.getName(), rel(n.getWorldTranslation()))
  })
  const b = getBounds(frame)
  return { pivots, min: rel(b.min), max: rel(b.max) }
}

async function sourceFrame(kind: Kind) {
  const root = (await read(SOURCES[kind])).getRoot().listScenes()[0].listChildren()[0]
  return describeFrame(find(child(root, 'LOD0')!, 'spreader')!)
}

async function heroFrame(kind: Kind) {
  const root = (await read(`hero-equipment/hero-spreader-${kind}.glb`)).getRoot().listScenes()[0].listChildren()[0]
  expect(root.getName()).toBe(`hero-spreader-${kind}`)
  const lod0 = child(root, 'LOD0')
  expect(lod0, `${kind} LOD0`).toBeDefined()
  return { lod0: lod0!, ...describeFrame(lod0!) }
}

beforeAll(async () => {
  await MeshoptDecoder.ready
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
})

describe('hero spreaders', () => {
  it('has a GLB, a sidecar and a preview per source rig', () => {
    for (const kind of KINDS) {
      for (const f of [`hero-spreader-${kind}.glb`, `hero-spreader-${kind}.meta.json`, join('previews', `hero-spreader-${kind}-view.webp`)]) {
        expect(existsSync(join(DIR, f)), f).toBe(true)
      }
    }
  })

  it('passes the budget check as the hero-equipment kind, with far more detail than the plain spreader and inside the budget', () => {
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const budget = loadBudgets().kinds['hero-equipment']
    expect(budget.lods.LOD0.maxTriangles).toBe(8000)
    expect(budget.maxFileBytes).toBe(300000)
    for (const kind of KINDS) {
      const a = report.assets.find((x) => x.name === `hero-spreader-${kind}`)!
      expect(a.kind).toBe('hero-equipment')
      expect(a.problems).toEqual([])
      expect(a.lods.LOD0.triangles, kind).toBeGreaterThan(1500)
    }
  })

  it('budgets.json lists the three assets and a cap per quality level that the measured spreaders fit (heroEquipmentCaps)', () => {
    interface Cap {
      spreaders: number
      maxTriangles: number
      maxDrawCalls: number
    }
    const caps = (loadBudgets() as unknown as { heroEquipmentCaps: { assets: string[]; levels: Record<string, Cap> } }).heroEquipmentCaps
    const report = checkAssetLibrary()
    const inLibrary = report.assets.filter((a) => a.kind === 'hero-equipment').map((a) => a.name)
    expect([...caps.assets].sort()).toEqual(inLibrary.sort())
    expect([...caps.assets].sort()).toEqual(KINDS.map((k) => `hero-spreader-${k}`).sort())
    const lod0 = caps.assets.map((n) => report.assets.find((a) => a.name === n)!.lods.LOD0)
    const worstTriangles = Math.max(...lod0.map((l) => l.triangles))
    const worstDrawCalls = Math.max(...lod0.map((l) => l.drawCalls))
    expect(Object.keys(caps.levels).sort()).toEqual([...QUALITY_LEVELS].sort())
    for (const level of QUALITY_LEVELS) {
      const cap = caps.levels[level]
      expect(cap.spreaders, level).toBe(QUALITY_PROFILES[level].heroEquipment)
      expect(cap.spreaders * worstTriangles, level).toBeLessThanOrEqual(cap.maxTriangles)
      expect(cap.spreaders * worstDrawCalls, level).toBeLessThanOrEqual(cap.maxDrawCalls)
    }
  })

  it('decodes, and keeps every rig node of the source spreader at the same pivot, each an empty with a mesh child', async () => {
    for (const kind of KINDS) {
      const source = await sourceFrame(kind)
      const hero = await heroFrame(kind)
      expect(source.pivots.size, `${kind} source rig nodes`).toBeGreaterThanOrEqual(4)
      expect([...hero.pivots.keys()].sort(), kind).toEqual([...source.pivots.keys()].sort())
      for (const [name, pivot] of source.pivots) {
        hero.pivots.get(name)!.forEach((c, i) => expect(c, `${kind} ${name} axis ${i}`).toBeCloseTo(pivot[i], 3))
        const node = find(hero.lod0, name)!
        expect(node.getMesh(), `${kind} ${name} is an empty`).toBeNull()
        expect(child(node, `${name}_geo`)?.getMesh(), `${kind} ${name}_geo`).toBeTruthy()
      }
      expect(child(hero.lod0, 'spreader_geo')?.getMesh(), `${kind} spreader_geo`).toBeTruthy()
    }
  })

  it('has the dimensions of the source spreader within 1 cm, in the same frame', async () => {
    for (const kind of KINDS) {
      const source = await sourceFrame(kind)
      const hero = await heroFrame(kind)
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(hero.min[i] - source.min[i]), `${kind} min axis ${i}: ${hero.min[i]} vs ${source.min[i]}`).toBeLessThanOrEqual(0.01)
        expect(Math.abs(hero.max[i] - source.max[i]), `${kind} max axis ${i}: ${hero.max[i]} vs ${source.max[i]}`).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('documents the rig it replaces and its frame in the sidecar', () => {
    for (const kind of KINDS) {
      const meta = JSON.parse(readFileSync(join(DIR, `hero-spreader-${kind}.meta.json`), 'utf8'))
      expect(meta.heroEquipment.kind).toBe(kind)
      expect(meta.heroEquipment.sourceAsset).toBe(SOURCES[kind].split('/')[1].replace('.glb', ''))
      expect(meta.heroEquipment.attachUnder).toBe('spreader')
    }
  })

  it('is not referenced at page load: only the lazy loader (heroEquipmentAssets.ts), the dev viewer and tests mention the files', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const offenders: string[] = []
    let loaderNamesThem = false
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (['assets', 'tests', 'dev', 'docs', 'node_modules'].includes(e.name)) continue
          walk(p)
        } else if (/\.(ts|vue)$/.test(e.name) && /hero-equipment\/|hero-spreader-/.test(readFileSync(p, 'utf8'))) {
          if (e.name === 'heroEquipmentAssets.ts') loaderNamesThem = true
          else if (!p.includes(join('cli', 'assets'))) offenders.push(p)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
    expect(loaderNamesThem).toBe(true)
  })
})
