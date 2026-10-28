/**
 * Read-only query surface over SimState, shared by the public Simulation
 * API and by decision-point handlers. Returned objects are live views of
 * engine state: treat them as read-only (copy before keeping them).
 */
import type { Reservation } from './reservations'
import type {
  ContainerState,
  GroundPositionState,
  ShcJob,
  ShcState,
  SimState,
  StsState,
  VesselSlotState,
  VesselState,
  WtpPadState,
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
  /** Current and future conflict-zone reservations. */
  reservations(): readonly Readonly<Reservation>[]
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
    reservations: () => getState().reservations.filter((r) => r.to > getState().now),
  }
}
