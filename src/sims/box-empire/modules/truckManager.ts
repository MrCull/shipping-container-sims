// ---------------------------------------------------------------------------
// Box Empire — Truck gate flow & lifecycle
// ---------------------------------------------------------------------------

import type { TruckVisit, Position3D, BoxEmpireState } from '../types'
import {
  TRUCK_SPEED,
  GATE_PROCESSING_TIME,
  GATE_EXPORT_LANE_POSITION,
  GATE_IMPORT_LANE_POSITION,
  YARD_IO_POSITION,
} from './config'

let truckCounter = 0

// Spacing between queued trucks (meters)
const QUEUE_SPACING = 9

export function resetTruckCounter(): void {
  truckCounter = 0
}

export function createTruck(
  containerId: string | null,
  visitType: 'import_pickup' | 'export_delivery',
): TruckVisit {
  truckCounter++
  // Use dedicated lane positions for each visit type
  const lanePos = visitType === 'export_delivery'
    ? GATE_EXPORT_LANE_POSITION
    : GATE_IMPORT_LANE_POSITION
  // Spawn behind the gate in a staggered line; keep within scene bounds
  const spawnOffset = truckCounter * QUEUE_SPACING
  return {
    id: `truck-${truckCounter}`,
    state: 'approaching',
    containerId,
    visitType,
    position: {
      x: lanePos.x,
      y: 0,
      z: lanePos.z + spawnOffset,
    },
    targetPosition: { ...lanePos },
    stateStartTime: 0,
  }
}

function moveTowards(
  current: Position3D,
  target: Position3D,
  speed: number,
  dt: number,
): { position: Position3D; arrived: boolean } {
  const dx = target.x - current.x
  const dy = target.y - current.y
  const dz = target.z - current.z
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const step = speed * dt
  if (d <= step || d < 0.5) {
    return { position: { ...target }, arrived: true }
  }
  const ratio = step / d
  return {
    position: {
      x: current.x + dx * ratio,
      y: current.y + dy * ratio,
      z: current.z + dz * ratio,
    },
    arrived: false,
  }
}

function isGateFree(state: BoxEmpireState, thisTruck: TruckVisit): boolean {
  return !state.truckVisits.some(
    t => t.id !== thisTruck.id && t.visitType === thisTruck.visitType && t.state === 'at_gate',
  )
}

function getLanePosition(visitType: 'import_pickup' | 'export_delivery'): Position3D {
  return visitType === 'export_delivery' ? GATE_EXPORT_LANE_POSITION : GATE_IMPORT_LANE_POSITION
}

function getQueuePosition(state: BoxEmpireState, thisTruck: TruckVisit): Position3D {
  const lanePos = getLanePosition(thisTruck.visitType)
  const approaching = state.truckVisits.filter(
    t => t.id !== thisTruck.id && t.visitType === thisTruck.visitType && t.state === 'approaching',
  )
  const position = approaching.length
  return {
    x: lanePos.x,
    y: 0,
    z: lanePos.z + (position + 1) * QUEUE_SPACING,
  }
}

export interface TruckTickResult {
  arrived: boolean
  departed: boolean
  readyForEquipment: boolean
  gateProcessed: boolean
}

export function tickTruck(
  truck: TruckVisit,
  state: BoxEmpireState,
  dt: number,
): TruckTickResult {
  const result: TruckTickResult = {
    arrived: false,
    departed: false,
    readyForEquipment: false,
    gateProcessed: false,
  }

  switch (truck.state) {
    case 'approaching': {
      const laneTarget: Position3D = { ...getLanePosition(truck.visitType) }

      if (isGateFree(state, truck)) {
        truck.targetPosition = laneTarget
        const { position, arrived } = moveTowards(truck.position, laneTarget, TRUCK_SPEED, dt)
        truck.position = position
        if (arrived) {
          truck.state = 'at_gate'
          truck.stateStartTime = state.simTime
          result.arrived = true
        }
      } else {
        const holdPos = getQueuePosition(state, truck)
        truck.targetPosition = holdPos
        const distToHold = Math.abs(truck.position.z - holdPos.z)
        if (distToHold > 0.5) {
          const { position } = moveTowards(truck.position, holdPos, TRUCK_SPEED, dt)
          truck.position = position
        }
      }
      break
    }

    case 'at_gate': {
      const elapsed = state.simTime - truck.stateStartTime
      if (elapsed >= GATE_PROCESSING_TIME) {
        truck.state = 'driving_to_yard'
        truck.targetPosition = { ...YARD_IO_POSITION }
        truck.stateStartTime = state.simTime
        result.gateProcessed = true
      }
      break
    }

    case 'driving_to_yard': {
      const { position, arrived } = moveTowards(
        truck.position,
        truck.targetPosition ?? YARD_IO_POSITION,
        TRUCK_SPEED,
        dt,
      )
      truck.position = position
      if (arrived) {
        truck.state = 'waiting_for_equipment'
        truck.stateStartTime = state.simTime
        result.readyForEquipment = true
      }
      break
    }

    case 'waiting_for_equipment': {
      break
    }

    case 'departing': {
      const lanePos = getLanePosition(truck.visitType)
      const exitTarget: Position3D = {
        x: lanePos.x,
        y: 0,
        z: lanePos.z + 80,
      }
      const { position, arrived } = moveTowards(truck.position, exitTarget, TRUCK_SPEED, dt)
      truck.position = position
      if (arrived) {
        truck.state = 'departed'
        result.departed = true
      }
      break
    }

    case 'departed':
      break
  }

  return result
}

export function startTruckDeparture(truck: TruckVisit, simTime: number): void {
  const lanePos = getLanePosition(truck.visitType)
  truck.state = 'departing'
  truck.stateStartTime = simTime
  truck.targetPosition = {
    x: lanePos.x,
    y: 0,
    z: lanePos.z + 80,
  }
}
