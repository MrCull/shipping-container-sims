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
  BERTH_X_SPACING,
  FIRST_BERTH_X,
  VESSEL_CONTAINER_DECK_Y,
} from './config'

let vesselCounter = 0

export function resetVesselCounter(): void {
  vesselCounter = 0
}

export function peekNextVesselId(): string {
  return `vessel-${vesselCounter + 1}`
}

export function getVesselSlotRefs(): Array<{ bay: number; row: number; tier: number }> {
  const refs: Array<{ bay: number; row: number; tier: number }> = []
  for (let tier = 1; tier <= TUTORIAL_VESSEL.tiers; tier++) {
    for (let bay = 1; bay <= TUTORIAL_VESSEL.bays; bay++) {
      for (let row = 1; row <= TUTORIAL_VESSEL.rows; row++) {
        refs.push({ bay, row, tier })
      }
    }
  }
  return refs
}

function createSlots(vesselId: string, importContainers: Container[]): VesselSlot[] {
  const slots: VesselSlot[] = []
  const refs = getVesselSlotRefs()
  refs.forEach((ref, index) => {
    const container = importContainers[index]
    slots.push({
      vesselId,
      ...ref,
      containerId: container ? container.id : null,
    })
  })
  return slots
}

export function createTutorialVessel(
  importContainers: Container[],
  arrivalTime: number,
): VesselVisit {
  vesselCounter++
  const vesselId = `vessel-${vesselCounter}`

  return {
    id: vesselId,
    name: TUTORIAL_VESSEL.name,
    loa: TUTORIAL_VESSEL.loa,
    beam: TUTORIAL_VESSEL.beam,
    teuCapacity: TUTORIAL_VESSEL.teuCapacity,
    state: 'announced',
    slots: createSlots(vesselId, importContainers),
    // Spawn off to the +X side; vessel sails in from the right along the quay
    position: { x: BERTH_POSITION.x + 120, y: BERTH_POSITION.y, z: BERTH_POSITION.z },
    berthPosition: { ...BERTH_POSITION },
    arrivalTime,
    hornPlayed: false,
  }
}

export function createSpawnedVessel(
  importContainers: Container[],
  berthX: number,
): VesselVisit {
  vesselCounter++
  const vesselId = `vessel-${vesselCounter}`
  const berthPosition: Position3D = { x: berthX, y: 0, z: BERTH_POSITION.z }

  return {
    id: vesselId,
    name: `Feeder ${vesselCounter}`,
    loa: TUTORIAL_VESSEL.loa,
    beam: TUTORIAL_VESSEL.beam,
    teuCapacity: TUTORIAL_VESSEL.teuCapacity,
    state: 'announced',
    slots: createSlots(vesselId, importContainers),
    position: { x: berthX + 120, y: 0, z: BERTH_POSITION.z },
    berthPosition,
    arrivalTime: 0,  // arrives immediately (god mode)
    hornPlayed: false,
  }
}

export function getNextBerthX(activeVesselCount: number): number {
  return FIRST_BERTH_X + activeVesselCount * BERTH_X_SPACING
}

export function getVesselSlotPosition(
  vessel: VesselVisit,
  bay: number,
  row = 1,
  tier = 1,
): Position3D {
  const deckY = VESSEL_CONTAINER_DECK_Y
  const bayOffset = TUTORIAL_VESSEL.bayXOffsets[bay - 1] ?? 0
  const rowOffset = TUTORIAL_VESSEL.rowZOffsets[row - 1] ?? 0
  const tierOffset = (tier - 1) * (CONTAINER_HEIGHT + CONTAINER_STACK_GAP_Y)
  return {
    x: vessel.position.x + bayOffset,
    y: deckY + tierOffset + CONTAINER_HEIGHT / 2,
    z: vessel.position.z + rowOffset,
  }
}

function hasContainerAbove(vessel: VesselVisit, slot: VesselSlot): boolean {
  return vessel.slots.some(
    other =>
      other.bay === slot.bay &&
      other.row === slot.row &&
      other.tier > slot.tier &&
      other.containerId !== null,
  )
}

export function getDischargeableVesselContainers(
  vessel: VesselVisit,
): Array<{ containerId: string; bay: number; row: number; tier: number }> {
  return vessel.slots
    .filter(slot => slot.containerId !== null && !hasContainerAbove(vessel, slot))
    .sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier
      if (b.bay !== a.bay) return b.bay - a.bay
      return a.row - b.row
    })
    .map(slot => ({
      containerId: slot.containerId as string,
      bay: slot.bay,
      row: slot.row,
      tier: slot.tier,
    }))
}

export function getNextDischargeContainer(
  vessel: VesselVisit,
): { containerId: string; bay: number; row: number; tier: number } | null {
  return getDischargeableVesselContainers(vessel)[0] ?? null
}

export function getNextLoadSlot(vessel: VesselVisit): VesselSlot | null {
  for (let tier = 1; tier <= TUTORIAL_VESSEL.tiers; tier++) {
    for (let bay = 1; bay <= TUTORIAL_VESSEL.bays; bay++) {
      for (let row = 1; row <= TUTORIAL_VESSEL.rows; row++) {
        const slot = vessel.slots.find(s => s.bay === bay && s.row === row && s.tier === tier)
        if (slot && !slot.containerId) return slot
      }
    }
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
  bay: number,
  row = 1,
  tier = 1,
): void {
  const slot = vessel.slots.find(s => s.bay === bay && s.row === row && s.tier === tier)
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
  instantArrive: boolean = false,
): { stateChanged: boolean; newState: string | null } {
  const result = { stateChanged: false, newState: null as string | null }

  switch (vessel.state) {
    case 'announced': {
      if (state.simTime >= vessel.arrivalTime) {
        if (instantArrive) {
          vessel.state = 'arrived'
          vessel.position.x = vessel.berthPosition.x
          vessel.position.z = vessel.berthPosition.z
          result.stateChanged = true
          result.newState = 'arrived'
        } else {
          vessel.state = 'arriving'
          result.stateChanged = true
          result.newState = 'arriving'
          vessel.hornPlayed = false
        }
      }
      break
    }
    case 'arriving': {
      const targetX = vessel.berthPosition.x
      const targetZ = vessel.berthPosition.z
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
      if (vessel.position.x < vessel.berthPosition.x - 120) {
        vessel.state = 'departed'
        result.stateChanged = true
        result.newState = 'departed'
      }
      break
    }
  }

  return result
}
