/**
 * The single place the engine builds a container (spec #106, ticket #107). Two shapes exist: the planned container
 * of the bay plan (`PlannedContainer`, scenario time) and the live `ContainerState` the engine runs on. Every
 * creator (bay plan, empty pool, yard prefill, landside trucks, the scenario's initial state) goes through these
 * functions, so a new container property is added here and nowhere else. `containerFactory.test.ts` fails if a
 * creator builds a container literal by hand.
 *
 * Property insertion order is part of the contract: it must not change (goldens hash the serialised state).
 */
import type { ContainerSize } from './types'
import type { PlannedContainer } from './bayPlan'
import type { ContainerState, CustodyRef } from '../engine/state'

export interface PlannedContainerInit {
  id: string
  size: ContainerSize
  full: boolean
  line: string
  vesselId: string
  slotId: string
  flow: PlannedContainer['flow']
  /** Empty-pool boxes: age in the yard at t = 0 (s). */
  ageS?: number
  reefer?: boolean
}

/** A bay-plan container (discharge, load or pool flow). */
export function makePlannedContainer(init: PlannedContainerInit): PlannedContainer {
  const c: PlannedContainer = {
    id: init.id,
    size: init.size,
    full: init.full,
    line: init.line,
    vesselId: init.vesselId,
    slotId: init.slotId,
    flow: init.flow,
  }
  if (init.ageS !== undefined) c.ageS = init.ageS
  if (init.reefer) c.reefer = true
  return c
}

export interface ContainerStateInit {
  id: string
  size: ContainerSize
  full: boolean
  line: string
  vesselId: string
  /** Initial custodian; recorded as the first custody record at `t` / `eventId`. */
  owner: CustodyRef
  t: number
  eventId: number | null
  reefer?: boolean
  yardSince?: number
  pickupReadyAt?: number
  truckClaim?: string
  /** Linked transshipment box: onward vessel, slot and yard dwell (s); `readyAt` starts null. */
  transshipment?: { onwardVesselId: string; onwardSlotId: string; dwellS: number }
}

/** A live container, in its initial custody. */
export function makeContainerState(init: ContainerStateInit): ContainerState {
  const c: ContainerState = {
    id: init.id,
    size: init.size,
    full: init.full,
    line: init.line,
    vesselId: init.vesselId,
    custody: init.owner,
    custodyHistory: [{ t: init.t, owner: { ...init.owner }, eventId: init.eventId }],
  }
  if (init.reefer) c.reefer = true
  if (init.yardSince !== undefined) c.yardSince = init.yardSince
  if (init.pickupReadyAt !== undefined) c.pickupReadyAt = init.pickupReadyAt
  if (init.truckClaim !== undefined) c.truckClaim = init.truckClaim
  if (init.transshipment) {
    c.onwardVesselId = init.transshipment.onwardVesselId
    c.onwardSlotId = init.transshipment.onwardSlotId
    c.dwellS = init.transshipment.dwellS
    c.readyAt = null
  }
  return c
}
