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
import {
  buildLaneGraph,
  positionAt,
  type Axis,
  type CustodyRef,
  type LaneGraph,
  type MotionSegment,
  type Reservation,
} from '../engine'
import type { ContainerSize, ScenarioConfig, VesselConfig } from '../scenario/types'
import type { Delta } from '../worker/protocol'

/** [A] ISO container outer dimensions (m): length, height, width. */
export const CONTAINER_DIMS: Record<ContainerSize, { length: number; height: number; width: number }> = {
  '20': { length: 6.058, height: 2.591, width: 2.438 },
  '40': { length: 12.192, height: 2.591, width: 2.438 },
  '40HC': { length: 12.192, height: 2.896, width: 2.438 },
}
/** [A] Matches the engine's vessel tier pitch. */
const TIER_HEIGHT_M = 2.591
/** [A] Yard stub layout: 8 rows across the block, bays along Z beyond the WTP strip. */
const YARD = { rows: 8, rowPitchM: 2.9, bayPitchM: 12.8, bays: 10, firstBayGapM: 14 }

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
}

interface StatusEntry {
  t: number
  status: string
}

const AXES: Axis[] = ['gantry', 'trolley', 'hoist', 'x', 'z', 'lift']

export interface ShcPose {
  x: number
  z: number
  /** Box bottom height above ground (spreader lift). */
  lift: number
  /** Direction of travel: along X (yaw 0) or along Z (yaw π/2). */
  heading: 'x' | 'z'
}

/** A container's centre and its yaw (0 = length along X, π/2 = along Z). */
export interface ContainerPose extends Vec3 {
  yaw: number
}

const emptyAxes = (): Record<Axis, MotionSegment[]> => ({ gantry: [], trolley: [], hoist: [], x: [], z: [], lift: [] })

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
  readonly containerIds: string[]
  readonly containerSize: Record<string, ContainerSize>
  readonly containerLine: Record<string, string>
  readonly graph: LaneGraph
  private readonly vessels: Record<string, VesselConfig>
  private readonly blocks: Record<string, { x: number }>
  private readonly initialPose: Record<string, StsPose>
  private readonly initialShc: Record<string, { x: number; z: number }>
  private reservations: Record<string, Reservation[]> = {}
  private axisSegments: Record<string, Record<Axis, MotionSegment[]>> = {}
  private custody: Record<string, CustodyEntry[]> = {}
  private status: Record<string, StatusEntry[]> = {}

  constructor(config: ScenarioConfig) {
    this.config = config
    this.containerIds = config.containers.map((c) => c.id)
    this.containerSize = Object.fromEntries(config.containers.map((c) => [c.id, c.size]))
    this.containerLine = Object.fromEntries(config.containers.map((c) => [c.id, c.line]))
    this.vessels = Object.fromEntries(config.vessels.map((v) => [v.id, v]))
    this.initialPose = Object.fromEntries(
      config.sts.map((s) => [
        s.id,
        { gantryX: s.gantryX, trolleyZ: config.layout.stsGroundLaneZ0M, hoistY: config.layout.stsSafeHoistM },
      ]),
    )
    for (const s of config.sts) this.axisSegments[s.id] = emptyAxes()
    this.graph = buildLaneGraph(config)
    this.blocks = Object.fromEntries((config.yard?.blocks ?? []).map((b) => [b.id, { x: b.x }]))
    this.initialShc = {}
    for (const shc of config.shcs ?? []) {
      this.axisSegments[shc.id] = emptyAxes()
      const n = this.graph.nodes[this.graph.parkingNode[shc.id]]
      this.initialShc[shc.id] = { x: n.x, z: n.z }
      this.status[`shc:${shc.id}`] = [{ t: 0, status: 'parked' }]
    }
    for (const c of config.containers) {
      const slot = `${c.initial.vesselId}:${[c.initial.bay, c.initial.row, c.initial.tier]
        .map((n) => String(n).padStart(2, '0'))
        .join('-')}`
      this.custody[c.id] = [{ t: 0, owner: { kind: 'vesselSlot', id: slot } }]
    }
    for (const v of config.vessels) this.status[`vessel:${v.id}`] = [{ t: 0, status: 'scheduled' }]
    for (const s of config.sts) this.status[`sts:${s.id}`] = [{ t: 0, status: 'idle' }]
  }

  get stsIds(): string[] {
    return this.config.sts.map((s) => s.id)
  }

  get shcIds(): string[] {
    return (this.config.shcs ?? []).map((s) => s.id)
  }

  get vesselIds(): string[] {
    return this.config.vessels.map((v) => v.id)
  }

  vesselConfig(id: string): VesselConfig {
    return this.vessels[id]
  }

  apply(delta: Delta): void {
    for (const plan of delta.motion) {
      const axes = this.axisSegments[plan.entityId]
      if (!axes) continue
      for (const seg of plan.segments) axes[seg.axis].push(seg)
    }
    for (const c of delta.custody) {
      this.custody[c.containerId]?.push({ t: c.t, owner: c.owner, x: c.x })
    }
    for (const e of delta.entities) this.status[`${e.kind}:${e.id}`]?.push({ t: e.t, status: e.status })
    for (const r of delta.reservations ?? []) (this.reservations[r.zone] ??= []).push(r)
  }

  /** Reservations active at `time` (zone → holder). */
  activeReservations(time: number): Record<string, string> {
    const active: Record<string, string> = {}
    for (const [zone, list] of Object.entries(this.reservations)) {
      const r = list.find((x) => x.from <= time && time < x.to)
      if (r) active[zone] = r.holder
    }
    return active
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
    for (const [zone, list] of Object.entries(this.reservations)) this.reservations[zone] = list.filter((r) => r.to >= time)
  }

  shcPose(shcId: string, time: number): ShcPose {
    const axes = this.axisSegments[shcId]
    const start = this.initialShc[shcId] ?? { x: 0, z: 0 }
    const last = (axis: Axis) => {
      const list = axes?.[axis] ?? []
      return { list, i: lastAtOrBefore(list, time, (s) => s.t0) }
    }
    const value = (axis: Axis, initial: number) => {
      const { list, i } = last(axis)
      if (list.length === 0) return initial
      return i < 0 ? list[0].from : positionAt(list[i], time)
    }
    const lx = last('x')
    const lz = last('z')
    const tx = lx.i >= 0 ? lx.list[lx.i].t0 : -Infinity
    const tz = lz.i >= 0 ? lz.list[lz.i].t0 : -Infinity
    return {
      x: value('x', start.x),
      z: value('z', start.z),
      lift: value('lift', 0),
      heading: tz > tx ? 'z' : 'x',
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

  statusAt(kind: 'sts' | 'vessel' | 'shc', id: string, time: number): string {
    const list = this.status[`${kind}:${id}`] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    return i < 0 ? 'unknown' : list[i].status
  }

  vesselVisible(id: string, time: number): boolean {
    return this.statusAt('vessel', id, time) === 'berthed'
  }

  custodyAt(containerId: string, time: number): CustodyRef | null {
    const list = this.custody[containerId] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    return i < 0 ? null : list[i].owner
  }

  /** Centre of a container at `time`, or null if it is not in the scene. */
  containerCentre(containerId: string, time: number): Vec3 | null {
    const pose = this.containerPose(containerId, time)
    return pose && { x: pose.x, y: pose.y, z: pose.z }
  }

  /** Centre and yaw of a container at `time`, or null if it is not in the scene. */
  containerPose(containerId: string, time: number): ContainerPose | null {
    const list = this.custody[containerId] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    if (i < 0) return null
    const entry = list[i]
    const dims = CONTAINER_DIMS[this.containerSize[containerId]]
    const { kind, id } = entry.owner
    const alongZ = Math.PI / 2
    if (kind === 'shc') {
      const p = this.shcPose(id, time)
      return { x: p.x, y: p.lift + dims.height / 2, z: p.z, yaw: p.heading === 'z' ? alongZ : 0 }
    }
    if (kind === 'wtpPad') {
      const pad = this.graph.pads.find((p) => p.id === id)
      return pad ? { x: pad.x, y: dims.height / 2, z: pad.z, yaw: alongZ } : null
    }
    if (kind === 'asc' || kind === 'yardSlot') {
      const blockId = kind === 'asc' ? id.replace(/-ASC\d+$/, '') : id.split(':')[0]
      const block = this.blocks[blockId]
      if (!block) return null
      const n = kind === 'yardSlot' ? Number(id.split(':I')[1] ?? 1) - 1 : 0
      const row = n % YARD.rows
      const bay = Math.floor(n / YARD.rows) % YARD.bays
      const tier = Math.floor(n / (YARD.rows * YARD.bays))
      const lift = kind === 'asc' ? 6 : 0
      return {
        x: block.x + (row - (YARD.rows - 1) / 2) * YARD.rowPitchM,
        y: lift + tier * dims.height + dims.height / 2,
        z: this.graph.layout.wtpZ + YARD.firstBayGapM + bay * YARD.bayPitchM,
        yaw: alongZ,
      }
    }
    if (kind === 'vesselSlot') {
      const [vesselId, rest] = id.split(':')
      const v = this.vessels[vesselId]
      const [bay, row, tier] = rest.split('-').map(Number)
      return {
        x: v.berthX + (bay + 0.5) * v.bayPitchM,
        y: v.deckHeightM + tier * TIER_HEIGHT_M + dims.height / 2,
        z: -(v.fenderGapM + (row + 0.5) * v.rowPitchM),
        yaw: 0,
      }
    }
    if (kind === 'sts') {
      const pose = this.stsPose(id, time)
      return { x: pose.gantryX, y: pose.hoistY - dims.height / 2, z: pose.trolleyZ, yaw: 0 }
    }
    // Ground position "<stsId>-GP<n>" (1-based lane).
    const lane = Number(id.slice(id.lastIndexOf('GP') + 2)) - 1
    const { layout } = this.config
    return {
      x: entry.x ?? 0,
      y: dims.height / 2,
      z: layout.stsGroundLaneZ0M + lane * layout.stsGroundLaneSpacingM,
      yaw: 0,
    }
  }

  /** Where the camera should look for an entity id (container, STS, SHC or vessel). */
  entityCentre(id: string, time: number): Vec3 | null {
    if (this.containerSize[id]) return this.containerCentre(id, time)
    if (this.initialShc[id]) {
      const p = this.shcPose(id, time)
      return { x: p.x, y: 3, z: p.z }
    }
    if (this.axisSegments[id]) {
      const p = this.stsPose(id, time)
      return { x: p.gantryX, y: 20, z: 10 }
    }
    const v = this.vessels[id]
    if (v) return { x: v.berthX + (v.bays * v.bayPitchM) / 2, y: v.deckHeightM, z: -(v.fenderGapM + (v.rows * v.rowPitchM) / 2) }
    return null
  }
}
