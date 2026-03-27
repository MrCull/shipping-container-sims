// ---------------------------------------------------------------------------
// Box Empire — Truck gate flow & lifecycle
// ---------------------------------------------------------------------------

import type { TruckVisit, Position3D, BoxEmpireState } from '../types'
import {
  TRUCK_SPEED,
  GATE_PROCESSING_TIME,
  GATE_POSITION,
  YARD_IO_POSITION,
} from './config'

let truckCounter = 0

export function resetTruckCounter(): void {
  truckCounter = 0
}

export function createTruck(
  containerId: string | null,
  visitType: 'import_pickup' | 'export_delivery',
): TruckVisit {
  truckCounter++
  const approachOffset = truckCounter * 8
  return {
    id: `truck-${truckCounter}`,
    state: 'approaching',
    containerId,
    visitType,
    position: {
      x: GATE_POSITION.x - 20,
      y: 0,
      z: GATE_POSITION.z + 10 + approachOffset,
    },
    targetPosition: { ...GATE_POSITION },
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
      const target: Position3D = { ...GATE_POSITION }
      const { position, arrived } = moveTowards(truck.position, target, TRUCK_SPEED, dt)
      truck.position = position
      if (arrived) {
        truck.state = 'at_gate'
        truck.stateStartTime = state.simTime
        result.arrived = true
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
      const exitTarget: Position3D = {
        x: GATE_POSITION.x - 20,
        y: 0,
        z: GATE_POSITION.z + 30,
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
  truck.state = 'departing'
  truck.stateStartTime = simTime
  truck.targetPosition = {
    x: GATE_POSITION.x - 20,
    y: 0,
    z: GATE_POSITION.z + 30,
  }
}
