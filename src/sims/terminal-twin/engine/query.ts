/**
 * Read-only query surface over SimState, shared by the public Simulation
 * API and by decision-point handlers. Returned objects are live views of
 * engine state: treat them as read-only (copy before keeping them).
 */
import type {
  ContainerState,
  GroundPositionState,
  SimState,
  StsState,
  VesselSlotState,
  VesselState,
} from './state'

export interface SimQuery {
  now(): number
  container(id: string): Readonly<ContainerState>
  containers(): readonly Readonly<ContainerState>[]
  vessel(id: string): Readonly<VesselState>
  vesselSlot(id: string): Readonly<VesselSlotState>
  sts(id: string): Readonly<StsState>
  groundPosition(id: string): Readonly<GroundPositionState>
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
    vesselSlot: (id) => get(getState().vesselSlots, id, 'vessel slot'),
    sts: (id) => get(getState().sts, id, 'STS'),
    groundPosition: (id) => get(getState().groundPositions, id, 'ground position'),
  }
}
