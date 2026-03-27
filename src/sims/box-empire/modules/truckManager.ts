// ---------------------------------------------------------------------------
// Box Empire — Truck gate flow & lifecycle
// ---------------------------------------------------------------------------
// Queue design: each truck has a stable queueIndex assigned at creation time.
// While approaching, it moves toward GATE_POSITION.z + queueIndex*QUEUE_SPACING.
// When it reaches the gate (queueIndex==0 && gate free) it enters 'at_gate'.
// This prevents jitter: trucks never recompute queue positions dynamically.
//
// Import pickup flow (new):
//   approaching → at_gate → driving_to_yard → waiting_for_equipment
//   → returning_to_gate (loaded, heading back to gate-out lane)
//   → at_gate_out (gate processes exit, triggers gate-out revenue)
//   → departing → departed
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
const QUEUE_SPACING = 10

export function resetTruckCounter(): void {
  truckCounter = 0
}

export function createTruck(
  containerId: string | null,
  visitType: 'import_pickup' | 'export_delivery',
): TruckVisit {
  truckCounter++
  const lanePos = getLanePosition(visitType)

  // Count how many trucks of the same type are already active (not departed)
  // to assign a queue index. This is evaluated at creation time and never changes.
  const queueIndex = truckCounter   // simple monotonic; each truck waits further back

  return {
    id: `truck-${truckCounter}`,
    state: 'approaching',
    containerId,
    visitType,
    position: {
      x: lanePos.x,
      y: 0,
      z: lanePos.z + queueIndex * QUEUE_SPACING,
    },
    targetPosition: { ...lanePos },
    stateStartTime: 0,
    queueIndex,
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

export function getLanePosition(visitType: 'import_pickup' | 'export_delivery'): Position3D {
  return visitType === 'export_delivery' ? GATE_EXPORT_LANE_POSITION : GATE_IMPORT_LANE_POSITION
}

// A truck can advance to the gate only if no other truck of the same type is currently at_gate or at_gate_out
function isLaneFree(state: BoxEmpireState, thisTruck: TruckVisit): boolean {
  return !state.truckVisits.some(
    t =>
      t.id !== thisTruck.id &&
      t.visitType === thisTruck.visitType &&
      (t.state === 'at_gate' || t.state === 'at_gate_out'),
  )
}

// Return the stable hold position for this truck in its queue
function getHoldPosition(state: BoxEmpireState, thisTruck: TruckVisit): Position3D {
  const lanePos = getLanePosition(thisTruck.visitType)

  // Count how many active trucks of the same type have a lower queueIndex (are ahead)
  const ahead = state.truckVisits.filter(
    t =>
      t.id !== thisTruck.id &&
      t.visitType === thisTruck.visitType &&
      t.state === 'approaching' &&
      t.queueIndex < thisTruck.queueIndex,
  ).length

  // Position 1 = first queue slot behind gate, 2 = second, etc.
  return {
    x: lanePos.x,
    y: 0,
    z: lanePos.z + (ahead + 1) * QUEUE_SPACING,
  }
}

export interface TruckTickResult {
  arrived: boolean
  departed: boolean
  readyForEquipment: boolean
  gateProcessed: boolean
  gateOutProcessed: boolean    // import truck finished gate-out
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
    gateOutProcessed: false,
  }

  switch (truck.state) {
    case 'approaching': {
      const laneTarget = getLanePosition(truck.visitType)

      if (isLaneFree(state, truck)) {
        // Advance to gate
        truck.targetPosition = { ...laneTarget }
        const { position, arrived } = moveTowards(truck.position, laneTarget, TRUCK_SPEED, dt)
        truck.position = position
        if (arrived) {
          truck.state = 'at_gate'
          truck.stateStartTime = state.simTime
          result.arrived = true
        }
      } else {
        // Hold at stable queue position — only move if not already there
        const holdPos = getHoldPosition(state, truck)
        truck.targetPosition = holdPos
        const dz = Math.abs(truck.position.z - holdPos.z)
        const dx = Math.abs(truck.position.x - holdPos.x)
        if (dz > 0.5 || dx > 0.5) {
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
      const target = truck.targetPosition ?? YARD_IO_POSITION
      const { position, arrived } = moveTowards(truck.position, target, TRUCK_SPEED, dt)
      truck.position = position
      if (arrived) {
        truck.state = 'waiting_for_equipment'
        truck.stateStartTime = state.simTime
        result.readyForEquipment = true
      }
      break
    }

    case 'waiting_for_equipment': {
      // Wait until gameStore assigns container and triggers return
      break
    }

    case 'returning_to_gate': {
      // Import truck loaded with container, heading back to gate-out position
      const lanePos = getLanePosition(truck.visitType)
      const gateOutTarget: Position3D = { ...lanePos }
      const { position, arrived } = moveTowards(truck.position, gateOutTarget, TRUCK_SPEED, dt)
      truck.position = position
      if (arrived) {
        truck.state = 'at_gate_out'
        truck.stateStartTime = state.simTime
      }
      break
    }

    case 'at_gate_out': {
      // Process gate-out
      const elapsed = state.simTime - truck.stateStartTime
      if (elapsed >= GATE_PROCESSING_TIME) {
        result.gateOutProcessed = true
        startTruckDeparture(truck, state.simTime)
      }
      break
    }

    case 'departing': {
      const lanePos = getLanePosition(truck.visitType)
      const exitTarget: Position3D = {
        x: lanePos.x,
        y: 0,
        z: lanePos.z + 120,
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

export function startTruckReturnToGate(truck: TruckVisit, simTime: number): void {
  truck.state = 'returning_to_gate'
  truck.stateStartTime = simTime
  truck.targetPosition = { ...getLanePosition(truck.visitType) }
}

export function startTruckDeparture(truck: TruckVisit, simTime: number): void {
  const lanePos = getLanePosition(truck.visitType)
  truck.state = 'departing'
  truck.stateStartTime = simTime
  truck.targetPosition = {
    x: lanePos.x,
    y: 0,
    z: lanePos.z + 120,
  }
}
