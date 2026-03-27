// ---------------------------------------------------------------------------
// Box Empire — Truck lifecycle with axis-aligned movement and unified gates
// ---------------------------------------------------------------------------
//
// Gatehouse design:
//   IN-GATE  (GATE_INGATE_POSITION): ALL trucks enter here regardless of type.
//            Queue outside terminal (z > TERMINAL_FENCE_Z) along +Z.
//   OUT-GATE (GATE_OUTGATE_POSITION): ALL trucks exit here.
//            Located near terminal bottom. Trucks queue inside along -Z.
//
// Flow:
//   Export delivery truck:
//     approaching (in-gate) → at_gate → driving_to_yard → waiting_for_equipment
//     → departing (via out-gate) → departed
//
//   Import pickup truck:
//     approaching (in-gate) → at_gate → driving_to_yard → waiting_for_equipment
//     → returning_to_gate (heading to out-gate) → at_gate_out → departing → departed
//
// Movement: axis-aligned only (move X, then Z, or Z then X).
//   Trucks follow a waypoint list; they only turn 90 degrees at waypoints.
// ---------------------------------------------------------------------------

import type { TruckVisit, Position3D, BoxEmpireState } from '../types'
import {
  TRUCK_SPEED,
  GATE_PROCESSING_TIME,
  GATE_INGATE_POSITION,
  GATE_OUTGATE_POSITION,
  YARD_IO_POSITION,
} from './config'

let truckCounter = 0

// Spacing between queued trucks (meters)
const QUEUE_SPACING = 11

// Radius around YARD_IO where we consider a truck "occupying" the drop zone
const YARD_ZONE_RADIUS = 6

export function resetTruckCounter(): void {
  truckCounter = 0
}

export function createTruck(
  containerId: string | null,
  visitType: 'import_pickup' | 'export_delivery',
): TruckVisit {
  truckCounter++
  const queueIndex = truckCounter

  // Spawn outside the terminal in the in-gate queue
  return {
    id: `truck-${truckCounter}`,
    state: 'approaching',
    containerId,
    visitType,
    position: {
      x: GATE_INGATE_POSITION.x,
      y: 0,
      z: GATE_INGATE_POSITION.z + queueIndex * QUEUE_SPACING,
    },
    targetPosition: { ...GATE_INGATE_POSITION },
    stateStartTime: 0,
    queueIndex,
    waypoints: [],
    waypointIndex: 0,
    headingY: 0,
  }
}

// ------------------------------------------------------------------
// Axis-aligned movement helpers
// ------------------------------------------------------------------

// Build a list of waypoints to move from `from` to `to` axis-aligned.
// Strategy: move along X first, then Z.
function buildWaypoints(from: Position3D, to: Position3D): Position3D[] {
  const pts: Position3D[] = []
  // Corner: same X as dest, same Z as start
  if (Math.abs(from.x - to.x) > 0.5) {
    pts.push({ x: to.x, y: 0, z: from.z })
  }
  pts.push({ x: to.x, y: 0, z: to.z })
  return pts
}

function moveTowardsAxisAligned(
  current: Position3D,
  target: Position3D,
  speed: number,
  dt: number,
): { position: Position3D; arrived: boolean } {
  // Only move along one axis at a time (the current waypoint is axis-aligned from current pos)
  const dx = target.x - current.x
  const dz = target.z - current.z
  const d = Math.sqrt(dx * dx + dz * dz)
  const step = speed * dt
  if (d <= step || d < 0.5) {
    return { position: { x: target.x, y: 0, z: target.z }, arrived: true }
  }
  const ratio = step / d
  return {
    position: {
      x: current.x + dx * ratio,
      y: 0,
      z: current.z + dz * ratio,
    },
    arrived: false,
  }
}

// Advance a truck along its waypoints; return true when all waypoints reached
function advanceWaypoints(truck: TruckVisit, speed: number, dt: number): boolean {
  if (truck.waypointIndex >= truck.waypoints.length) return true

  const wp = truck.waypoints[truck.waypointIndex]
  truck.targetPosition = wp

  const dx = wp.x - truck.position.x
  const dz = wp.z - truck.position.z
  if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
    truck.headingY = Math.atan2(dx, dz)
  }

  const { position, arrived } = moveTowardsAxisAligned(truck.position, wp, speed, dt)
  truck.position = position

  if (arrived) {
    truck.waypointIndex++
    if (truck.waypointIndex >= truck.waypoints.length) return true
  }
  return false
}

// ------------------------------------------------------------------
// Queue / collision helpers
// ------------------------------------------------------------------

// Is the in-gate slot free (no other truck at_gate)?
function isIngAteFree(state: BoxEmpireState, thisTruckId: string): boolean {
  return !state.truckVisits.some(
    t => t.id !== thisTruckId && t.state === 'at_gate',
  )
}

// Is the out-gate slot free (no other truck at_gate_out)?
function isOutGateFree(state: BoxEmpireState, thisTruckId: string): boolean {
  return !state.truckVisits.some(
    t => t.id !== thisTruckId && t.state === 'at_gate_out',
  )
}

// How many trucks ahead in the in-gate queue (approaching state)
function ingateQueuePosition(state: BoxEmpireState, thisTruck: TruckVisit): Position3D {
  const ahead = state.truckVisits.filter(
    t =>
      t.id !== thisTruck.id &&
      t.state === 'approaching' &&
      t.queueIndex < thisTruck.queueIndex,
  ).length

  return {
    x: GATE_INGATE_POSITION.x,
    y: 0,
    z: GATE_INGATE_POSITION.z + (ahead + 1) * QUEUE_SPACING,
  }
}

// Is there another truck already occupying the YARD_IO zone?
function isYardZoneBusy(state: BoxEmpireState, thisTruckId: string): boolean {
  return state.truckVisits.some(t => {
    if (t.id === thisTruckId) return false
    if (t.state !== 'waiting_for_equipment' && t.state !== 'driving_to_yard') return false
    const dx = t.position.x - YARD_IO_POSITION.x
    const dz = t.position.z - YARD_IO_POSITION.z
    return Math.sqrt(dx * dx + dz * dz) < YARD_ZONE_RADIUS
  })
}

// Out-gate queue: trucks waiting to exit line up along -Z from out-gate
function outgateHoldPosition(state: BoxEmpireState, thisTruck: TruckVisit): Position3D {
  const waiters = state.truckVisits.filter(
    t =>
      t.id !== thisTruck.id &&
      (t.state === 'returning_to_gate') &&
      t.queueIndex < thisTruck.queueIndex,
  ).length

  return {
    x: GATE_OUTGATE_POSITION.x,
    y: 0,
    // Queue inside terminal (z decreasing from out-gate)
    z: GATE_OUTGATE_POSITION.z - (waiters + 1) * QUEUE_SPACING,
  }
}

// ------------------------------------------------------------------
// Main tick
// ------------------------------------------------------------------

export interface TruckTickResult {
  arrived: boolean
  departed: boolean
  readyForEquipment: boolean
  gateProcessed: boolean
  gateOutProcessed: boolean
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
      // All trucks queue at the single in-gate
      if (isIngAteFree(state, truck.id)) {
        // Advance to gate
        truck.targetPosition = { ...GATE_INGATE_POSITION }
        const { position, arrived } = moveTowardsAxisAligned(
          truck.position,
          GATE_INGATE_POSITION,
          TRUCK_SPEED,
          dt,
        )
        truck.position = position
        truck.headingY = Math.atan2(
          GATE_INGATE_POSITION.x - truck.position.x,
          GATE_INGATE_POSITION.z - truck.position.z,
        )
        if (arrived) {
          truck.state = 'at_gate'
          truck.stateStartTime = state.simTime
          result.arrived = true
        }
      } else {
        // Hold at stable queue position (no jitter)
        const holdPos = ingateQueuePosition(state, truck)
        truck.targetPosition = holdPos
        const dz = Math.abs(truck.position.z - holdPos.z)
        const dx = Math.abs(truck.position.x - holdPos.x)
        if (dz > 0.5 || dx > 0.5) {
          const { position } = moveTowardsAxisAligned(truck.position, holdPos, TRUCK_SPEED, dt)
          truck.position = position
        }
      }
      break
    }

    case 'at_gate': {
      const elapsed = state.simTime - truck.stateStartTime
      if (elapsed >= GATE_PROCESSING_TIME) {
        // Build axis-aligned waypoints from gate → yard IO
        truck.waypoints = buildWaypoints(truck.position, YARD_IO_POSITION)
        truck.waypointIndex = 0
        truck.state = 'driving_to_yard'
        truck.stateStartTime = state.simTime
        result.gateProcessed = true
      }
      break
    }

    case 'driving_to_yard': {
      // Check if yard zone is busy — if so wait in place
      if (isYardZoneBusy(state, truck.id)) {
        // Stay put — don't advance
        break
      }
      const done = advanceWaypoints(truck, TRUCK_SPEED, dt)
      if (done) {
        truck.state = 'waiting_for_equipment'
        truck.stateStartTime = state.simTime
        result.readyForEquipment = true
      }
      break
    }

    case 'waiting_for_equipment': {
      // Wait until gameStore triggers departure
      break
    }

    case 'returning_to_gate': {
      // Drive to out-gate via axis-aligned waypoints
      if (truck.waypointIndex >= truck.waypoints.length) {
        // Build route to out-gate if not already set
        truck.waypoints = buildWaypoints(truck.position, GATE_OUTGATE_POSITION)
        truck.waypointIndex = 0
      }

      // If out-gate busy, hold at queue position
      if (!isOutGateFree(state, truck.id)) {
        const holdPos = outgateHoldPosition(state, truck)
        truck.targetPosition = holdPos
        const dz = Math.abs(truck.position.z - holdPos.z)
        const dx = Math.abs(truck.position.x - holdPos.x)
        if (dz > 0.5 || dx > 0.5) {
          const { position } = moveTowardsAxisAligned(truck.position, holdPos, TRUCK_SPEED, dt)
          truck.position = position
        }
        break
      }

      const done = advanceWaypoints(truck, TRUCK_SPEED, dt)
      if (done) {
        truck.state = 'at_gate_out'
        truck.stateStartTime = state.simTime
      }
      break
    }

    case 'at_gate_out': {
      const elapsed = state.simTime - truck.stateStartTime
      if (elapsed >= GATE_PROCESSING_TIME) {
        result.gateOutProcessed = true
        startTruckDeparture(truck, state.simTime)
      }
      break
    }

    case 'departing': {
      const done = advanceWaypoints(truck, TRUCK_SPEED, dt)
      if (done) {
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
  // Waypoints built lazily in returning_to_gate handler
  truck.waypoints = buildWaypoints(truck.position, GATE_OUTGATE_POSITION)
  truck.waypointIndex = 0
  truck.targetPosition = truck.waypoints[0] ?? GATE_OUTGATE_POSITION
}

export function startTruckDeparture(truck: TruckVisit, simTime: number): void {
  truck.state = 'departing'
  truck.stateStartTime = simTime
  // Exit: drive from out-gate further along +Z
  const exitPos: Position3D = { x: GATE_OUTGATE_POSITION.x, y: 0, z: GATE_OUTGATE_POSITION.z + 40 }
  truck.waypoints = buildWaypoints(truck.position, exitPos)
  truck.waypointIndex = 0
  truck.targetPosition = truck.waypoints[0] ?? exitPos
}

// For export trucks after dropping container: send to out-gate
export function startExportTruckExit(truck: TruckVisit, simTime: number): void {
  startTruckReturnToGate(truck, simTime)
}
