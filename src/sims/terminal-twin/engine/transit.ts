/**
 * Transit status, content status and dwell (spec #106, ticket #109): pure functions of a container and the state
 * of its carriers. Nothing here is stored and no event is emitted for it, so it can never drift from the box's real
 * situation. Pure: no engine state is read except through the `TransitWorld` lookups the caller supplies.
 */
import { parseVesselSlotId } from '../scenario/vesselClasses'
import type { ContainerState, CustodyKind, TruckStatus, VesselStatus } from './state'

/** Where a box is in its journey through the terminal. */
export type TransitStatus = 'ADVISED' | 'ARRIVED' | 'ON_TERMINAL' | 'LOADED' | 'DEPARTED'

export type ContentStatus = 'EMPTY' | 'LADEN'

/** The carrier state a status depends on. A lookup returns undefined for an unknown carrier. */
export interface TransitWorld {
  vesselStatus(vesselId: string): VesselStatus | undefined
  truckStatus(truckId: string): TruckStatus | undefined
}

/** Custody held by the terminal: its equipment and places. A vessel slot, a truck and `external` are carriers. */
const TERMINAL_CUSTODY: ReadonlySet<CustodyKind> = new Set<CustodyKind>(['sts', 'groundPosition', 'shc', 'wtpPad', 'asc', 'yardSlot'])

export const isTerminalCustody = (kind: CustodyKind): boolean => TERMINAL_CUSTODY.has(kind)

/** A vessel that has reached its berth (mooring is still on the way in). */
const VESSEL_AT_BERTH: ReadonlySet<VesselStatus> = new Set<VesselStatus>(['berthed', 'unmooring'])

/** A truck that has not yet passed the gate kiosk. */
const TRUCK_OUTSIDE: ReadonlySet<TruckStatus> = new Set<TruckStatus>(['queued', 'in-lane'])

export function transitStatus(box: Readonly<ContainerState>, world: TransitWorld): TransitStatus {
  const { kind, id } = box.custody
  if (isTerminalCustody(kind)) return 'ON_TERMINAL'
  const held = terminalArrivalS(box) !== null
  if (kind === 'vesselSlot') {
    const vessel = world.vesselStatus(parseVesselSlotId(id).vesselId)
    if (vessel === 'departed') return 'DEPARTED'
    if (held) return 'LOADED'
    return vessel !== undefined && VESSEL_AT_BERTH.has(vessel) ? 'ARRIVED' : 'ADVISED'
  }
  if (kind === 'truck') {
    if (held) return 'LOADED'
    const truck = world.truckStatus(id)
    return truck !== undefined && TRUCK_OUTSIDE.has(truck) ? 'ADVISED' : 'ARRIVED'
  }
  // external: awaiting its truck (never here), or gone with it
  return held ? 'DEPARTED' : 'ADVISED'
}

/** EMPTY or LADEN, from the stored `full` flag. */
export const contentStatus = (box: Pick<ContainerState, 'full'>): ContentStatus => (box.full ? 'LADEN' : 'EMPTY')

/**
 * When the box first came into terminal custody (sim s), or null if it never has. A box that stood in the yard
 * before the run (`yardSince` < its first custody record) counts from `yardSince`.
 */
export function terminalArrivalS(box: Readonly<ContainerState>): number | null {
  const first = box.custodyHistory.find((r) => isTerminalCustody(r.owner.kind))
  if (!first) return null
  return box.yardSince !== undefined ? Math.min(first.t, box.yardSince) : first.t
}

/** When the box left terminal custody for a carrier (sim s), or null while it is still here (or never was). */
export function terminalExitS(box: Readonly<ContainerState>): number | null {
  const h = box.custodyHistory
  const i = h.findIndex((r) => isTerminalCustody(r.owner.kind))
  if (i < 0) return null
  const out = h.slice(i).find((r) => !isTerminalCustody(r.owner.kind))
  return out ? out.t : null
}

/** Seconds on the terminal: since arrival, up to now while the box is here and up to its departure after. Null for a box not yet arrived. */
export function dwellS(box: Readonly<ContainerState>, now: number): number | null {
  const from = terminalArrivalS(box)
  if (from === null) return null
  return Math.max(0, (terminalExitS(box) ?? now) - from)
}
