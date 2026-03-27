// ---------------------------------------------------------------------------
// Box Empire — Vessel visit lifecycle
// ---------------------------------------------------------------------------

import type {
  VesselVisit,
  VesselSlot,
  Container,
  Position3D,
  BoxEmpireState,
} from '../types'
import {
  TUTORIAL_VESSEL,
  BERTH_POSITION,
  CONTAINER_HEIGHT,
  CONTAINER_LENGTH,
} from './config'

let vesselCounter = 0

export function resetVesselCounter(): void {
  vesselCounter = 0
}

export function createTutorialVessel(
  importContainers: Container[],
  arrivalTime: number,
): VesselVisit {
  vesselCounter++
  const vesselId = `vessel-${vesselCounter}`

  // Tutorial vessel: 5 bays along the deck (X axis), 1 tier per bay
  const slots: VesselSlot[] = []
  for (let bay = 1; bay <= TUTORIAL_VESSEL.bays; bay++) {
    const container = importContainers[bay - 1]
    slots.push({
      vesselId,
      bay,
      row: 1,
      tier: 1,
      containerId: container ? container.id : null,
    })
  }

  return {
    id: vesselId,
    name: TUTORIAL_VESSEL.name,
    loa: TUTORIAL_VESSEL.loa,
    beam: TUTORIAL_VESSEL.beam,
    teuCapacity: TUTORIAL_VESSEL.teuCapacity,
    state: 'announced',
    slots,
    // Spawn off to the +X side; vessel sails in from the right along the quay
    position: { x: BERTH_POSITION.x + 120, y: BERTH_POSITION.y, z: BERTH_POSITION.z },
    arrivalTime,
    hornPlayed: false,
  }
}

// Get world position of a vessel slot identified by bay number.
// Containers are spread along the X axis (length of vessel).
// bay=1 is near bow, bay=5 is near stern.
export function getVesselSlotPosition(
  vessel: VesselVisit,
  bay: number,
): Position3D {
  const deckY = 5.4  // above hull (hull body is 5m tall, deck at top)
  const containerSpacing = CONTAINER_LENGTH + 0.5
  // Centre the 5 containers on the vessel; offset from vessel centre X
  const totalSpan = (TUTORIAL_VESSEL.bays - 1) * containerSpacing
  const bayOffset = (bay - 1) * containerSpacing - totalSpan / 2
  return {
    x: vessel.position.x + bayOffset,
    y: deckY + CONTAINER_HEIGHT / 2,
    z: vessel.position.z,
  }
}

// Returns the next container to discharge and its bay number
export function getNextDischargeContainer(
  vessel: VesselVisit,
): { containerId: string; tier: number } | null {
  // Discharge from highest bay first (stern to bow)
  for (let bay = TUTORIAL_VESSEL.bays; bay >= 1; bay--) {
    const slot = vessel.slots.find(s => s.bay === bay && s.containerId !== null)
    if (slot && slot.containerId) {
      return { containerId: slot.containerId, tier: slot.bay }  // tier field reused as bay for API compat
    }
  }
  return null
}

// Returns the next empty bay for loading (bay number as 'tier' for API compat)
export function getNextLoadSlot(vessel: VesselVisit): number | null {
  for (let bay = 1; bay <= TUTORIAL_VESSEL.bays; bay++) {
    const slot = vessel.slots.find(s => s.bay === bay)
    if (slot && !slot.containerId) return bay
  }
  return null
}

export function dischargeContainerFromVessel(
  vessel: VesselVisit,
  containerId: string,
): void {
  const slot = vessel.slots.find(s => s.containerId === containerId)
  if (slot) slot.containerId = null
}

// 'tier' parameter is actually bay number (API compat — callers use getNextLoadSlot which returns bay)
export function loadContainerOnVessel(
  vessel: VesselVisit,
  containerId: string,
  tier: number,
): void {
  const slot = vessel.slots.find(s => s.bay === tier)
  if (slot) slot.containerId = containerId
}

export function isVesselFullyDischarged(vessel: VesselVisit): boolean {
  return vessel.slots.every(s => s.containerId === null)
}

export function isVesselFullyLoaded(vessel: VesselVisit, expectedCount: number): boolean {
  const loaded = vessel.slots.filter(s => s.containerId !== null).length
  return loaded >= expectedCount
}

export function tickVessel(
  vessel: VesselVisit,
  state: BoxEmpireState,
  _dt: number,
): { stateChanged: boolean; newState: string | null } {
  const result = { stateChanged: false, newState: null as string | null }

  switch (vessel.state) {
    case 'announced': {
      if (state.simTime >= vessel.arrivalTime) {
        vessel.state = 'arriving'
        result.stateChanged = true
        result.newState = 'arriving'
        vessel.hornPlayed = false
      }
      break
    }
    case 'arriving': {
      const targetX = BERTH_POSITION.x
      const targetZ = BERTH_POSITION.z
      const dist = vessel.position.x - targetX
      // Two-phase: fast approach, decelerate when within 15m
      const speed = Math.abs(dist) > 15 ? 6 : 2
      if (vessel.position.x > targetX) {
        vessel.position.x = Math.max(vessel.position.x - speed * _dt, targetX)
      }
      if (vessel.position.z !== targetZ) {
        const zDiff = targetZ - vessel.position.z
        vessel.position.z += Math.sign(zDiff) * Math.min(Math.abs(zDiff), speed * _dt)
      }
      if (vessel.position.x <= targetX && Math.abs(vessel.position.z - targetZ) < 0.1) {
        vessel.state = 'arrived'
        vessel.position.x = targetX
        vessel.position.z = targetZ
        result.stateChanged = true
        result.newState = 'arrived'
      }
      break
    }
    case 'departed':
      break
    case 'departing': {
      // Vessel departs along -X (sails away to the left)
      const speed = 4
      vessel.position.x -= speed * _dt
      if (vessel.position.x < BERTH_POSITION.x - 120) {
        vessel.state = 'departed'
        result.stateChanged = true
        result.newState = 'departed'
      }
      break
    }
  }

  return result
}
