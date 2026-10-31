/**
 * Seam 4 — phase 2 asset outputs. The budget check reads committed GLBs and
 * their `.meta.json` sidecars only (no Blender), so it runs in CI.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, loadBudgets, runBudgetCli } from '../cli/assets/budgetCheck'

/** A minimal valid GLB: JSON chunk + an empty BIN chunk (the checker never decodes buffers). */
function writeGlb(file: string, json: object): void {
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const jsonBytes = Buffer.from(text, 'utf8')
  const bin = Buffer.alloc(0)
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const jsonHead = Buffer.alloc(8)
  jsonHead.writeUInt32LE(jsonBytes.length, 0)
  jsonHead.writeUInt32LE(0x4e4f534a, 4)
  const binHead = Buffer.alloc(8)
  binHead.writeUInt32LE(0, 0)
  binHead.writeUInt32LE(0x004e4942, 4)
  writeFileSync(file, Buffer.concat([header, jsonHead, jsonBytes, binHead, bin]))
}

/** A fake container asset: LOD0/LOD1 with the given triangle counts and extra nodes. */
function fakeContainer(lod0Tris: number, lod1Tris: number, extraNodes: string[] = ['body', 'door_left', 'door_right']) {
  const accessors = [{ count: lod0Tris * 3 }, { count: lod1Tris * 3 }]
  const meshes = [
    { name: 'lod0', primitives: [{ attributes: {}, indices: 0 }] },
    { name: 'lod1', primitives: [{ attributes: {}, indices: 1 }] },
  ]
  const nodes: { name: string; children?: number[]; mesh?: number }[] = [
    { name: 'container_x', children: [1, 2] },
    { name: 'LOD0', children: [] },
    { name: 'LOD1', mesh: 1 },
  ]
  for (const name of extraNodes) {
    nodes[1].children!.push(nodes.length)
    nodes.push(name === 'body' ? { name, mesh: 0 } : { name })
  }
  return { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes, meshes, accessors }
}

function sidecar(overrides: Record<string, unknown> = {}) {
  return {
    asset: 'container-x',
    kind: 'container',
    dimensions: { lengthM: 6.058, widthM: 2.438, heightM: 2.591 },
    axes: { up: '+Y' },
    nodes: [{ name: 'LOD0' }, { name: 'LOD1' }, { name: 'body' }, { name: 'door_left' }, { name: 'door_right' }],
    travelLimits: {},
    attachPoints: [],
    groundContact: { y: 0 },
    provenance: [],
    ...overrides,
  }
}

function library(glb: object, meta: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'tt-assets-'))
  mkdirSync(join(dir, 'containers'))
  writeGlb(join(dir, 'containers', 'container-x.glb'), glb)
  writeFileSync(join(dir, 'containers', 'container-x.meta.json'), JSON.stringify(meta))
  return dir
}

describe('asset budget check', () => {
  it('passes an asset within its budgets and reports triangles and draw calls per LOD', () => {
    const report = checkAssetLibrary(library(fakeContainer(380, 12), sidecar()))
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.assets[0].lods).toEqual({ LOD0: { triangles: 380, drawCalls: 1 }, LOD1: { triangles: 12, drawCalls: 1 } })
  })

  it('fails an over-budget asset and names the LOD and the limit', () => {
    const report = checkAssetLibrary(library(fakeContainer(380, 24), sidecar()))
    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toMatch(/container-x: LOD1 has 24 triangles \(budget 12\)/)
  })

  it('fails when a required rig node or sidecar field is missing, or a node is not in the sidecar', () => {
    const noDoor = checkAssetLibrary(library(fakeContainer(380, 12, ['body', 'door_left']), sidecar()))
    expect(noDoor.problems.join('\n')).toMatch(/missing required node "door_right"/)

    const { provenance: _drop, ...noProvenance } = sidecar()
    void _drop
    const noField = checkAssetLibrary(library(fakeContainer(380, 12), noProvenance))
    expect(noField.problems.join('\n')).toMatch(/sidecar is missing "provenance"/)

    const undocumented = checkAssetLibrary(library(fakeContainer(380, 12, ['body', 'door_left', 'door_right', 'mystery']), sidecar()))
    expect(undocumented.problems.join('\n')).toMatch(/node "mystery" is not listed in the sidecar/)
  })

  it('fails a GLB without a sidecar and an oversize file', () => {
    const dir = library(fakeContainer(380, 12), sidecar())
    writeGlb(join(dir, 'containers', 'orphan.glb'), fakeContainer(10, 12))
    expect(checkAssetLibrary(dir).problems.join('\n')).toMatch(/orphan: no sidecar/)

    const budgets = loadBudgets()
    budgets.kinds.container.maxFileBytes = 100
    const big = checkAssetLibrary(library(fakeContainer(380, 12), sidecar()), budgets)
    expect(big.problems.join('\n')).toMatch(/container-x: file is \d+ bytes \(budget 100\)/)
  })

  it('fails a named group whose assets together exceed its triangle or draw-call budget', () => {
    const dir = library(fakeContainer(380, 12), sidecar())
    const budgets = loadBudgets()
    budgets.groups = { pair: { assets: ['container-x'], maxTriangles: 300, maxDrawCalls: 1 } }
    const over = checkAssetLibrary(dir, budgets)
    expect(over.ok).toBe(false)
    expect(over.problems.join('\n')).toMatch(/group pair: 392 triangles \(budget 300\)/)
    expect(over.problems.join('\n')).toMatch(/group pair: 2 draw calls \(budget 1\)/)
    budgets.groups = { pair: { assets: ['container-x'], maxTriangles: 400, maxDrawCalls: 2 } }
    expect(checkAssetLibrary(dir, budgets).problems).toEqual([])
    budgets.groups = { pair: { assets: ['container-x', 'ghost'], maxTriangles: 400, maxDrawCalls: 2 } }
    expect(checkAssetLibrary(dir, budgets).problems.join('\n')).toMatch(/group pair: no asset named "ghost"/)
  })

  it('the committed asset library meets its budgets (all three container sizes)', () => {
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    expect(report.assets.map((a) => a.name).sort()).toEqual(
      expect.arrayContaining(['container-20', 'container-40', 'container-40hc']),
    )
    for (const a of report.assets.filter((x) => x.kind === 'container')) {
      expect(a.lods.LOD1.triangles).toBe(12)
      expect(a.lods.LOD0.triangles).toBeGreaterThan(200)
    }
  })

  it('tt:assets:check exits 0 for the committed library and 1 for an over-budget one', () => {
    const out: string[] = []
    expect(runBudgetCli([], (l) => out.push(l))).toBe(0)
    expect(out.join('\n')).toMatch(/container-40hc/)
    const bad = library(fakeContainer(9000, 12), sidecar())
    const badOut: string[] = []
    expect(runBudgetCli(['--dir', bad], (l) => badOut.push(l))).toBe(1)
    expect(badOut.join('\n')).toMatch(/LOD0 has 9000 triangles/)
    expect(readFileSync(join(bad, 'containers', 'container-x.meta.json'), 'utf8')).toContain('container-x')
  })
})
