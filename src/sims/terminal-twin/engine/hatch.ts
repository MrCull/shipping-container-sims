/**
 * Hatch covers (TT-R09), the pure part: settings, panel geometry, and the quay laydown area. No state, no events (those
 * are `subsystems/hatch.ts`).
 *
 * Laydown. Removed panels go on the quay, in the strip between the last STS ground lane and the landside STS rail
 * (the STS backreach), at the X of the nearest "laydown bay": the gap between an SHC up spine (x_k + 5) and the next
 * down spine (x_k+1) of the lane graph, centred at x_k + 15 = 25 k with the default 25 m station spacing. A laydown
 * bay holds one stack of up to `laydownStackLimit` panels of one hatch. The geometry is chosen so that a panel is
 * clear (with `LAYDOWN_CLEAR_M`) of the ground lanes, SHC vehicles on the spines and aprons, and the STS rails;
 * `hatchLaydownProblems` checks this against the lane graph.
 */
import { apronLayout, laneGraphOf } from './laneGraph'
import type { HatchPanelState, SimState } from './state'
import type { ScenarioConfig, VesselSizeClass } from '../scenario/types'
import {
  HATCH_THICKNESS_M,
  hatchPanelId,
  hatchPanelRows,
  hatchPanelWidthM,
  hatchPanelZ,
  slotX,
  vesselClass,
  type HatchClassSpec,
} from '../scenario/vesselClasses'

/** [A] Half the width of an SHC (m); keep in sync with `SHC.width` in `modules/equipmentDims.ts`. */
export const SHC_HALF_WIDTH_M = 2.45
/** [A] Z of the landside STS rail (m): `waterRailZ + gauge` of the STS model in `modules/equipmentDims.ts`. */
export const STS_LAND_RAIL_Z = 33.48
/** Half the width of a rail beam (m). */
const RAIL_HALF_M = 0.75
/** Clearance kept between a laydown panel and any vehicle path, lane or rail (m). */
export const LAYDOWN_CLEAR_M = 0.4
/** Offset of a station's up spine from its down spine (m); mirrors `UP_SPINE_OFFSET_M` in `laneGraph.ts`. */
const UP_SPINE_OFFSET_M = 5
/** Stations start this far before the quay (m); mirrors `LANE_MARGIN_M` in `laneGraph.ts`. */
const LANE_MARGIN_M = 15

/** Resolved hatch settings of a vessel class: the class values with the scenario overrides applied. */
export type HatchSettings = HatchClassSpec

export const hatchEnabled = (config: ScenarioConfig): boolean => config.hatch?.enabled !== false

/** The hatch settings of a vessel class in this scenario. */
export function hatchSettings(config: ScenarioConfig, sizeClass: VesselSizeClass): HatchSettings {
  const base = vesselClass(sizeClass).hatch
  const o = config.hatch
  return {
    ...base,
    ...(o?.lashingReleaseS !== undefined ? { lashingReleaseS: o.lashingReleaseS } : {}),
    ...(o?.lashingSecureS !== undefined ? { lashingSecureS: o.lashingSecureS } : {}),
    ...(o?.cycleS !== undefined ? { cycleS: o.cycleS } : {}),
    ...(o?.laydownStackLimit !== undefined ? { laydownStackLimit: o.laydownStackLimit } : {}),
  }
}

/** Z of the first quay-side edge a laydown panel may occupy: clear of the last ground lane (and SHC vehicles on it). */
export function laydownZFrom(config: ScenarioConfig): number {
  const lanes = Math.max(0, ...config.sts.map((s) => s.groundPositions))
  const lastLaneZ = config.layout.stsGroundLaneZ0M + Math.max(0, lanes - 1) * config.layout.stsGroundLaneSpacingM
  return lastLaneZ + SHC_HALF_WIDTH_M + LAYDOWN_CLEAR_M
}

/**
 * Z of the near (quay-side) edge of a laydown panel of `widthM`: just landside of the ground lanes if the panel then
 * clears the landside STS rail, else landside of the rail (only fixtures with many ground lanes and no SHCs).
 */
export function laydownEdgeZ(config: ScenarioConfig, widthM: number): number {
  const zLo = laydownZFrom(config)
  const limit = STS_LAND_RAIL_Z - RAIL_HALF_M - LAYDOWN_CLEAR_M
  return zLo + widthM <= limit ? zLo : Math.max(zLo, STS_LAND_RAIL_Z + RAIL_HALF_M + LAYDOWN_CLEAR_M)
}

/** Spacing of the laydown bays along the quay (m): the lane graph's station spacing. */
export function laydownPitchM(config: ScenarioConfig): number {
  return apronLayout(config).stationSpacingM
}

/**
 * Laydown bay ids and X positions along the quay: the middle of the gap between an up spine (x_k + 5) and the next
 * down spine, for the stations x_k = -15 + pitch × k of the lane graph, inside the quay.
 */
export function laydownSites(config: ScenarioConfig): { id: string; x: number }[] {
  const pitch = laydownPitchM(config)
  const out: { id: string; x: number }[] = []
  for (let k = 0; ; k++) {
    const x = -LANE_MARGIN_M + pitch * k + UP_SPINE_OFFSET_M + (pitch - UP_SPINE_OFFSET_M) / 2
    if (x > config.quay.lengthM) break
    if (x >= 0) out.push({ id: laydownSiteId(x), x })
  }
  return out
}

export const laydownSiteId = (x: number): string => `LD@${Math.round(x * 1000) / 1000}`

/** Z of the centre of a laydown panel of `widthM`. */
export function laydownCentreZ(config: ScenarioConfig, widthM: number): number {
  return laydownEdgeZ(config, widthM) + widthM / 2
}

/** Y of the top of a laydown stack holding `count` panels (m above quay level). */
export const laydownTopY = (count: number): number => count * HATCH_THICKNESS_M

/** Plan-view rectangle of a laydown panel of a class at a site. */
export function laydownRect(config: ScenarioConfig, x: number, widthM: number, lengthM: number) {
  const z0 = laydownEdgeZ(config, widthM)
  return { x0: x - lengthM / 2, x1: x + lengthM / 2, z0, z1: z0 + widthM }
}

/**
 * Why the laydown cannot be placed clear of the waterside network (empty = it can). Checks every laydown bay at the
 * widest panel of every vessel class used against the ground lanes, the STS rails and the SHC lane graph (nodes with
 * vehicle half width, edges, conflict zones). Only meaningful with SHCs; without them nothing but lanes and rails
 * is in the strip.
 */
export function hatchLaydownProblems(config: ScenarioConfig, sizeClasses?: readonly VesselSizeClass[]): string[] {
  const classes = sizeClasses ?? [...new Set(config.vessels.map((v) => v.sizeClass))]
  const problems: string[] = []
  const lanes = Math.max(0, ...config.sts.map((s) => s.groundPositions))
  const { stsGroundLaneZ0M: z0, stsGroundLaneSpacingM: dz } = config.layout
  const graph = laneGraphOf(config)
  const hasShcs = (config.shcs?.length ?? 0) > 0
  for (const cls of classes) {
    const spec = vesselClass(cls)
    const widest = maxPanelWidth(cls)
    for (const site of laydownSites(config)) {
      const r = laydownRect(config, site.x, widest, spec.hatch.panelLengthM)
      const where = `${cls} panel at ${site.id}`
      for (let j = 0; j < lanes; j++) {
        const z = z0 + j * dz
        if (r.z0 < z + SHC_HALF_WIDTH_M && r.z1 > z - SHC_HALF_WIDTH_M) problems.push(`${where} overlaps ground lane ${j + 1} (Z ${z})`)
      }
      for (const railZ of [3, STS_LAND_RAIL_Z])
        if (r.z0 < railZ + RAIL_HALF_M && r.z1 > railZ - RAIL_HALF_M) problems.push(`${where} sits on the STS rail at Z ${railZ}`)
      if (!hasShcs) continue
      const w = SHC_HALF_WIDTH_M
      for (const n of Object.values(graph.nodes))
        if (n.x > r.x0 - w && n.x < r.x1 + w && n.z > r.z0 - w && n.z < r.z1 + w) problems.push(`${where} is on lane node ${n.id}`)
      for (const e of graph.edges) {
        const a = graph.nodes[e.from]
        const b = graph.nodes[e.to]
        const ex0 = Math.min(a.x, b.x) - w
        const ex1 = Math.max(a.x, b.x) + w
        const ez0 = Math.min(a.z, b.z) - w
        const ez1 = Math.max(a.z, b.z) + w
        if (ex0 < r.x1 && ex1 > r.x0 && ez0 < r.z1 && ez1 > r.z0) problems.push(`${where} crosses lane edge ${e.from} → ${e.to}`)
      }
      for (const z of Object.values(graph.zones))
        if (z.x0 < r.x1 && z.x1 > r.x0 && z.z0 < r.z1 && z.z1 > r.z0) problems.push(`${where} overlaps conflict zone ${z.id}`)
    }
  }
  return [...new Set(problems)]
}

/** The widest panel (m) of a vessel class. */
export function maxPanelWidth(sizeClass: VesselSizeClass): number {
  const spec = vesselClass(sizeClass)
  return Math.max(...Array.from({ length: spec.hatch.panels }, (_, i) => hatchPanelWidthM(spec, i)))
}

/**
 * Create the (secured) hatch panels of every bay of every vessel that has a slot in it. Bays follow the bay plan, so
 * a bay without cargo has no panel objects (it never opens).
 */
export function createHatchPanels(state: SimState, config: ScenarioConfig): void {
  const bays = new Map<string, Set<number>>()
  for (const s of Object.values(state.vesselSlots)) {
    let set = bays.get(s.vesselId)
    if (!set) bays.set(s.vesselId, (set = new Set()))
    set.add(s.bay)
  }
  for (const v of Object.values(state.vessels)) {
    const spec = vesselClass(v.sizeClass)
    const settings = hatchSettings(config, v.sizeClass)
    // ROB bays have no slots but a closed hatch: the panels are drawn and stay secured (never opened)
    for (const bay of [...new Set([...(bays.get(v.id) ?? []), ...(v.robBays ?? [])])].sort((a, b) => a - b)) {
      for (let index = 0; index < settings.panels; index++) {
        const { from, to } = hatchPanelRows(spec, index)
        const home = { x: slotX(spec, 0, bay), y: spec.deckHeightM, z: hatchPanelZ(spec, index) }
        const panel: HatchPanelState = {
          id: hatchPanelId(v.id, bay, index),
          vesselId: v.id,
          bay,
          index,
          rowFrom: from,
          rowTo: to,
          lengthM: settings.panelLengthM,
          widthM: hatchPanelWidthM(spec, index),
          weightT: settings.panelWeightT,
          home,
          pos: { ...home },
          status: 'secured',
          opens: false,
          lashingScheduled: false,
          lashingReleasedAt: null,
          liftedAt: null,
          stsId: null,
          siteId: null,
          level: null,
          cycles: 0,
          deckBoxes: 0,
          placedOn: null,
        }
        state.hatchPanels[panel.id] = panel
        ;(v.hatchPanelIds ??= []).push(panel.id)
      }
    }
  }
}

/** The vessel berthed at `berthX`: its panels lie on its hatches there. */
export function positionHatchPanels(state: SimState, vesselId: string, berthX: number): void {
  const v = state.vessels[vesselId]
  const spec = vesselClass(v.sizeClass)
  for (const id of v.hatchPanelIds ?? []) {
    const p = state.hatchPanels[id]
    if (p.status !== 'secured') continue
    p.home.x = slotX(spec, berthX, p.bay)
    p.pos.x = p.home.x
  }
}
