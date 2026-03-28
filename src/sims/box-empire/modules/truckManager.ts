// ---------------------------------------------------------------------------
// Box Empire — Truck lifecycle with axis-aligned movement and unified gates
// ---------------------------------------------------------------------------
//
// Gate design:
//   IN-GATE  (GATE_INGATE_POSITION): ALL trucks enter here.
//            Queue runs along +Z outside terminal at GATE_INGATE_LANE_X.
//            Lane is offset to the side of the gatehouse building.
//   OUT-GATE (GATE_OUTGATE_POSITION): ALL trucks exit here (right fence, +X side).
//
// Movement: axis-aligned only. Trucks follow a waypoint list.
// Collision: trucks wait when yard zone is busy; out-gate queue uses stable positions.
// ---------------------------------------------------------------------------

import type { TruckVisit, Position3D, BoxEmpireState } from '../types'
import {
  TRUCK_SPEED,
  GATE_PROCESSING_TIME,
  GATE_INGATE_POSITION,
  GATE_INGATE_LANE_X,
  GATE_OUTGATE_POSITION,
  GATE_OUTGATE_FENCE_Z,
  YARD_IO_POSITION,
} from './config'

let truckCounter = 0

const QUEUE_SPACING = 16
const YARD_ZONE_RADIUS = 12

export function resetTruckCounter(): void {
  truckCounter = 0
}

export function createTruck(
  containerId: string | null,
  visitType: 'import_pickup' | 'export_delivery',
): TruckVisit {
  truckCounter++
  const queueIndex = truckCounter

  return {
    id: `truck-${truckCounter}`,
    state: 'approaching',
    containerId,
    visitType,
    position: {
      x: GATE_INGATE_LANE_X,
      y: 0,
      z: GATE_INGATE_POSITION.z + queueIndex * QUEUE_SPACING,
    },
    targetPosition: { ...GATE_INGATE_POSITION },
    stateStartTime: 0,
    queueIndex,
    waypoints: [],
    waypointIndex: 0,
    headingY: -Math.PI,  // initially facing toward gate (negative Z direction)
  }
}

// ---- Axis-aligned movement -----------------------------------------------

// Build waypoints: move X first, then Z to reach destination
// (trucks enter terminal on the lane X, then turn and drive Z inward)
function buildWaypoints(from: Position3D, to: Position3D): Position3D[] {
  const pts: Position3D[] = []
  if (Math.abs(from.x - to.x) > 0.5) {
    pts.push({ x: to.x, y: 0, z: from.z })
  }
  pts.push({ x: to.x, y: 0, z: to.z })
  return pts
}

function moveTowards(
  current: Position3D,
  target: Position3D,
  speed: number,
  dt: number,
): { position: Position3D; arrived: boolean } {
  const dx = target.x - current.x
  const dz = target.z - current.z
  const d = Math.sqrt(dx * dx + dz * dz)
  const step = speed * dt
  if (d <= step || d < 0.5) {
    return { position: { x: target.x, y: 0, z: target.z }, arrived: true }
  }
  const ratio = step / d
  return {
    position: { x: current.x + dx * ratio, y: 0, z: current.z + dz * ratio },
    arrived: false,
  }
}

function advanceWaypoints(truck: TruckVisit, speed: number, dt: number): boolean {
  if (truck.waypointIndex >= truck.waypoints.length) return true

  const wp = truck.waypoints[truck.waypointIndex]!
  truck.targetPosition = wp

  const dx = wp.x - truck.position.x
  const dz = wp.z - truck.position.z
  if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
    truck.headingY = Math.atan2(dx, dz)
  }

  const { position, arrived } = moveTowards(truck.position, wp, speed, dt)
  truck.position = position

  if (arrived) {
    truck.waypointIndex++
    return truck.waypointIndex >= truck.waypoints.length
  }
  return false
}

// ---- Collision helpers ----------------------------------------------------

function isIngateFree(state: BoxEmpireState, thisTruckId: string): boolean {
  return !state.truckVisits.some(t => t.id !== thisTruckId && t.state === 'at_gate')
}

function isOutgateFree(state: BoxEmpireState, thisTruckId: string): boolean {
  return !state.truckVisits.some(t => t.id !== thisTruckId && t.state === 'at_gate_out')
}

// Stable queue position for approaching trucks (along the gate lane, pure Z movement)
function ingateQueueZ(state: BoxEmpireState, thisTruck: TruckVisit): number {
  const ahead = state.truckVisits.filter(
    t => t.id !== thisTruck.id && t.state === 'approaching' && t.queueIndex < thisTruck.queueIndex,
  ).length
  return GATE_INGATE_POSITION.z + (ahead + 1) * QUEUE_SPACING
}

function isYardZoneBusy(state: BoxEmpireState, thisTruckId: string): boolean {
  return state.truckVisits.some(t => {
    if (t.id === thisTruckId) return false
    if (t.state !== 'waiting_for_equipment' && t.state !== 'driving_to_yard') return false
    const dx = t.position.x - YARD_IO_POSITION.x
    const dz = t.position.z - YARD_IO_POSITION.z
    return Math.sqrt(dx * dx + dz * dz) < YARD_ZONE_RADIUS
  })
}

function outgateHoldZ(state: BoxEmpireState, thisTruck: TruckVisit): number {
  const waiters = state.truckVisits.filter(
    t =>
      t.id !== thisTruck.id &&
      t.state === 'returning_to_gate' &&
      t.queueIndex < thisTruck.queueIndex,
  ).length
  return GATE_OUTGATE_FENCE_Z - (waiters + 1) * QUEUE_SPACING
}

// ---- Main tick -----------------------------------------------------------

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
      // Queue runs along pure Z at fixed X=GATE_INGATE_LANE_X (no X movement during queue)
      if (isIngateFree(state, truck.id)) {
        // Advance straight to gate (pure -Z move)
        const gatePos = { x: GATE_INGATE_LANE_X, y: 0, z: GATE_INGATE_POSITION.z }
        truck.targetPosition = gatePos
        truck.headingY = Math.atan2(gatePos.x - truck.position.x, gatePos.z - truck.position.z)
        const { position, arrived } = moveTowards(truck.position, gatePos, TRUCK_SPEED, dt)
        truck.position = position
        if (arrived) {
          truck.state = 'at_gate'
          truck.stateStartTime = state.simTime
          result.arrived = true
        }
      } else {
        const holdZ = ingateQueueZ(state, truck)
        const holdPos = { x: GATE_INGATE_LANE_X, y: 0, z: holdZ }
        truck.targetPosition = holdPos
        // Only move if not at hold position
        if (Math.abs(truck.position.z - holdZ) > 0.5) {
          truck.headingY = Math.atan2(0, holdZ - truck.position.z)  // pure Z
          const { position } = moveTowards(truck.position, holdPos, TRUCK_SPEED, dt)
          truck.position = position
        }
      }
      break
    }

    case 'at_gate': {
      const elapsed = state.simTime - truck.stateStartTime
      if (elapsed >= GATE_PROCESSING_TIME) {
        // After gate: turn into terminal and drive to yard
        // Route: from gate → internal road X → YARD_IO
        truck.waypoints = buildWaypoints(truck.position, YARD_IO_POSITION)
        truck.waypointIndex = 0
        truck.state = 'driving_to_yard'
        truck.stateStartTime = state.simTime
        result.gateProcessed = true
      }
      break
    }

    case 'driving_to_yard': {
      if (isYardZoneBusy(state, truck.id)) break
      const done = advanceWaypoints(truck, TRUCK_SPEED, dt)
      if (done) {
        truck.state = 'waiting_for_equipment'
        truck.stateStartTime = state.simTime
        result.readyForEquipment = true
      }
      break
    }

    case 'waiting_for_equipment':
      break

    case 'returning_to_gate': {
      if (truck.waypointIndex >= truck.waypoints.length) {
        truck.waypoints = buildWaypoints(truck.position, GATE_OUTGATE_POSITION)
        truck.waypointIndex = 0
      }

      if (!isOutgateFree(state, truck.id)) {
        const holdZ = outgateHoldZ(state, truck)
        const holdPos = { x: GATE_OUTGATE_POSITION.x, y: 0, z: holdZ }
        truck.targetPosition = holdPos
        if (Math.abs(truck.position.z - holdZ) > 0.5 || Math.abs(truck.position.x - GATE_OUTGATE_POSITION.x) > 0.5) {
          const { position } = moveTowards(truck.position, holdPos, TRUCK_SPEED, dt)
          const dx = holdPos.x - truck.position.x
          const dz = holdPos.z - truck.position.z
          if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) truck.headingY = Math.atan2(dx, dz)
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
  truck.waypoints = buildWaypoints(truck.position, GATE_OUTGATE_POSITION)
  truck.waypointIndex = 0
  truck.targetPosition = truck.waypoints[0] ?? GATE_OUTGATE_POSITION
}

export function startTruckDeparture(truck: TruckVisit, simTime: number): void {
  truck.state = 'departing'
  truck.stateStartTime = simTime
  // Landward (+Z), away from berth / quay (−Z) — not out the terminal side toward the sea
  const exitPos: Position3D = { x: GATE_OUTGATE_POSITION.x, y: 0, z: GATE_OUTGATE_POSITION.z + 45 }
  truck.waypoints = buildWaypoints(truck.position, exitPos)
  truck.waypointIndex = 0
  truck.targetPosition = truck.waypoints[0] ?? exitPos
}

export function startExportTruckExit(truck: TruckVisit, simTime: number): void {
  startTruckReturnToGate(truck, simTime)
}

// Export for config import
export { GATE_INGATE_LANE_X }
