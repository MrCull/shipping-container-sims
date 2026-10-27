/**
 * Scene model: the renderer's view of the run, built from worker Deltas.
 * Pure TS (no Three.js). It keeps per-entity timelines (motion segments per
 * crane axis, custody per container, status per vessel/STS) so any display
 * time at or before the engine horizon can be drawn exactly — that is what
 * keeps animation smooth at any speed.
 *
 * Scene conventions: 1 unit = 1 m, Y up, quay edge at Z = 0, sea at -Z,
 * yard at +Z, X along the quay.
 */
import { positionAt, type Axis, type CustodyRef, type MotionSegment } from '../engine'
import { planCargo } from '../scenario/bayPlan'
import type { ContainerSize, ScenarioConfig, VesselConfig } from '../scenario/types'
import {
  parseVesselSlotId,
  slotCentre,
  vesselClass,
  type VesselClassSpec,
} from '../scenario/vesselClasses'
import type { Delta } from '../worker/protocol'

/** [A] ISO container outer dimensions (m): length, height, width. */
export const CONTAINER_DIMS: Record<ContainerSize, { length: number; height: number; width: number }> = {
  '20': { length: 6.058, height: 2.591, width: 2.438 },
  '40': { length: 12.192, height: 2.591, width: 2.438 },
  '40HC': { length: 12.192, height: 2.896, width: 2.438 },
}
/** Vessel statuses in which a vessel is alongside the quay. */
const ON_QUAY = new Set(['mooring', 'berthed', 'unmooring'])
/** [A] Anchorage: offshore, beyond the quay end. */
const ANCHORAGE_Z = -700
const ANCHORAGE_SPACING_M = 450

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface StsPose {
  gantryX: number
  trolleyZ: number
  /** Spreader (bottom of headblock) height. */
  hoistY: number
}

interface CustodyEntry {
  t: number
  owner: CustodyRef
  /** Ground positions only: X where the box was set down. */
  x?: number
  /** STS only: offset from the spreader centre (twin-20). */
  dx?: number
}

interface StatusEntry {
  t: number
  status: string
  berthX?: number | null
}

/** Where a vessel is drawn: its stern X and the Z offset of its quay-side (0 = alongside). */
export interface VesselPlacement {
  x: number
  zOffset: number
  status: string
}

const AXES: Axis[] = ['gantry', 'trolley', 'hoist']

/** Index of the last entry with t <= time (entries sorted by t), or -1. */
function lastAtOrBefore<T>(list: T[], time: number, getT: (item: T) => number): number {
  let lo = 0
  let hi = list.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (getT(list[mid]) <= time) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

export class SceneModel {
  readonly config: ScenarioConfig
  readonly seed: number
  readonly containerIds: string[]
  readonly containerSize: Record<string, ContainerSize>
  readonly containerLine: Record<string, string>
  private readonly vessels: Record<string, VesselConfig>
  private readonly specs: Record<string, VesselClassSpec>
  private readonly anchorageSlot: Record<string, number>
  private readonly initialPose: Record<string, StsPose>
  private axisSegments: Record<string, Record<Axis, MotionSegment[]>> = {}
  private custody: Record<string, CustodyEntry[]> = {}
  private status: Record<string, StatusEntry[]> = {}

  /** The bay plan is regenerated here from config + seed (the same pure generator the engine uses). */
  constructor(config: ScenarioConfig, seed: number = config.seed) {
    this.config = config
    this.seed = seed
    const cargo = planCargo(config, seed)
    this.containerIds = cargo.containers.map((c) => c.id)
    this.containerSize = Object.fromEntries(cargo.containers.map((c) => [c.id, c.size]))
    this.containerLine = Object.fromEntries(cargo.containers.map((c) => [c.id, c.line]))
    this.vessels = Object.fromEntries(config.vessels.map((v) => [v.id, v]))
    this.specs = Object.fromEntries(config.vessels.map((v) => [v.id, vesselClass(v.sizeClass)]))
    this.anchorageSlot = Object.fromEntries(config.vessels.map((v, i) => [v.id, i]))
    this.initialPose = Object.fromEntries(
      config.sts.map((s) => [
        s.id,
        { gantryX: s.gantryX, trolleyZ: config.layout.stsGroundLaneZ0M, hoistY: config.layout.stsSafeHoistM },
      ]),
    )
    for (const s of config.sts) this.axisSegments[s.id] = { gantry: [], trolley: [], hoist: [] }
    for (const c of cargo.containers) this.custody[c.id] = [{ t: 0, owner: { kind: 'vesselSlot', id: c.slotId } }]
    for (const v of config.vessels) this.status[`vessel:${v.id}`] = [{ t: 0, status: 'scheduled' }]
    for (const s of config.sts) this.status[`sts:${s.id}`] = [{ t: 0, status: 'idle' }]
  }

  get stsIds(): string[] {
    return this.config.sts.map((s) => s.id)
  }

  get vesselIds(): string[] {
    return this.config.vessels.map((v) => v.id)
  }

  vesselConfig(id: string): VesselConfig {
    return this.vessels[id]
  }

  vesselSpec(id: string): VesselClassSpec {
    return this.specs[id]
  }

  apply(delta: Delta): void {
    for (const plan of delta.motion) {
      const axes = this.axisSegments[plan.entityId]
      if (!axes) continue
      for (const seg of plan.segments) axes[seg.axis].push(seg)
    }
    for (const c of delta.custody) {
      this.custody[c.containerId]?.push({ t: c.t, owner: c.owner, x: c.x, dx: c.dx })
    }
    for (const e of delta.entities) this.status[`${e.kind}:${e.id}`]?.push({ t: e.t, status: e.status, berthX: e.berthX })
  }

  /** Drop history no longer needed to draw times >= `time` (display time never goes back). */
  prune(time: number): void {
    for (const axes of Object.values(this.axisSegments)) {
      for (const axis of AXES) {
        const list = axes[axis]
        const i = lastAtOrBefore(list, time, (s) => s.t0)
        if (i > 0) list.splice(0, i)
      }
    }
    for (const list of [...Object.values(this.custody), ...Object.values(this.status)]) {
      const i = lastAtOrBefore(list, time, (e: { t: number }) => e.t)
      if (i > 0) list.splice(0, i)
    }
  }

  stsPose(stsId: string, time: number): StsPose {
    const axes = this.axisSegments[stsId]
    const pose = { ...this.initialPose[stsId] }
    if (!axes) return pose
    const value = (axis: Axis, initial: number) => {
      const list = axes[axis]
      if (list.length === 0) return initial
      const i = lastAtOrBefore(list, time, (s) => s.t0)
      return i < 0 ? list[0].from : positionAt(list[i], time)
    }
    return {
      gantryX: value('gantry', pose.gantryX),
      trolleyZ: value('trolley', pose.trolleyZ),
      hoistY: value('hoist', pose.hoistY),
    }
  }

  statusAt(kind: 'sts' | 'vessel', id: string, time: number): string {
    const list = this.status[`${kind}:${id}`] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    return i < 0 ? 'unknown' : list[i].status
  }

  /** Where a vessel is at `time`: alongside at its berth, at anchorage offshore, or null (not arrived / departed). */
  vesselPlacement(id: string, time: number): VesselPlacement | null {
    const list = this.status[`vessel:${id}`] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    if (i < 0) return null
    const { status, berthX } = list[i]
    if (ON_QUAY.has(status) && berthX !== null && berthX !== undefined) return { x: berthX, zOffset: 0, status }
    if (status === 'at-anchorage') {
      const x = this.config.quay.lengthM + 200 + (this.anchorageSlot[id] % 4) * ANCHORAGE_SPACING_M
      return { x, zOffset: ANCHORAGE_Z - Math.floor(this.anchorageSlot[id] / 4) * 120, status }
    }
    return null
  }

  vesselVisible(id: string, time: number): boolean {
    return this.vesselPlacement(id, time) !== null
  }

  custodyAt(containerId: string, time: number): CustodyRef | null {
    const list = this.custody[containerId] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    return i < 0 ? null : list[i].owner
  }

  /** Centre of a container at `time`, or null if it is not in the scene. */
  containerCentre(containerId: string, time: number): Vec3 | null {
    const list = this.custody[containerId] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    if (i < 0) return null
    const entry = list[i]
    const dims = CONTAINER_DIMS[this.containerSize[containerId]]
    const { kind, id } = entry.owner
    if (kind === 'vesselSlot') {
      const slot = parseVesselSlotId(id)
      const placement = this.vesselPlacement(slot.vesselId, time)
      if (!placement) return null
      const c = slotCentre(this.specs[slot.vesselId], placement.x, slot, this.containerSize[containerId])
      return { x: c.x, y: c.y, z: c.z + placement.zOffset }
    }
    if (kind === 'sts') {
      const pose = this.stsPose(id, time)
      return { x: pose.gantryX + (entry.dx ?? 0), y: pose.hoistY - dims.height / 2, z: pose.trolleyZ }
    }
    // Ground position "<stsId>-GP<n>" (1-based lane).
    const lane = Number(id.slice(id.lastIndexOf('GP') + 2)) - 1
    const { layout } = this.config
    return {
      x: entry.x ?? 0,
      y: dims.height / 2,
      z: layout.stsGroundLaneZ0M + lane * layout.stsGroundLaneSpacingM,
    }
  }

  /** Where the camera should look for an entity id (container, STS or vessel). */
  entityCentre(id: string, time: number): Vec3 | null {
    if (this.containerSize[id]) return this.containerCentre(id, time)
    if (this.axisSegments[id]) {
      const p = this.stsPose(id, time)
      return { x: p.gantryX, y: 20, z: 10 }
    }
    const spec = this.specs[id]
    if (spec) {
      const p = this.vesselPlacement(id, time)
      if (!p) return null
      return { x: p.x + spec.loaM / 2, y: spec.deckHeightM, z: p.zOffset - spec.beamM / 2 }
    }
    return null
  }
}
