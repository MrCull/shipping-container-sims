/**
 * Scene model: the renderer's view of the run, built from worker Deltas.
 * Pure TS (no Three.js). It keeps per-entity timelines (motion segments per
 * crane axis, custody per container, status per vessel/STS) so any display
 * time at or before the engine horizon can be drawn exactly, that is what
 * keeps animation smooth at any speed.
 *
 * Scene conventions: 1 unit = 1 m, Y up, quay edge at Z = 0, sea at -Z,
 * yard at +Z, X along the quay.
 */
import {
  ascIdOf,
  ascStartZ,
  blockSpecs,
  BAY_PITCH_M,
  boxSpan,
  buildLaneGraph,
  hasLandside,
  hatchEnabled,
  landsideGraphOf,
  laydownCentreZ,
  laydownTopY,
  parseYardSlotId,
  positionAt,
  railEndZ,
  railSegmentIds,
  railSegmentSpan,
  railStartZ,
  prefillOf,
  type PrefillImport,
  rowX,
  slotZ,
  tierBaseY,
  travelHoistM,
  TRUCK_DECK_M,
  type BlockSpec,
  type Axis,
  type ContainerState,
  type CustodyRef,
  type TransitWorld,
  type TruckStatus,
  type VesselStatus,
  type LaneGraph,
  type LandsideGraph,
  type MotionSegment,
  type Reservation,
} from '../engine'
import { planCargo } from '../scenario/bayPlan'
import { isoTypeOf, type ContainerProps } from '../scenario/containerProps'
import { subjectOfBox, type ColourSubject } from './colourBy'
import type { RobBox } from '../scenario/robBays'
import { planExportYard } from '../scenario/exportYard'
import { driveYaw, shcSpawnYaw } from './shcSpawn'
import type { ContainerSize, ScenarioConfig, VesselConfig } from '../scenario/types'
import {
  HATCH_THICKNESS_M,
  hatchPanelId,
  hatchPanelWidthM,
  hatchPanelZ,
  parseVesselSlotId,
  slotCentre,
  slotX,
  vesselClass,
  type VesselClassSpec,
} from '../scenario/vesselClasses'
import type { Delta, HatchPanelChange, NewContainer } from '../worker/protocol'

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

/** A short sound moment (#129): a spreader locking or unlocking, a box landing, a truck braking to a stop. */
export interface SoundShot {
  t: number
  machine: 'sts' | 'asc' | 'shc' | 'truck'
  id: string
  motion: 'locking' | 'unlocking' | 'landing' | 'braking'
  x: number
  y: number
  z: number
}

interface Handoff {
  t: number
  containerId: string
  from: CustodyRef | null
  to: CustodyRef
}

const CARRIER_KINDS = new Set(['sts', 'asc', 'shc'])
/** Handoffs are kept this long (s) behind the display time. */
const HANDOFF_KEEP_S = 5

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
  firstMoveS?: number | null
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
  /** Tractor yaw against the chassis (rad, positive = the cab swings the way the front wheels steer): follows the steering through a turn. */
  articulationRad: number
  /**
   * Where the model sits along its heading (m, truck frame): -3.0675 for a 20 ft box, so that box (drawn at the pose
   * origin) rests on the front twist-locks; 0 for a 40 ft box or no known load (the 40 ft centre is the model origin).
   */
  loadOffsetM: number
}

/** ISO 1161: a single 20 ft box on the front pins of a 40 ft chassis sits 3.0675 m ahead of the 40 ft centre (matches the truck sidecar's `load_20_front`). */
export const TRUCK_BOX20_OFFSET_M = 3.0675
/** [A] Tractor swing per steering radian, and the limit (the truck sidecar's `fifth_wheel` travel). */
const ARTICULATION_GAIN = 1.15
export const MAX_ARTICULATION_RAD = (40 * Math.PI) / 180

/** A hatch panel as the scene draws it (TT-R10): centre, size (length along X, width along Z) and the state it is in. */
export interface HatchPanelPose extends Vec3 {
  status: HatchPanelChange['status']
  lengthM: number
  widthM: number
  thicknessM: number
  /** `lifted`: the crane that holds it. */
  stsId: string | null
}

/** What the scene knows of a hatch panel before any event: its place on the vessel. */
export interface HatchPanelSpec {
  id: string
  vesselId: string
  bay: number
  index: number
  lengthM: number
  widthM: number
}

/** A container's centre and its yaw (0 = length along X, π/2 = along Z). */
export interface ContainerPose extends Vec3 {
  yaw: number
  /** SHC id when the container is carried by an SHC (the renderer hangs it from that SHC's spreader). */
  carriedBy?: string
  /** A stacked yard box (its neighbours hide some of its faces, #143). */
  yard?: true
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

export interface ContainerDetail {
  laden: boolean
  isoType: string
  heavy: boolean
  /** Stored properties (colour by, #130); drawn on first use for a pre-filled import. */
  props?: ContainerProps
  /** Sim time since which the box has stood in the yard (negative: before the run), as in the engine. */
  yardSince?: number
}

export class SceneModel {
  readonly config: ScenarioConfig
  readonly seed: number
  readonly containerIds: string[]
  readonly containerSize: Record<string, ContainerSize>
  readonly containerLine: Record<string, string>
  /** What the close-up markings need beyond size and line (#119). */
  readonly containerDetail: Record<string, ContainerDetail>
  /** Pre-filled imports by id: their properties are drawn when a colour mode first asks. */
  private readonly prefillImports = new Map<string, PrefillImport>()
  private readonly vesselIdSet: ReadonlySet<string>
  /** The carriers' state at `colourT`, for the transit status of `colourSubjectAt`. */
  private colourT = 0
  private readonly colourWorld: TransitWorld = {
    vesselStatus: (id) => this.statusAt('vessel', id, this.colourT) as VesselStatus,
    truckStatus: (id) => this.statusAt('truck', id, this.colourT) as TruckStatus,
  }
  readonly graph: LaneGraph
  /** Landside roads, gate and stalls (null without a landside). */
  readonly landside: LandsideGraph | null
  /** Trucks the scene knows (arrived and not pruned after leaving), in arrival order. */
  readonly truckIds: string[] = []
  /** Size of the box each truck brings or collects (its first leg), as the worker reported it. */
  private truckLoad: Record<string, ContainerSize> = {}
  /** When each known truck first appeared (its arrival at the gate); kept after the status history is pruned. */
  private truckArrival: Record<string, number> = {}
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
  /** Custody changes in time order, for the sound shots; trimmed by `prune`. */
  private handoffs: Handoff[] = []
  private custody: Record<string, CustodyEntry[]> = {}
  private status: Record<string, StatusEntry[]> = {}
  /** Hatch panels of the vessels' bays (TT-R10), in id order; empty with hatch covers off. */
  readonly hatchPanelIds: string[] = []
  /** Display-only ROB boxes of all vessels (spec #106), drawn in the hulls by `VesselHulls`. */
  readonly robBoxes: readonly RobBox[]
  private readonly hatchSpecs: Record<string, HatchPanelSpec> = {}
  /** Per panel: its state changes in time order (a panel with none is secured on its hatch). */
  private hatchTimeline: Record<string, HatchPanelChange[]> = {}

  /** The bay plan is regenerated here from config + seed (the same pure generator the engine uses). */
  constructor(config: ScenarioConfig, seed: number = config.seed) {
    this.config = config
    this.seed = seed
    const cargo = planCargo(config, seed)
    // yard start (TT-14): the pre-fill (same pure planner and default strategy as the engine) or an empty yard (no pool)
    const startMode = config.yardStart?.mode
    const emptyStart = (startMode === 'empty' || startMode === 'warmup') && blockSpecs(config).length > 0
    const prefill = prefillOf(config, cargo, seed)
    if (emptyStart) cargo.containers = cargo.containers.filter((c) => c.flow !== 'pool')
    this.containerIds = cargo.containers.map((c) => c.id)
    this.containerSize = Object.fromEntries(cargo.containers.map((c) => [c.id, c.size]))
    this.containerLine = Object.fromEntries(cargo.containers.map((c) => [c.id, c.line]))
    this.containerDetail = Object.fromEntries(
      cargo.containers.map((c) => [c.id, { laden: c.full, isoType: c.props?.isoType ?? isoTypeOf(c.size, c.reefer === true), heavy: c.props?.weightClass === 'HEAVY', props: c.props }]),
    )
    for (const imp of prefill?.imports ?? []) {
      this.containerIds.push(imp.id)
      this.containerSize[imp.id] = imp.size
      this.containerLine[imp.id] = imp.line
      this.containerDetail[imp.id] = { laden: true, isoType: imp.props.isoType, heavy: imp.props.weightClass === 'HEAVY', yardSince: -imp.ageS, props: imp.props }
      this.prefillImports.set(imp.id, imp)
    }
    this.vessels = Object.fromEntries(config.vessels.map((v) => [v.id, v]))
    this.vesselIdSet = new Set(config.vessels.map((v) => v.id))
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
    const placements = prefill ? prefill.placements : emptyStart ? [] : planExportYard(config, cargo)
    const exportSlot = new Map(placements.map((p) => [p.containerId, p.slotId]))
    for (const c of cargo.containers) {
      const owner: CustodyRef =
        c.flow === 'discharge'
          ? { kind: 'vesselSlot', id: c.slotId }
          : emptyStart
            ? { kind: 'external', id: 'outside' } // booked exports wait outside until a truck brings them
            : { kind: 'yardSlot', id: exportSlot.get(c.id) as string }
      this.custody[c.id] = [{ t: 0, owner }]
    }
    for (const imp of prefill?.imports ?? []) this.custody[imp.id] = [{ t: 0, owner: { kind: 'yardSlot', id: exportSlot.get(imp.id) as string } }]
    this.robBoxes = cargo.rob
    if (hatchEnabled(config)) this.createHatchPanels(cargo.slots, cargo.robBays)
    for (const v of config.vessels) this.status[`vessel:${v.id}`] = [{ t: 0, status: 'scheduled' }]
    for (const s of config.sts) this.status[`sts:${s.id}`] = [{ t: 0, status: 'idle' }]
  }

  /** One panel per hatch panel position of every bay that has a slot (the engine's `createHatchPanels`). */
  private createHatchPanels(slots: readonly { vesselId: string; bay: number }[], robBays: Record<string, number[]>): void {
    const bays = new Map<string, Set<number>>()
    for (const slot of slots) {
      let set = bays.get(slot.vesselId)
      if (!set) bays.set(slot.vesselId, (set = new Set()))
      set.add(slot.bay)
    }
    for (const [id, list] of Object.entries(robBays)) {
      let set = bays.get(id)
      if (!set) bays.set(id, (set = new Set()))
      for (const bay of list) set.add(bay)
    }
    for (const v of this.config.vessels) {
      const spec = this.specs[v.id]
      const settings = spec.hatch // the scenario overrides only timings and the stack limit, never the panels
      for (const bay of [...(bays.get(v.id) ?? [])].sort((a, b) => a - b)) {
        for (let index = 0; index < settings.panels; index++) {
          const id = hatchPanelId(v.id, bay, index)
          this.hatchPanelIds.push(id)
          this.hatchSpecs[id] = { id, vesselId: v.id, bay, index, lengthM: settings.panelLengthM, widthM: hatchPanelWidthM(spec, index) }
          this.hatchTimeline[id] = []
        }
      }
    }
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

  /** The ROB boxes of one vessel (spec #106): what its hull draws. */
  robBoxesOf(vesselId: string): RobBox[] {
    return this.robBoxes.filter((b) => b.vesselId === vesselId)
  }

  /** A box created during the run (a truck brought it). */
  private addContainer(c: NewContainer): void {
    if (this.containerSize[c.id]) return
    this.containerIds.push(c.id)
    this.containerSize[c.id] = c.size
    this.containerLine[c.id] = c.line
    this.containerDetail[c.id] = { laden: c.full ?? true, isoType: c.isoType ?? isoTypeOf(c.size, false), heavy: c.heavy ?? false, props: c.props }
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
      const list = this.custody[c.containerId]
      if (!list) continue
      this.handoffs.push({ t: c.t, containerId: c.containerId, from: list.length > 0 ? list[list.length - 1].owner : null, to: c.owner })
      list.push({ t: c.t, owner: c.owner, x: c.x, dx: c.dx })
    }
    for (const e of delta.entities) {
      this.status[`${e.kind}:${e.id}`]?.push({ t: e.t, status: e.status, berthX: e.berthX, firstMoveS: e.firstMoveS })
      if (e.kind === 'truck') this.truckArrival[e.id] ??= e.t
      if (e.kind === 'truck' && e.loadSize) this.truckLoad[e.id] = e.loadSize
    }
    for (const r of delta.reservations ?? []) (this.reservations[r.zone] ??= []).push(r)
    for (const h of delta.hatch ?? []) this.hatchTimeline[h.panelId]?.push(h)
  }

  /** Records an X/Z leg with its heading, swing and direction of rolling (legs arrive in time order). */
  private addDrive(shcId: string, seg: MotionSegment): void {
    const list = this.drives[shcId]
    const d = seg.to - seg.from
    if (d === 0) return
    const prev = list[list.length - 1]
    const target = driveYaw(seg.axis as 'x' | 'z', seg.from, seg.to)
    // a truck appears facing its first drive (the access road, #146: north; the terminal road: towards the gate);
    // a shuttle carrier too (#142), so its first move needs no turn on the spot
    const yawPrev = prev ? prev.yaw1 : this.truckIds.includes(shcId) ? (seg.axis === 'x' ? target : Math.PI / 2) : shcSpawnYaw({ axis: seg.axis as 'x' | 'z', from: seg.from, to: seg.to })
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
    for (const list of Object.values(this.hatchTimeline)) {
      const i = lastAtOrBefore(list, time, (e) => e.t)
      if (i > 0) list.splice(0, i)
    }
    for (const list of [...Object.values(this.custody), ...Object.values(this.status)]) {
      const i = lastAtOrBefore(list, time, (e: { t: number }) => e.t)
      if (i > 0) list.splice(0, i)
    }
    for (const list of Object.values(this.drives)) {
      const i = lastAtOrBefore(list, time, (l) => l.t0)
      if (i > 0) list.splice(0, i)
    }
    const keep = this.handoffs.findIndex((h) => h.t >= time - HANDOFF_KEEP_S)
    if (keep !== 0) this.handoffs.splice(0, keep < 0 ? this.handoffs.length : keep)
    for (const [zone, list] of Object.entries(this.reservations)) this.reservations[zone] = list.filter((r) => r.to >= time)
    // trucks that left before `time` are not drawn any more: forget them
    for (const id of [...this.truckIds]) {
      const list = this.status[`truck:${id}`] ?? []
      const last = list[list.length - 1]
      if (!last || last.status !== 'gone' || last.t >= time) continue
      this.truckIds.splice(this.truckIds.indexOf(id), 1)
      delete this.truckLoad[id]
      delete this.truckArrival[id]
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
    const articulationRad = Math.max(-MAX_ARTICULATION_RAD, Math.min(MAX_ARTICULATION_RAD, resting.steerRad * ARTICULATION_GAIN))
    const loadOffsetM = this.truckLoad[id] === '20' ? -TRUCK_BOX20_OFFSET_M : 0
    return { x: value('x', gate?.queueX ?? 0), z: value('z', gate?.spawnZ ?? 0), ...resting, visible, articulationRad, loadOffsetM }
  }

  /** The truck that arrives next at or after `time` (earliest known arrival; the engine may already be ahead of the display), or null when none is known yet. */
  nextTruckArrival(time: number): { id: string; t: number } | null {
    let best: { id: string; t: number } | null = null
    for (const id of this.truckIds) {
      const t = this.truckArrival[id]
      if (t !== undefined && t >= time && (!best || t < best.t)) best = { id, t }
    }
    return best
  }

  /** Where a truck is in its visit at `time`: not yet arrived, in the terminal, or gone (also for an id the scene does not know). */
  truckPhase(id: string, time: number): 'waiting' | 'present' | 'gone' {
    if (!this.truckIds.includes(id)) return 'gone'
    const list = this.status[`truck:${id}`] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    if (i < 0) return 'waiting'
    return list[i].status === 'gone' ? 'gone' : 'present'
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
    // before the first leg: facing it (#142), or along the parking row towards the work when none is known yet
    if (i < 0) return { yaw: list.length > 0 && !this.truckIds.includes(shcId) ? list[0].yaw0 : shcSpawnYaw(null), steerRad: 0, odometerM: 0, travelling: false }
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

  /** True while the STS or ASC `id` travels along its rails at `time` (a gantry-axis segment is in progress). Drives the gantry alarm and beacons. */
  isGantrying(id: string, time: number): boolean {
    const list = this.axisSegments[id]?.gantry ?? []
    const i = lastAtOrBefore(list, time, (s) => s.t0)
    return i >= 0 && time < list[i].t1 && list[i].from !== list[i].to
  }

  /** True while an STS or ASC trolley or hoist segment is in progress at `time` (the motor and cable whine). */
  isWorking(id: string, time: number): boolean {
    const axes = this.axisSegments[id]
    if (!axes) return false
    return (['trolley', 'hoist'] as const).some((axis) => {
      const list = axes[axis]
      const i = lastAtOrBefore(list, time, (s) => s.t0)
      return i >= 0 && time < list[i].t1 && list[i].from !== list[i].to
    })
  }

  private driveLegAt(id: string, time: number): DriveLeg | null {
    const list = this.drives[id]
    if (!list) return null
    const i = lastAtOrBefore(list, time, (l) => l.t0)
    return i >= 0 && time < list[i].t1 ? list[i] : null
  }

  /** True while an SHC or truck is under way (a drive leg is in progress). */
  isDriving(id: string, time: number): boolean {
    return this.driveLegAt(id, time) !== null
  }

  /** True while an SHC or truck backs up (a drive leg against its heading, with no turn): the reversing beeper. */
  isReversing(id: string, time: number): boolean {
    return this.driveLegAt(id, time)?.fwd === -1
  }

  /**
   * The sound moments in `(t0, t1]`: a box picked up (spreader locks) or set down (unlocks and lands) by an STS, ASC
   * or SHC, and a truck's drive leg ending (air brake). Windowed rather than asked at a time, so a short sound is
   * still found when playback is fast and a frame spans many seconds.
   */
  shotsBetween(t0: number, t1: number): SoundShot[] {
    const out: SoundShot[] = []
    let lo = 0
    let hi = this.handoffs.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.handoffs[mid].t <= t0) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < this.handoffs.length && this.handoffs[i].t <= t1; i++) {
      const h = this.handoffs[i]
      const fromCarrier = h.from && CARRIER_KINDS.has(h.from.kind) && !(h.to.kind === h.from.kind && h.to.id === h.from.id)
      const toCarrier = CARRIER_KINDS.has(h.to.kind) && !(h.from && h.to.kind === h.from.kind && h.to.id === h.from.id)
      const at = this.containerCentre(h.containerId, h.t) // where the box is at the change: under the new owner
      if (!at) continue
      if (toCarrier) out.push({ t: h.t, machine: h.to.kind as SoundShot['machine'], id: h.to.id, motion: 'locking', ...at })
      if (fromCarrier && h.from) {
        out.push({ t: h.t, machine: h.from.kind as SoundShot['machine'], id: h.from.id, motion: 'unlocking', ...at })
        if (!toCarrier) out.push({ t: h.t, machine: h.from.kind as SoundShot['machine'], id: h.from.id, motion: 'landing', ...at })
      }
    }
    for (const id of this.truckIds) {
      for (const leg of this.drives[id] ?? []) {
        if (leg.t1 <= t0 || leg.t1 > t1) continue
        const p = this.truckPose(id, leg.t1)
        out.push({ t: leg.t1, machine: 'truck', id, motion: 'braking', x: p.x, y: 1.5, z: p.z })
      }
    }
    return out
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

  /** The panel's state change in force at `time` (undefined = secured since the start). */
  private hatchEntry(id: string, time: number): HatchPanelChange | undefined {
    const list = this.hatchTimeline[id] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    return i < 0 ? undefined : list[i]
  }

  hatchPanelSpec(id: string): HatchPanelSpec | undefined {
    return this.hatchSpecs[id]
  }

  /**
   * Where a hatch panel is at `time` (TT-R10), or null when its vessel is not in the scene. Panel state is the engine's:
   * on its hatch (secured, unsecured, replaced), hanging from its crane's spreader (lifted: the panel's top face is at
   * the spreader height), or stacked in its laydown bay.
   */
  hatchPanelPose(id: string, time: number): HatchPanelPose | null {
    const panel = this.hatchSpecs[id]
    if (!panel) return null
    const entry = this.hatchEntry(id, time)
    const status = entry?.status ?? 'secured'
    const base = { status, lengthM: panel.lengthM, widthM: panel.widthM, thicknessM: HATCH_THICKNESS_M }
    const half = HATCH_THICKNESS_M / 2
    if (status === 'lifted' && entry?.stsId) {
      const p = this.stsPose(entry.stsId, time)
      return { ...base, x: p.gantryX, y: p.hoistY - half, z: p.trolleyZ, stsId: entry.stsId }
    }
    if (status === 'in-laydown' && entry) {
      return { ...base, x: entry.x ?? 0, y: laydownTopY((entry.level ?? 0) + 1) - half, z: laydownCentreZ(this.config, panel.widthM), stsId: null }
    }
    const placement = this.vesselPlacement(panel.vesselId, time)
    if (!placement) return null
    const spec = this.specs[panel.vesselId]
    return {
      ...base,
      x: slotX(spec, placement.x, panel.bay),
      y: spec.deckHeightM - half,
      z: hatchPanelZ(spec, panel.index) + placement.zOffset,
      stsId: null,
    }
  }

  statusAt(kind: 'sts' | 'vessel' | 'shc' | 'asc' | 'truck' | 'hatch', id: string, time: number): string {
    if (kind === 'hatch') return this.hatchEntry(id, time)?.status ?? 'secured'
    const list = this.status[`${kind}:${id}`] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    return i < 0 ? 'unknown' : list[i].status
  }

  /** A vessel's status at `time` and when it entered mooring, berthed and departed (null before), from the status timeline (#126). */
  vesselStatusTimes(id: string, time: number): { status: string; mooringS: number | null; berthedS: number | null; departedS: number | null; firstMoveS: number | null } {
    const list = this.status[`vessel:${id}`] ?? []
    const upTo = lastAtOrBefore(list, time, (e) => e.t)
    const seen = (status: string): number | null => {
      for (let i = 0; i <= upTo; i++) if (list[i].status === status) return list[i].t
      return null
    }
    return { status: upTo < 0 ? 'unknown' : list[upTo].status, mooringS: seen('mooring'), berthedS: seen('berthed'), departedS: seen('departed'), firstMoveS: this.firstMoveSeen(list, upTo) }
  }

  private firstMoveSeen(list: StatusEntry[], upTo: number): number | null {
    for (let i = 0; i <= upTo; i++) {
      const m = list[i].firstMoveS
      if (m !== null && m !== undefined) return m
    }
    return null
  }

  /** Where a vessel is at `time`: alongside at its berth, at anchorage offshore, or null (not arrived / departed). */
  vesselPlacement(id: string, time: number): VesselPlacement | null {
    const list = this.status[`vessel:${id}`] ?? []
    const i = lastAtOrBefore(list, time, (e) => e.t)
    if (i < 0) return null
    const { status, berthX } = list[i]
    if (ON_QUAY.has(status) && berthX !== null && berthX !== undefined) return { x: berthX, zOffset: 0, status }
    if (status === 'at-anchorage') return this.anchoragePlacement(id, status)
    return null
  }

  private anchoragePlacement(id: string, status = 'at-anchorage'): VesselPlacement {
    const x = this.config.quay.lengthM + 200 + (this.anchorageSlot[id] % 4) * ANCHORAGE_SPACING_M
    return { x, zOffset: ANCHORAGE_Z - Math.floor(this.anchorageSlot[id] / 4) * 120, status }
  }

  vesselVisible(id: string, time: number): boolean {
    return this.vesselPlacement(id, time) !== null
  }

  /** Poses of stacked boxes by `${slotId}|${size}` (read-only; shared between frames). */
  private readonly yardPoses = new Map<string, ContainerPose>()
  private readonly vesselSlotCells = new Map<string, ReturnType<typeof parseVesselSlotId>>()

  /**
   * What the colour modes need about a box at `time` (#130). `timeBased` also resolves the transit status and the dwell
   * (a walk over the box's custody records); the other modes only read its stored properties.
   */
  colourSubjectAt(containerId: string, time: number, timeBased: boolean): ColourSubject {
    const d = this.containerDetail[containerId]
    const line = this.containerLine[containerId]
    let props = d?.props
    if (!props) {
      const imp = this.prefillImports.get(containerId)
      if (imp && d) props = d.props = imp.props
    }
    const full = d?.laden ?? true
    const list = this.custody[containerId] ?? []
    if (timeBased && list.length > 0) {
      this.colourT = time
      return subjectOfBox({ line, full, props, yardSince: d?.yardSince, custody: list[list.length - 1].owner, custodyHistory: list as unknown as ContainerState['custodyHistory'] }, this.colourWorld, time, { vessels: this.vesselIdSet })
    }
    const onCall = (c: { kind: string; id?: string } | undefined): boolean => c?.kind === 'vessel' && c.id !== undefined && this.vesselIdSet.has(c.id)
    return {
      line,
      full,
      ...(props ? { isoType: props.isoType, pod: props.pod, weightClass: props.weightClass, direction: props.direction, plannedDepartureS: props.plannedDepartureS } : { isoType: d?.isoType }),
      onCall: props ? onCall(props.inbound) || onCall(props.outbound) : false,
    }
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
      return p.visible ? { x: p.x, y: TRUCK_DECK_M + dims.height / 2, z: p.z, yaw: p.yaw + Math.PI } : null // doors at the rear, away from the cab
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
      // A stacked box never moves: its pose is parsed once per slot and size (tens of thousands of boxes are posed every frame).
      const size = this.containerSize[containerId]
      const cacheKey = `${id}|${size}`
      const hit = this.yardPoses.get(cacheKey)
      if (hit) return hit
      const cell = parseYardSlotId(id)
      const block = this.blocks[cell.blockId]
      if (!block) return null
      const pose: ContainerPose = {
        x: rowX(block, cell.row),
        y: tierBaseY(cell.tier) + dims.height / 2,
        z: slotZ(block, cell.bay, boxSpan(size)),
        yaw: alongZ,
        yard: true,
      }
      this.yardPoses.set(cacheKey, pose)
      return pose
    }
    if (kind === 'vesselSlot') {
      let slot = this.vesselSlotCells.get(id)
      if (!slot) this.vesselSlotCells.set(id, (slot = parseVesselSlotId(id)))
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

  /**
   * Where the camera should look for an entity id: a container, STS, SHC, ASC, vessel, truck, yard block, transfer stall
   * (`<block>-TS<n>` or `stalls:<block>` for the block's first), WTP pad, `holding` / `H<n>` (holding positions) or the `gate`. Null for an unknown id, and for a truck that has left.
   */
  entityCentre(id: string, time: number): Vec3 | null {
    if (this.containerSize[id]) return this.containerCentre(id, time)
    if (this.hatchSpecs[id]) return this.hatchPanelPose(id, time)
    if (this.initialShc[id]) {
      const p = this.shcPose(id, time)
      return { x: p.x, y: 3, z: p.z }
    }
    if (this.initialAsc[id]) {
      const p = this.ascPose(id, time)
      return { x: p.x, y: 6, z: p.z }
    }
    if (this.landside && id === 'gate') return { x: this.landside.gate.queueX + 20, y: 3, z: this.landside.gate.kioskZ }
    if (this.landside && id.startsWith('stalls:')) {
      const stalls = this.landside.stalls.filter((s) => s.blockId === id.slice(7))
      return stalls.length ? { x: stalls[0].x, y: 3, z: stalls[0].z } : null
    }
    if (this.landside && (id === 'holding' || /^H\d+$/.test(id))) {
      // `holding` = the middle of the holding positions (TT-R16), `H<n>` one position
      const list = id === 'holding' ? this.landside.holding : this.landside.holding.filter((h) => h.id === id)
      if (list.length > 0) return { x: list.reduce((sum, h) => sum + h.x, 0) / list.length, y: 3, z: list[0].z }
    }
    const block = this.blocks[id]
    if (block) {
      const mid = block.firstBayZ + ((block.bays - 1) * BAY_PITCH_M) / 2
      return { x: block.x, y: 3, z: mid }
    }
    const stall = this.landside?.stalls.find((s) => s.id === id)
    if (stall) return { x: stall.x, y: 3, z: stall.z }
    const pad = this.graph.pads.find((p) => p.id === id)
    if (pad) return { x: pad.x, y: 2, z: pad.z }
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
      // Not yet arrived (or departed): aim at its anchorage berth so a camera jump still works.
      const p = this.vesselPlacement(id, time) ?? this.anchoragePlacement(id)
      return { x: p.x + spec.loaM / 2, y: spec.deckHeightM, z: p.zOffset - spec.beamM / 2 }
    }
    return null
  }
}
