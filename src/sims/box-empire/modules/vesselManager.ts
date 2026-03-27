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
  CONTAINER_STACK_GAP_Y,
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

  const slots: VesselSlot[] = []
  for (let tier = 1; tier <= TUTORIAL_VESSEL.tiers; tier++) {
    const container = importContainers[tier - 1]
    slots.push({
      vesselId,
      bay: 1,
      row: 1,
      tier,
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

export function getVesselSlotPosition(
  vessel: VesselVisit,
  tier: number,
): Position3D {
  const deckY = 4
  return {
    x: vessel.position.x,
    y: deckY + (tier - 1) * (CONTAINER_HEIGHT + CONTAINER_STACK_GAP_Y) + CONTAINER_HEIGHT / 2,
    z: vessel.position.z,
  }
}

export function getNextDischargeContainer(
  vessel: VesselVisit,
): { containerId: string; tier: number } | null {
  for (let tier = TUTORIAL_VESSEL.tiers; tier >= 1; tier--) {
    const slot = vessel.slots.find(s => s.tier === tier && s.containerId !== null)
    if (slot && slot.containerId) {
      return { containerId: slot.containerId, tier: slot.tier }
    }
  }
  return null
}

export function getNextLoadSlot(vessel: VesselVisit): number | null {
  for (let tier = 1; tier <= TUTORIAL_VESSEL.tiers; tier++) {
    const slot = vessel.slots.find(s => s.tier === tier)
    if (slot && !slot.containerId) return tier
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

export function loadContainerOnVessel(
  vessel: VesselVisit,
  containerId: string,
  tier: number,
): void {
  const slot = vessel.slots.find(s => s.tier === tier)
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
