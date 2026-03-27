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
    position: { x: BERTH_POSITION.x, y: BERTH_POSITION.y, z: BERTH_POSITION.z - 40 },
    arrivalTime,
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
      }
      break
    }
    case 'arriving': {
      const targetZ = BERTH_POSITION.z
      const targetX = BERTH_POSITION.x
      const dist = targetZ - vessel.position.z
      // Two-phase: slow deceleration when within 15m, then final alignment
      const speed = Math.abs(dist) > 15 ? 4 : 1.5
      if (vessel.position.z < targetZ) {
        vessel.position.z = Math.min(vessel.position.z + speed * _dt, targetZ)
      }
      if (vessel.position.x !== targetX) {
        const xDiff = targetX - vessel.position.x
        vessel.position.x += Math.sign(xDiff) * Math.min(Math.abs(xDiff), speed * _dt)
      }
      if (vessel.position.z >= targetZ && Math.abs(vessel.position.x - targetX) < 0.1) {
        vessel.state = 'arrived'
        vessel.position.z = targetZ
        vessel.position.x = targetX
        result.stateChanged = true
        result.newState = 'arrived'
      }
      break
    }
    case 'departed':
      break
    case 'departing': {
      const speed = 3
      vessel.position.z -= speed * _dt
      if (vessel.position.z < BERTH_POSITION.z - 60) {
        vessel.state = 'departed'
        result.stateChanged = true
        result.newState = 'departed'
      }
      break
    }
  }

  return result
}
