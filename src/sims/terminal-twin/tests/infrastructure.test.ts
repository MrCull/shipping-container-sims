/**
 * TT-28: infrastructure models. Seam 4 (the committed GLBs, sidecars and previews through the budget check) plus the
 * pure layout and instancing logic (no WebGL): gate assembly for 1 to 6 lanes, widths from the sidecars, instanced
 * repeated items and the draw-call count, backdrop scope. Browser loading is covered by the infrastructure smoke test.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { checkAssetLibrary, MODELS_DIR } from '../cli/assets/budgetCheck'
import { readGlbJson } from '../cli/assets/glb'
import { blockSpecs, buildLandsideGraph, railEndZ, GATE_ISLAND_W_M, GATE_LANE_W_M, GATE_OOG_LANE_W_M, wtpPadLayout, type LandsideGraph } from '../engine'
import { BACKDROP_MODEL_ASSETS, backdropKindFor, buildBackdrop } from '../modules/backdrop'
import { INFRA, INFRA_ASSET_NAMES, type InfraAssets, type InfraKey } from '../modules/infrastructureAssets'
import { BLOCK_FOOTPRINT_HALF_X_M, buildingPlacements, countByKey, gateLaneSlots, gatePlacements, infrastructurePlacements, mastSpots, quayPlacements, type InfraLayoutInput } from '../modules/infrastructureLayout'
import { assetNamesFor, InfrastructureScene } from '../modules/infrastructureRenderer'
import { presets, TTI_PRESET_NAME } from '../scenario/presets'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const DIR = join(MODELS_DIR, 'infrastructure')
const meta = (name: string): Record<string, any> => JSON.parse(readFileSync(join(DIR, `${name}.meta.json`), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any

function layoutInput(config: ScenarioConfig): InfraLayoutInput {
  return { config, landside: config.landside ? buildLandsideGraph(config) : null, pads: wtpPadLayout(config), blocks: blockSpecs(config) }
}

function withGate(base: ScenarioConfig, inLanes: number, outLanes: number, oogLane: boolean): ScenarioConfig {
  return { ...base, landside: { ...base.landside!, gate: { ...base.landside!.gate, inLanes, outLanes, oogLane } } } as ScenarioConfig
}

describe('infrastructure assets', () => {
  it('has a GLB, sidecar and preview for every asset and passes the budget check (one command generates them)', () => {
    for (const name of INFRA_ASSET_NAMES) {
      expect(existsSync(join(DIR, `${name}.glb`)), name).toBe(true)
      expect(existsSync(join(DIR, `${name}.meta.json`)), name).toBe(true)
      expect(existsSync(join(DIR, 'previews', `${name}-1.webp`)), `${name} preview`).toBe(true)
    }
    expect(existsSync(join(DIR, 'infra-atlas.json'))).toBe(true)
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const infra = report.assets.filter((a) => a.file.includes('infrastructure'))
    expect(infra.map((a) => a.name).sort()).toEqual([...INFRA_ASSET_NAMES].sort())
    for (const a of infra) {
      expect(a.lods.LOD0, a.name).toBeDefined() // no LOD1 / LOD2: gate and buildings have no LOD
      if (a.kind === 'gate' || a.kind === 'building') expect(a.lods.LOD0.triangles, a.name).toBeLessThanOrEqual(5000)
    }
  })

  it('keeps the whole library at or below 15 MB and the budget check reports the total', () => {
    const report = checkAssetLibrary()
    expect(report.libraryBytes).toBeLessThanOrEqual(15_000_000)
    const budgets = JSON.parse(readFileSync(join(MODELS_DIR, '..', 'budgets.json'), 'utf8')) as { libraryMaxBytes: number }
    expect(budgets.libraryMaxBytes).toBeLessThanOrEqual(15_000_000)
    const infraBytes = INFRA_ASSET_NAMES.reduce((s, n) => s + statSync(join(DIR, `${n}.glb`)).size, 0)
    expect(infraBytes).toBeLessThan(report.libraryBytes)
  })

  it('records the 3.5 m truck lane and the 8 m out-of-gauge lane in the gate sidecars, equal to the engine gate geometry', () => {
    expect(meta('gate-lane').module.laneWidthM).toBe(3.5)
    expect(meta('gate-lane').dimensions.widthM).toBe(3.5)
    expect(meta('gate-lane-oog').module.laneWidthM).toBe(8)
    expect(meta('gate-lane-oog').dimensions.widthM).toBe(8)
    expect(meta('gate-island').module.islandWidthM).toBe(GATE_ISLAND_W_M)
    expect(INFRA.laneWidthM).toBe(GATE_LANE_W_M)
    expect(INFRA.oogLaneWidthM).toBe(GATE_OOG_LANE_W_M)
    expect(INFRA.islandWidthM).toBe(GATE_ISLAND_W_M)
    expect(meta('gate-lane').travelLimits.boom).toMatchObject({ type: 'rotation', axis: '+Z' })
    for (const n of ['boom', 'boom_housing', 'canopy', 'pavement']) expect(readGlbJson(join(DIR, 'gate-lane.glb')).nodes!.map((x) => x.name)).toContain(n)
  })

  it('models the gate details: islands with kerb stripes and a yellow kiosk, canopy with lane signs, plate-camera housings, barrier booms, an office', () => {
    const names = (n: string) => (readGlbJson(join(DIR, `${n}.glb`)).nodes ?? []).map((x) => x.name)
    expect(names('gate-island')).toEqual(expect.arrayContaining(['island', 'kiosk', 'camera_post', 'canopy']))
    expect(names('gate-lane-oog')).toEqual(expect.arrayContaining(['boom', 'canopy']))
    expect(names('gate-office')).toContain('office')
    expect(meta('gate-lane').provenance.some((p: { fact: string }) => /camera/.test(p.fact))).toBe(true)
  })

  it('has the quay furniture, yard infrastructure, three buildings and three backdrop meshes the ticket lists', () => {
    for (const n of ['quay-bollard', 'quay-fender', 'quay-rail', 'quay-edge']) expect(meta(n).kind).toBe('quay')
    for (const n of ['yard-mast', 'yard-fence', 'yard-asc-rail', 'yard-markings']) expect(meta(n).kind).toBe('yard')
    expect(INFRA_ASSET_NAMES.filter((n) => n.startsWith('building-'))).toHaveLength(3)
    for (const n of ['backdrop-rock', 'backdrop-hills', 'backdrop-coast']) expect(meta(n).kind).toBe('backdrop')
    expect(meta('backdrop-rock').dimensions.heightM).toBe(426)
    expect(meta('yard-markings').dimensions.widthM).toBe(3.2)
  })
})

describe('gate assembly', () => {
  const base = fixtures['truck-gate-queue']

  it('assembles for 1 to 6 inbound and outbound lanes, with and without the out-of-gauge lane: modules tile the cluster with no gap or overlap', () => {
    for (let lanes = 1; lanes <= 6; lanes++) {
      for (const oog of [true, false]) {
        const config = withGate(base, lanes, 7 - lanes, oog)
        const g = buildLandsideGraph(config)
        const placements = gatePlacements(g)
        const laneMods = placements.filter((p) => p.key === 'gate-lane' || p.key === 'gate-lane-oog')
        const islands = placements.filter((p) => p.key === 'gate-island')
        expect(laneMods.filter((p) => p.key === 'gate-lane')).toHaveLength(lanes + (7 - lanes))
        expect(laneMods.filter((p) => p.key === 'gate-lane-oog')).toHaveLength(oog ? 1 : 0)
        expect(islands).toHaveLength(laneMods.length + 1)
        const spans = [
          ...laneMods.map((p) => ({ x0: p.x - (p.key === 'gate-lane-oog' ? INFRA.oogLaneWidthM : INFRA.laneWidthM) / 2, x1: p.x + (p.key === 'gate-lane-oog' ? INFRA.oogLaneWidthM : INFRA.laneWidthM) / 2 })),
          ...islands.map((p) => ({ x0: p.x - INFRA.islandWidthM / 2, x1: p.x + INFRA.islandWidthM / 2 })),
        ].sort((a, b) => a.x0 - b.x0)
        for (let i = 0; i + 1 < spans.length; i++) expect(spans[i + 1].x0 - spans[i].x1, `lanes ${lanes}/${7 - lanes} oog ${oog} gap ${i}`).toBeCloseTo(0, 2)
        // every lane module sits on its engine lane (trucks drive in the lanes the models draw)
        const lanesX = [...g.inLanes, ...g.outLanes].map((l) => l.x)
        for (const x of lanesX) expect(laneMods.some((p) => Math.abs(p.x - x) < 1e-6)).toBe(true)
        if (g.oogX !== null) expect(laneMods.some((p) => p.key === 'gate-lane-oog' && Math.abs(p.x - g.oogX!) < 1e-6)).toBe(true)
        expect(placements.filter((p) => p.key === 'gate-office')).toHaveLength(1)
        for (const p of laneMods) expect(p.z).toBe(g.gate.kioskZ)
      }
    }
  })

  it('orients lanes with their traffic: inbound and out-of-gauge modules face -Z, outbound +Z', () => {
    const g = buildLandsideGraph(base)
    const placements = gatePlacements(g)
    for (const l of g.inLanes) expect(placements.find((p) => p.key === 'gate-lane' && Math.abs(p.x - l.x) < 1e-6)!.yaw).toBeCloseTo(Math.PI)
    for (const l of g.outLanes) expect(placements.find((p) => p.key === 'gate-lane' && Math.abs(p.x - l.x) < 1e-6)!.yaw).toBe(0)
  })

  it('lays the lane slots west to east with the engine lane widths (3.5 m trucks, 8 m out-of-gauge)', () => {
    const g = buildLandsideGraph(withGate(base, 2, 2, true))
    const slots = gateLaneSlots(g)
    expect(slots.map((s) => s.kind)).toEqual(['in', 'in', 'oog', 'out', 'out'])
    expect(slots.map((s) => s.widthM)).toEqual([3.5, 3.5, 8, 3.5, 3.5])
    for (let i = 0; i + 1 < slots.length; i++) {
      const gap = slots[i + 1].x - slots[i].x - (slots[i].widthM + slots[i + 1].widthM) / 2
      expect(gap).toBeCloseTo(GATE_ISLAND_W_M, 2)
    }
  })

  it('places the buildings west of the gate only when there is a landside', () => {
    const g: LandsideGraph = buildLandsideGraph(base)
    const b = buildingPlacements(g)
    expect(b.map((p) => p.key).sort()).toEqual(['building-control', 'building-substation', 'building-workshop'])
    for (const p of b) expect(p.x).toBeLessThan(g.gate.westX)
    const noLandside = infrastructurePlacements(layoutInput({ ...base, landside: undefined }))
    expect(noLandside.some((p) => p.key.startsWith('gate-') || p.key.startsWith('building-'))).toBe(false)
  })
})

describe('instancing and draw calls', () => {
  const tti = presets[TTI_PRESET_NAME]()
  const input = layoutInput(tti)

  /** A stand-in for the loaded GLBs: one tiny geometry per key (the renderer only instances them). */
  function fakeAssets(keys: InfraKey[]): InfraAssets {
    const geometries: InfraAssets['geometries'] = {}
    for (const k of keys) geometries[k] = new THREE.BoxGeometry(1, 1, 1)
    return { material: new THREE.MeshStandardMaterial(), geometries }
  }

  it('draws repeated infrastructure instanced: one draw call per geometry key, far fewer than placements', () => {
    const scene = new InfrastructureScene(input)
    const counts = countByKey(scene.placements)
    expect(counts['quay-bollard']).toBeGreaterThan(10)
    expect(counts['quay-fender']).toBeGreaterThan(20)
    expect(counts['yard-fence']).toBeGreaterThan(20)
    expect(counts['yard-mast']).toBeGreaterThan(10)
    expect(counts['gate-lane']).toBe(input.landside!.inLanes.length + input.landside!.outLanes.length)
    expect(scene.stats()).toMatchObject({ assets: 'placeholder', drawCalls: 0 })
    scene.setAssets(fakeAssets(Object.keys(counts) as InfraKey[]))
    const s = scene.stats()
    expect(s.assets).toBe('loaded')
    expect(s.drawCalls).toBe(Object.keys(counts).length)
    expect(s.drawCalls).toBeLessThanOrEqual(24) // the infrastructure layer's share of the TT-19 draw-call budget for the TTI preset
    expect(scene.placements.length).toBeGreaterThan(s.drawCalls * 10)
    for (const m of scene.group.children as THREE.InstancedMesh[]) expect(m.isInstancedMesh).toBe(true)
    scene.dispose()
  })

  it('keeps the draw calls independent of quay length and lane count', () => {
    const long = { ...tti, quay: { ...tti.quay, lengthM: tti.quay.lengthM * 2 } } as ScenarioConfig
    const calls = (c: ScenarioConfig) => Object.keys(countByKey(infrastructurePlacements(layoutInput(c)))).length
    expect(calls(long)).toBe(calls(tti))
    expect(calls(withGate(tti, 6, 6, true))).toBe(calls(withGate(tti, 1, 1, false)) + 1) // only the OOG module is a further geometry
  })

  it('loads only the asset files a scenario needs', () => {
    const names = assetNamesFor(infrastructurePlacements(input))
    expect(names).toEqual(expect.arrayContaining(['gate-lane', 'gate-lane-oog', 'gate-island', 'gate-office', 'quay-edge', 'quay-rail', 'quay-bollard', 'quay-fender', 'yard-mast', 'yard-fence', 'yard-asc-rail', 'yard-markings', 'building-control']))
    expect(names.some((n) => n.startsWith('backdrop-'))).toBe(false)
    const quayOnly = assetNamesFor(infrastructurePlacements(layoutInput({ ...tti, landside: undefined })))
    expect(quayOnly.some((n) => n.startsWith('gate-'))).toBe(false)
  })

  it('lays out the quay: edge and both STS rails along the whole quay, bollards and fenders at fixed pitch, masts shared with the night glow', () => {
    const q = quayPlacements(tti)
    const edge = q.filter((p) => p.key === 'quay-edge')
    expect(edge[0].x - 5 * edge[0].scaleX).toBeCloseTo(-40, 6)
    const last = edge[edge.length - 1]
    expect(last.x + 5 * last.scaleX).toBeCloseTo(tti.quay.lengthM + 40, 6)
    expect(new Set(q.filter((p) => p.key === 'quay-rail').map((p) => p.z))).toEqual(new Set([3, 3 + 30.48]))
    const masts = infrastructurePlacements(input).filter((p) => p.key === 'yard-mast')
    expect(masts.map((p) => [p.x, p.z])).toEqual(mastSpots(input, 3 + 30.48 + 6))
  })

  describe('V11-03: light masts stay outside the yard blocks', () => {
    const configs: [string, ScenarioConfig][] = [
      ...Object.entries(presets).map(([n, b]) => [n, b()] as [string, ScenarioConfig]),
      ...Object.entries(fixtures).filter(([, c]) => (c.yard?.blocks.length ?? 0) > 0),
    ]
    it('a scenario without blocks only gets the quay row', () => {
      const spots = mastSpots({ config: tti, blocks: [] }, 39.5)
      expect(spots.length).toBeGreaterThan(0)
      expect(spots.every(([, z]) => z === 39.5)).toBe(true)
    })
    it('has presets and fixtures with blocks to check', () => {
      expect(configs.length).toBeGreaterThan(8)
    })
    it.each(configs)('%s: no mast inside any block footprint (block width plus ASC rail span, over all bays)', (_name, config) => {
      const i = layoutInput(config)
      const spots = mastSpots(i, 3 + 30.48 + 6)
      for (const b of i.blocks) {
        const inside = spots.filter(([x, z]) => Math.abs(x - b.x) < BLOCK_FOOTPRINT_HALF_X_M && z >= b.wtpZ - 16 && z <= railEndZ(b))
        expect(inside, `${b.id}`).toEqual([])
      }
    })
    it.each(configs)('%s: every block still has masts along at least one side', (_name, config) => {
      const i = layoutInput(config)
      const spots = mastSpots(i, 3 + 30.48 + 6)
      for (const b of i.blocks) {
        const beside = spots.filter(([x, z]) => Math.abs(x - b.x) >= BLOCK_FOOTPRINT_HALF_X_M && Math.abs(x - b.x) <= BLOCK_FOOTPRINT_HALF_X_M + 40 && z >= b.wtpZ && z <= railEndZ(b))
        expect(beside.length, `${b.id}`).toBeGreaterThan(0)
      }
    })
  })

  it('draws ASC rails along each block and a WTP pad and transfer stall marking per engine pad and stall', () => {
    const p = infrastructurePlacements(input)
    const blocks = input.blocks
    expect(p.filter((x) => x.key === 'yard-markings:wtp_pad')).toHaveLength(wtpPadLayout(tti).length)
    expect(p.filter((x) => x.key === 'yard-markings:transfer_stall')).toHaveLength(blocks.reduce((s, b) => s + b.transferStalls, 0))
    expect(p.filter((x) => x.key === 'yard-asc-rail').length).toBeGreaterThanOrEqual(blocks.length * 2)
  })
})

describe('backdrop scope', () => {
  it('replaces the procedural backdrop with the GLB meshes for the TTI preset only', () => {
    expect(BACKDROP_MODEL_ASSETS.tti).toEqual(['backdrop-rock', 'backdrop-hills', 'backdrop-coast'])
    expect(BACKDROP_MODEL_ASSETS.generic).toEqual([])
    const assets: InfraAssets = {
      material: new THREE.MeshStandardMaterial(),
      geometries: { 'backdrop-rock': new THREE.BoxGeometry(1, 1, 1), 'backdrop-hills': new THREE.BoxGeometry(1, 1, 1), 'backdrop-coast': new THREE.BoxGeometry(1, 1, 1) },
    }
    for (const name of Object.keys(presets)) {
      const kind = backdropKindFor(name)
      const b = buildBackdrop(kind, 1000)
      const rockBefore = (b.group.getObjectByName('rock') as THREE.Mesh | undefined)?.geometry
      b.useModels(assets)
      if (name === TTI_PRESET_NAME) {
        expect(b.models).toBe('glb')
        expect((b.group.getObjectByName('rock') as THREE.Mesh).geometry).toBe(assets.geometries['backdrop-rock'])
        expect((b.group.getObjectByName('northQuay') as THREE.Group).children.length).toBeGreaterThan(0) // the North Quay stays procedural
      } else {
        expect(b.models, name).toBe('procedural')
        expect((b.group.getObjectByName('coast') as THREE.Mesh).geometry).not.toBe(assets.geometries['backdrop-coast'])
        expect(rockBefore).toBeUndefined()
      }
      b.dispose()
    }
  })
})
