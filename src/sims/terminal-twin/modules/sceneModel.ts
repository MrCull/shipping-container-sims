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
  ascIdOf,
  ascStartZ,
  blockSpecs,
  boxSpan,
  buildLaneGraph,
  hasLandside,
  landsideGraphOf,
  parseYardSlotId,
  positionAt,
  railEndZ,
  railSegmentIds,
  railSegmentSpan,
  railStartZ,
  rowX,
  slotZ,
  tierBaseY,
  travelHoistM,
  TRUCK_DECK_M,
  type BlockSpec,
  type Axis,
  type CustodyRef,
  type LaneGraph,
  type LandsideGraph,
  type MotionSegment,
  type Reservation,
} from '../engine'
import { planCargo } from '../scenario/bayPlan'
import { planExportYard } from '../scenario/exportYard'
import type { ContainerSize, ScenarioConfig, VesselConfig } from '../scenario/types'
import {
  parseVesselSlotId,
  slotCentre,
  vesselClass,
  type VesselClassSpec,
} from '../scenario/vesselClasses'
import type { Delta, NewContainer } from '../worker/protocol'

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

const AXES: Axis[] = ['gantry', 'trolley', 'hoist', 'x', 'z', 'lift']

/** Where an ASC's spreader is: gantry along Z, trolley along X, hoist = box bottom height. */
export interface AscPose {
  x: number
  z: number
  hoistY: number
}

export interface ShcPose {
  x: number
  z: number
  /** Box bottom height above ground (spreader lift). */
  lift: number
  /** Direction of travel: along X (yaw 0) or along Z (yaw π/2). */
  heading: 'x' | 'z'
  /** Body yaw (rad about +Y, three.js sense; 0 = front towards +X, -π/2 = towards +Z), swinging through corners. */
  yaw: number
  /** Steering angle of the front wheel pairs (rad); the rear pairs steer the opposite way. */
  steerRad: number
  /** Signed distance rolled along the heading since the start (m): wheel roll angle = odometerM / tyre radius. */
  odometerM: number
  /** True while an X or Z motion segment is in progress. */
  travelling: boolean
}

/** [A] A corner takes this long to swing through (shortened on very short legs); peak steer angle. */
const TURN_S = 2
const MAX_STEER_RAD = (35 * Math.PI) / 180

/** One X/Z leg with the heading it was driven at, precomputed on ingest. */
interface DriveLeg {
  t0: number
  t1: number
  axis: 'x' | 'z'
  from: number
  to: number
  yaw0: number
  yaw1: number
  /** +1 driving forwards, -1 backing up (a reversal of more than 135° is driven in reverse). */
  fwd: 1 | -1
  odoStart: number
  seg: MotionSegment
}

const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

/** Where a truck is (plan view, origin = the centre of the box on its chassis) and how its body is turned. */
export interface TruckPose {
  x: number
  z: number
  /** Body yaw (rad about +Y, three.js sense; 0 = front towards +X, π/2 = towards -Z, the gate queue's heading). */
  yaw: number
  steerRad: number
  /** Signed distance rolled since the start (m): wheel roll angle = odometerM / tyre radius. */
  odometerM: number
  travelling: boolean
  /** In the scene: it has arrived at the gate and has not left yet. */
  visible: boolean
}

/** A container's centre and its yaw (0 = length along X, π/2 = along Z). */
export interface ContainerPose extends Vec3 {
  yaw: number
  /** SHC id when the container is carried by an SHC (the renderer hangs it from that SHC's spreader). */
  carriedBy?: string
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
  readonly seed: number
  readonly containerIds: string[]
  readonly containerSize: Record<string, ContainerSize>
  readonly containerLine: Record<string, string>
  readonly graph: LaneGraph
  /** Landside roads, gate and stalls (null without a landside). */
  readonly landside: LandsideGraph | null
  /** Trucks the scene knows (arrived and not pruned after leaving), in arrival order. */
  readonly truckIds: string[] = []
  private readonly vessels: Record<string, VesselConfig>
  private readonly blocks: Record<string, BlockSpec>
  private readonly specs: Record<string, VesselClassSpec>
  private readonly anchorageSlot: Record<string, number>
  private readonly initialPose: Record<string, StsPose>
  private readonly initialShc: Record<string, { x: number; z: number }>
  private readonly initialAsc: Record<string, AscPose> = {}
  private reservations: Record<string, Reservation[]> = {}
  private axisSegments: Record<string, Record<Axis, MotionSegment[]>> = {}
  private drives: Record<string, DriveLeg[]> = {}
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
    for (const s of config.sts) this.axisSegments[s.id] = emptyAxes()
    this.graph = buildLaneGraph(config)
    this.landside = hasLandside(config) ? landsideGraphOf(config) : null
    this.blocks = Object.fromEntries(blockSpecs(config).map((b) => [b.id, b]))
    const ascCount = config.yard?.ascsPerBlock ?? 1
    for (const b of Object.values(this.blocks)) {
      for (let n = 1; n <= ascCount; n++) {
        const id = ascIdOf(b.id, n)
        this.axisSegments[id] = emptyAxes()
        this.initialAsc[id] = { x: b.x, z: ascCount === 1 ? b.wtpZ : ascStartZ(b, n), hoistY: travelHoistM(b) }
        this.status[`asc:${id}`] = [{ t: 0, status: 'idle' }]
      }
    }
    this.initialShc = {}
    for (const shc of config.shcs ?? []) {
      this.axisSegments[shc.id] = emptyAxes()
      this.drives[shc.id] = []
      const n = this.graph.nodes[this.graph.parkingNode[shc.id]]
      this.initialShc[shc.id] = { x: n.x, z: n.z }
      this.status[`shc:${shc.id}`] = [{ t: 0, status: 'parked' }]
    }
    // export boxes start in the stacks (TT-10); discharge boxes on board
    const exportSlot = new Map(planExportYard(config, cargo).map((p) => [p.containerId, p.slotId]))
    for (const c of cargo.containers) {
      const owner: CustodyRef =
        c.flow !== 'discharge' ? { kind: 'yardSlot', id: exportSlot.get(c.id) as string } : { kind: 'vesselSlot', id: c.slotId }
      this.custody[c.id] = [{ t: 0, owner }]
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

  /** The ASCs of every yard block, waterside first (present whenever blocks exist; idle if the ASC subsystem is off). */
  get ascIds(): string[] {
    return Object.keys(this.initialAsc)
  }

  /** The block an ASC works. */
  blockOfAsc(ascId: string): BlockSpec {
    return this.blocks[ascId.replace(/-ASC\d+$/, '')]
  }

  /** The rail segments of a block's ASC rail (zone ids as in the engine's reservations), waterside first. */
  railSegments(blockId: string): { zone: string; z0: number; z1: number }[] {
    const b = this.blocks[blockId]
    const ids = railSegmentIds(b, railStartZ(b), railEndZ(b))
    return ids.map((zone) => {
      const [z0, z1] = railSegmentSpan(b, Number(zone.slice(zone.lastIndexOf(':R') + 2)))
      return { zone, z0, z1 }
    })
  }

  get blockList(): BlockSpec[] {
    return Object.values(this.blocks)
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

  /** A box created during the run (a truck brought it). */
  private addContainer(c: NewContainer): void {
    if (this.containerSize[c.id]) return
    this.containerIds.push(c.id)
    this.containerSize[c.id] = c.size
    this.containerLine[c.id] = c.line
    this.custody[c.id] = []
  }

  /** Start tracking a truck the first time the engine mentions it. */
  private ensureTruck(id: string): void {
    if (this.axisSegments[id]) return
    this.axisSegments[id] = emptyAxes()
    this.drives[id] = []
    this.status[`truck:${id}`] = []
    this.truckIds.push(id)
  }

  apply(delta: Delta): void {
    for (const c of delta.newContainers ?? []) this.addContainer(c)
    for (const e of delta.entities) if (e.kind === 'truck') this.ensureTruck(e.id)
    for (const plan of delta.motion) if (this.landside && /^T\d+$/.test(plan.entityId)) this.ensureTruck(plan.entityId)
    for (const plan of delta.motion) {
      const axes = this.axisSegments[plan.entityId]
      if (!axes) continue
      for (const seg of plan.segments) {
        axes[seg.axis].push(seg)
        if (this.drives[plan.entityId] && (seg.axis === 'x' || seg.axis === 'z')) this.addDrive(plan.entityId, seg)
      }
    }
    for (const c of delta.custody) {
      this.custody[c.containerId]?.push({ t: c.t, owner: c.owner, x: c.x, dx: c.dx })
    }
    for (const e of delta.entities) this.status[`${e.kind}:${e.id}`]?.push({ t: e.t, status: e.status, berthX: e.berthX })
    for (const r of delta.reservations ?? []) (this.reservations[r.zone] ??= []).push(r)
  }

  /** Records an X/Z leg with its heading, swing and direction of rolling (legs arrive in time order). */
  private addDrive(shcId: string, seg: MotionSegment): void {
    const list = this.drives[shcId]
    const d = seg.to - seg.from
    if (d === 0) return
    const prev = list[list.length - 1]
    const yawPrev = prev ? prev.yaw1 : this.truckIds.includes(shcId) ? Math.PI / 2 : 0
    const target = seg.axis === 'x' ? (d > 0 ? 0 : Math.PI) : d > 0 ? -Math.PI / 2 : Math.PI / 2
    const delta = wrapPi(target - yawPrev)
    const reverse = Math.abs(delta) > (3 * Math.PI) / 4
    const odoPrev = prev ? prev.odoStart + prev.fwd * Math.abs(prev.to - prev.from) : 0
    list.push({
      t0: seg.t0,
      t1: seg.t1,
      axis: seg.axis as 'x' | 'z',
      from: seg.from,
      to: seg.to,
      yaw0: yawPrev,
      yaw1: reverse ? yawPrev : yawPrev + delta,
      fwd: reverse ? -1 : 1,
      odoStart: odoPrev,
      seg,
    })
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
    for (const list of Object.values(this.drives)) {
      const i = lastAtOrBefore(list, time, (l) => l.t0)
      if (i > 0) list.splice(0, i)
    }
    for (const [zone, list] of Object.entries(this.reservations)) this.reservations[zone] = list.filter((r) => r.to >= time)
    // trucks that left before `time` are not drawn any more: forget them
    for (const id of [...this.truckIds]) {
      const list = this.status[`truck:${id}`] ?? []
      const last = list[list.length - 1]
      if (!last || last.status !== 'gone' || last.t >= time) continue
      this.truckIds.splice(this.truckIds.indexOf(id), 1)
      delete this.axisSegments[id]
      delete this.drives[id]
      delete this.status[`truck:${id}`]
    }
  }

  /** Where a truck is at `time` (the spawn point at the gate before its first move). */
  truckPose(id: string, time: number): TruckPose {
    const axes = this.axisSegments[id]
    const gate = this.landside?.gate
    const value = (axis: Axis, initial: number) => {
      const list = axes?.[axis] ?? []
      if (list.length === 0) return initial
      const i = lastAtOrBefore(list, time, (s) => s.t0)
      return i < 0 ? list[0].from : positionAt(list[i], time)
    }
    const list = this.status[`truck:${id}`] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    const visible = i >= 0 && list[i].status !== 'gone'
    const drive = this.driveState(id, time)
    const resting = this.drives[id]?.length ? drive : { ...drive, yaw: Math.PI / 2 }
    return { x: value('x', gate?.queueX ?? 0), z: value('z', gate?.spawnZ ?? 0), ...resting, visible }
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
      ...this.driveState(shcId, time),
    }
  }

  /** Yaw, steering, wheel odometer and whether the SHC is driving, from the precomputed legs. */
  private driveState(shcId: string, time: number): Pick<ShcPose, 'yaw' | 'steerRad' | 'odometerM' | 'travelling'> {
    const list = this.drives[shcId] ?? []
    const i = lastAtOrBefore(list, time, (l) => l.t0)
    if (i < 0) return { yaw: 0, steerRad: 0, odometerM: 0, travelling: false }
    const leg = list[i]
    const swing = leg.yaw1 - leg.yaw0
    const turnS = Math.max(1e-6, Math.min(TURN_S, (leg.t1 - leg.t0) * 0.6))
    const p = Math.min(1, Math.max(0, (time - leg.t0) / turnS))
    const smooth = p * p * (3 - 2 * p)
    const turning = Math.abs(swing) > 1e-6 && p < 1
    const travelled = Math.abs(positionAt(leg.seg, time) - leg.from)
    return {
      yaw: leg.yaw0 + swing * smooth,
      steerRad: turning ? Math.sign(swing) * MAX_STEER_RAD * Math.sin(Math.PI * p) : 0,
      odometerM: leg.odoStart + leg.fwd * travelled,
      travelling: time < leg.t1,
    }
  }

  ascPose(ascId: string, time: number): AscPose {
    const axes = this.axisSegments[ascId]
    const start = this.initialAsc[ascId] ?? { x: 0, z: 0, hoistY: 0 }
    const value = (axis: Axis, initial: number) => {
      const list = axes?.[axis] ?? []
      if (list.length === 0) return initial
      const i = lastAtOrBefore(list, time, (s) => s.t0)
      return i < 0 ? list[0].from : positionAt(list[i], time)
    }
    return { x: value('trolley', start.x), z: value('gantry', start.z), hoistY: value('hoist', start.hoistY) }
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

  statusAt(kind: 'sts' | 'vessel' | 'shc' | 'asc' | 'truck', id: string, time: number): string {
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
      return { x: p.x, y: p.lift + dims.height / 2, z: p.z, yaw: p.yaw, carriedBy: id }
    }
    if (kind === 'external') return null
    if (kind === 'truck') {
      const p = this.truckPose(id, time)
      return p.visible ? { x: p.x, y: TRUCK_DECK_M + dims.height / 2, z: p.z, yaw: p.yaw } : null
    }
    if (kind === 'wtpPad') {
      const pad = this.graph.pads.find((p) => p.id === id)
      return pad ? { x: pad.x, y: dims.height / 2, z: pad.z, yaw: alongZ } : null
    }
    if (kind === 'asc') {
      const p = this.ascPose(id, time)
      return { x: p.x, y: p.hoistY + dims.height / 2, z: p.z, yaw: alongZ, carriedBy: id }
    }
    if (kind === 'yardSlot') {
      const cell = parseYardSlotId(id)
      const block = this.blocks[cell.blockId]
      if (!block) return null
      const span = boxSpan(this.containerSize[containerId])
      return {
        x: rowX(block, cell.row),
        y: tierBaseY(cell.tier) + dims.height / 2,
        z: slotZ(block, cell.bay, span),
        yaw: alongZ,
      }
    }
    if (kind === 'vesselSlot') {
      const slot = parseVesselSlotId(id)
      const placement = this.vesselPlacement(slot.vesselId, time)
      if (!placement) return null
      const c = slotCentre(this.specs[slot.vesselId], placement.x, slot, this.containerSize[containerId])
      return { x: c.x, y: c.y, z: c.z + placement.zOffset, yaw: 0 }
    }
    if (kind === 'sts') {
      const pose = this.stsPose(id, time)
      return { x: pose.gantryX + (entry.dx ?? 0), y: pose.hoistY - dims.height / 2, z: pose.trolleyZ, yaw: 0 }
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
    if (this.initialAsc[id]) {
      const p = this.ascPose(id, time)
      return { x: p.x, y: 6, z: p.z }
    }
    if (this.truckIds.includes(id)) {
      const p = this.truckPose(id, time)
      return p.visible ? { x: p.x, y: 2, z: p.z } : null
    }
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
