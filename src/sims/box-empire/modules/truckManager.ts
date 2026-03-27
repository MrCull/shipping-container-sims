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
  // Spawn well behind the gate in a line so they approach one at a time
  const spawnOffset = truckCounter * QUEUE_SPACING
  return {
    id: `truck-${truckCounter}`,
    state: 'approaching',
    containerId,
    visitType,
    position: {
      x: GATE_POSITION.x,
      y: 0,
      z: GATE_POSITION.z + spawnOffset + 20,
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

function isGateFree(state: BoxEmpireState, thisTruckId: string): boolean {
  return !state.truckVisits.some(
    t => t.id !== thisTruckId && (t.state === 'at_gate'),
  )
}

function getQueuePosition(state: BoxEmpireState, thisTruckId: string): Position3D {
  // Count trucks ahead (those also approaching that are closer to the gate)
  const approaching = state.truckVisits.filter(
    t => t.id !== thisTruckId && t.state === 'approaching',
  )
  // Queue behind the gate along +z
  const position = approaching.length
  return {
    x: GATE_POSITION.x,
    y: 0,
    z: GATE_POSITION.z + (position + 1) * QUEUE_SPACING,
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
      // Determine dynamic queue position: move toward gate only if gate is free
      // and no other truck is closer ahead of us
      const gateTarget: Position3D = { ...GATE_POSITION }

      if (isGateFree(state, truck.id)) {
        // Gate is free — move toward gate
        truck.targetPosition = gateTarget
        const { position, arrived } = moveTowards(truck.position, gateTarget, TRUCK_SPEED, dt)
        truck.position = position
        if (arrived) {
          truck.state = 'at_gate'
          truck.stateStartTime = state.simTime
          result.arrived = true
        }
      } else {
        // Gate is occupied — compute queue hold position and edge toward it
        const holdPos = getQueuePosition(state, truck.id)
        truck.targetPosition = holdPos
        // Only advance if we haven't reached our hold position yet
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
      const exitTarget: Position3D = {
        x: GATE_POSITION.x,
        y: 0,
        z: GATE_POSITION.z + 60,
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
    x: GATE_POSITION.x,
    y: 0,
    z: GATE_POSITION.z + 60,
  }
}
