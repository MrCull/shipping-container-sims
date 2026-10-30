/**
 * Seam 4 — phase 2 asset outputs, vessel hulls (TT-27). Reads the committed
 * GLBs and sidecars (no Blender) and cross-checks them against the engine's
 * bay plan (`scenario/vesselClasses.ts`): a container in any slot, placed on
 * the hull through the sidecar's bay grid, must land where the engine puts it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODELS_DIR, checkAssetLibrary } from '../cli/assets/budgetCheck'
import { readGlbJson, type GltfJson } from '../cli/assets/glb'
import type { ContainerSize, VesselSizeClass } from '../scenario/types'
import { slotCentre, VESSEL_CLASSES, VESSEL_SIZE_CLASSES, type SlotPosition } from '../scenario/vesselClasses'
import { HULL_ASSET_FILES, hullPlacement, hullSlotCentre, type HullMeta } from '../modules/vesselHull'

const DIR = join(MODELS_DIR, 'vessels')
const meta = (c: VesselSizeClass) => JSON.parse(readFileSync(join(DIR, `${HULL_ASSET_FILES[c]}.meta.json`), 'utf8')) as HullMeta
const glb = (c: VesselSizeClass) => readGlbJson(join(DIR, `${HULL_ASSET_FILES[c]}.glb`))

function node(json: GltfJson, name: string) {
  const found = (json.nodes ?? []).find((n) => n.name === name)
  if (!found) throw new Error(`no node ${name}`)
  return found
}

/** Asset-space bounds of one mesh node (accessor min/max, dequantised through the node's TRS; no rotation used). */
function meshBounds(json: GltfJson, name: string): { min: number[]; max: number[] } {
  const n = node(json, name)
  const mesh = json.meshes![n.mesh!]
  const t = n.translation ?? [0, 0, 0]
  const s = n.scale ?? [1, 1, 1]
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of mesh.primitives) {
    const a = json.accessors![p.attributes.POSITION]
    if (!a.min || !a.max) throw new Error(`${name}: POSITION accessor has no bounds`)
    const unit = a.normalized ? ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[a.componentType ?? 5126] : 1
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], t[k] + (s[k] * a.min[k]) / unit)
      max[k] = Math.max(max[k], t[k] + (s[k] * a.max[k]) / unit)
    }
  }
  return { min, max }
}

describe('vessel hull assets', () => {
  it('there is one hull per size class, each with a sidecar, within the vessel budgets', () => {
    const report = checkAssetLibrary()
    expect(report.problems).toEqual([])
    const hulls = report.assets.filter((a) => a.kind === 'vessel')
    expect(hulls.map((a) => a.name).sort()).toEqual(VESSEL_SIZE_CLASSES.map((c) => HULL_ASSET_FILES[c]).sort())
    for (const h of hulls) {
      expect(h.lods.LOD0.triangles, h.name).toBeGreaterThan(8000)
      expect(h.lods.LOD1.triangles, h.name).toBeGreaterThan(1500)
      expect(h.lods.LOD1.triangles, h.name).toBeLessThan(h.lods.LOD0.triangles)
      expect(h.lods.LOD2.triangles, h.name).toBeLessThan(h.lods.LOD1.triangles)
      expect(h.lods.LOD2.triangles, h.name).toBeGreaterThan(150)
    }
    for (const c of VESSEL_SIZE_CLASSES) {
      for (const view of ['side', 'three-quarter', 'bow']) {
        expect(existsSync(join(DIR, 'previews', `${HULL_ASSET_FILES[c]}-${view}.webp`)), `${c} ${view} preview`).toBe(true)
      }
    }
  })

  it.each(VESSEL_SIZE_CLASSES)('%s: the sidecar bay grid matches the engine bay plan', (sizeClass) => {
    const spec = VESSEL_CLASSES[sizeClass]
    const m = meta(sizeClass)
    expect(m.sizeClass).toBe(sizeClass)
    expect(m.bayGrid).toMatchObject({ bays: spec.bays, rows: spec.rows, holdTiers: spec.holdTiers, deckTiers: spec.deckTiers })
    expect(m.dimensions.loaM).toBeCloseTo(spec.loaM, 3)
    expect(m.dimensions.beamM).toBeCloseTo(spec.beamM, 3)

    const berthX = 137.5
    const tiers = spec.holdTiers + spec.deckTiers
    const slots: SlotPosition[] = []
    for (const bay of [0, Math.floor(spec.bays / 2), spec.bays - 1])
      for (const row of [0, spec.rows - 1])
        for (const tier of [0, spec.holdTiers - 1, spec.holdTiers, tiers - 1])
          for (const half of [null, 'aft', 'fore'] as const) slots.push({ bay, row, tier, half })
    const place = hullPlacement(m, berthX)
    for (const slot of slots) {
      for (const size of ['20', '40', '40HC'] as ContainerSize[]) {
        const local = hullSlotCentre(m, slot, size)
        const world = { x: local.x + place.x, y: local.y + place.y, z: local.z + place.z }
        const engine = slotCentre(spec, berthX, slot, size)
        const label = `${sizeClass} ${JSON.stringify(slot)} ${size}`
        expect(world.x, label).toBeCloseTo(engine.x, 3)
        expect(world.y, label).toBeCloseTo(engine.y, 3)
        expect(world.z, label).toBeCloseTo(engine.z, 3)
      }
    }
  })

  it.each(VESSEL_SIZE_CLASSES)('%s: the hull geometry is built on that grid', (sizeClass) => {
    const spec = VESSEL_CLASSES[sizeClass]
    const m = meta(sizeClass)
    const json = glb(sizeClass)
    const [ox, oy, oz] = m.bayGrid.origin
    // The bay_grid marker node sits on the sidecar origin.
    const marker = node(json, 'bay_grid')
    expect(marker.translation?.[0]).toBeCloseTo(ox, 3)
    expect(marker.translation?.[1]).toBeCloseTo(oy, 3)
    expect(marker.translation?.[2]).toBeCloseTo(oz, 3)
    // The hull spans the LOA from the stern (x = 0) and the beam about the centreline.
    const hull = meshBounds(json, 'hull')
    expect(hull.min[0]).toBeCloseTo(0, 1)
    expect(hull.max[0]).toBeCloseTo(spec.loaM, 1)
    expect(hull.max[2] - hull.min[2]).toBeCloseTo(spec.beamM, 1)
    expect(hull.min[1]).toBeCloseTo(-m.dimensions.draftM, 1)
    // Hatch-cover tops are the deck-stack base; they cover every bay and row.
    // (1 cm: meshopt quantises positions to ~5 mm over a 300+ m mesh.)
    const hatch = meshBounds(json, 'hatch_covers')
    expect(Math.abs(hatch.max[1] - oy)).toBeLessThan(0.01)
    expect(hatch.min[0]).toBeLessThan(ox + 1)
    expect(hatch.min[0]).toBeGreaterThan(ox)
    expect(hatch.max[0]).toBeGreaterThan(ox + spec.bays * m.bayGrid.bayPitchM - 1)
    expect(hatch.max[0]).toBeLessThan(ox + spec.bays * m.bayGrid.bayPitchM)
    expect(hatch.max[2]).toBeGreaterThanOrEqual(oz)
    expect(hatch.min[2]).toBeLessThanOrEqual(oz - spec.rows * m.bayGrid.rowPitchM)
    // Lashing bridges stand between bays, inside the beam.
    const lashing = meshBounds(json, 'lashing_bridges')
    expect(lashing.max[2] - lashing.min[2]).toBeLessThanOrEqual(spec.beamM)
    expect(lashing.max[1]).toBeLessThanOrEqual(oy + spec.deckTiers * m.bayGrid.tierPitchM)
    expect(lashing.min[0]).toBeGreaterThan(ox)
  })
})
