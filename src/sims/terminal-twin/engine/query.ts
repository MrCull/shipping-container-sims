/**
 * Read-only query surface over SimState, shared by the public Simulation
 * API and by decision-point handlers. Returned objects are live views of
 * engine state: treat them as read-only (copy before keeping them).
 */
import type { Reservation } from './reservations'
import type {
  Appointment,
  AscJob,
  AscState,
  ContainerState,
  GroundPositionState,
  LoadOrder,
  WorkPackage,
  ShcJob,
  ShcState,
  SimState,
  StsState,
  TruckState,
  TransferStallState,
  HoldingPositionState,
  VesselSlotState,
  VesselState,
  WtpPadState,
  YardBlockState,
  YardSlotState,
} from './state'

export interface SimQuery {
  now(): number
  container(id: string): Readonly<ContainerState>
  containers(): readonly Readonly<ContainerState>[]
  vessel(id: string): Readonly<VesselState>
  vessels(): readonly Readonly<VesselState>[]
  vesselSlot(id: string): Readonly<VesselSlotState>
  /** A vessel's bay-plan slots (all vessels' when no id is given). */
  vesselSlots(vesselId?: string): readonly Readonly<VesselSlotState>[]
  sts(id: string): Readonly<StsState>
  /** All STS cranes in rail order. */
  stsList(): readonly Readonly<StsState>[]
  groundPosition(id: string): Readonly<GroundPositionState>
  shc(id: string): Readonly<ShcState>
  shcs(): readonly Readonly<ShcState>[]
  /** Released jobs not yet delivered (open and claimed). */
  shcJobs(): readonly Readonly<ShcJob>[]
  wtpPad(id: string): Readonly<WtpPadState>
  asc(id: string): Readonly<AscState>
  ascs(): readonly Readonly<AscState>[]
  /** Boxes on WTP pads that are not stacked yet (allocated or waiting for a slot). */
  ascJobs(): readonly Readonly<AscJob>[]
  yardBlock(id: string): Readonly<YardBlockState>
  yardBlocks(): readonly Readonly<YardBlockState>[]
  /** Stacked boxes (a block's, or all). */
  yardSlots(blockId?: string): readonly Readonly<YardSlotState>[]
  yardSlot(id: string): Readonly<YardSlotState>
  /** Current and future conflict-zone reservations. */
  reservations(): readonly Readonly<Reservation>[]
  /** Work packages (TT-10) in creation order: one crane's, or all. */
  workPackages(stsId?: string): readonly Readonly<WorkPackage>[]
  /** Export boxes in load preparation (released, not yet picked by their crane), in crane then load order. */
  loadOrders(): readonly Readonly<LoadOrder>[]
  /** Trucks in the terminal (queued at the gate to leaving), TT-13. */
  trucks(): readonly Readonly<TruckState>[]
  truck(id: string): Readonly<TruckState>
  /** Transfer stalls with the truck that holds each (empty when the landside is off). */
  transferStalls(): readonly Readonly<TransferStallState>[]
  /** Holding positions with the truck that holds each (empty without `config.landside.holding`), TT-R16. */
  holdingPositions(): readonly Readonly<HoldingPositionState>[]
  /** Trucks waiting at the gate, head of the queue first. */
  gateQueue(): readonly string[]
  /** Booked truck appointments, in arrival order (empty without `config.landside.appointments`), TT-R15. */
  appointments(): readonly Readonly<Appointment>[]
}

function get<T>(record: Record<string, T>, id: string, what: string): T {
  const value = record[id]
  if (value === undefined) throw new Error(`Unknown ${what}: ${id}`)
  return value
}

export function createQuery(getState: () => SimState): SimQuery {
  return {
    now: () => getState().now,
    container: (id) => get(getState().containers, id, 'container'),
    containers: () => Object.values(getState().containers),
    vessel: (id) => get(getState().vessels, id, 'vessel'),
    vessels: () => Object.values(getState().vessels),
    vesselSlot: (id) => get(getState().vesselSlots, id, 'vessel slot'),
    vesselSlots: (vesselId) => {
      const all = Object.values(getState().vesselSlots)
      return vesselId === undefined ? all : all.filter((s) => s.vesselId === vesselId)
    },
    sts: (id) => get(getState().sts, id, 'STS'),
    stsList: () => Object.values(getState().sts).sort((a, b) => a.railIndex - b.railIndex),
    groundPosition: (id) => get(getState().groundPositions, id, 'ground position'),
    shc: (id) => get(getState().shcs, id, 'SHC'),
    shcs: () => Object.values(getState().shcs),
    shcJobs: () => Object.values(getState().shcJobs),
    wtpPad: (id) => get(getState().wtpPads, id, 'WTP pad'),
    asc: (id) => get(getState().ascs, id, 'ASC'),
    ascs: () => Object.values(getState().ascs),
    ascJobs: () => Object.values(getState().ascJobs),
    yardBlock: (id) => get(getState().yardBlocks, id, 'yard block'),
    yardBlocks: () => Object.values(getState().yardBlocks),
    yardSlots: (blockId) => {
      const all = Object.values(getState().yardSlots)
      return blockId === undefined ? all : all.filter((s) => s.blockId === blockId)
    },
    yardSlot: (id) => get(getState().yardSlots, id, 'yard slot'),
    reservations: () => getState().reservations.filter((r) => r.to > getState().now),
    workPackages: (stsId) => {
      const all = Object.values(getState().workPackages)
      return stsId === undefined ? all : all.filter((p) => p.stsId === stsId)
    },
    trucks: () => Object.values(getState().trucks),
    truck: (id) => get(getState().trucks, id, 'truck'),
    transferStalls: () => Object.values(getState().landside?.stalls ?? {}),
    holdingPositions: () => Object.values(getState().landside?.holding ?? {}),
    gateQueue: () => getState().landside?.queue ?? [],
    appointments: () => getState().landside?.appointments?.list ?? [],
    loadOrders: () => Object.values(getState().loadOrders).sort((a, b) => (a.stsId < b.stsId ? -1 : a.stsId > b.stsId ? 1 : a.seq - b.seq)),
  }
}
