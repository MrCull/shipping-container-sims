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
  CONTAINER_LENGTH,
  TRUCK_SPEED,
  GATE_PROCESSING_TIME,
  GATE_INGATE_POSITION,
  GATE_INGATE_LANE_X,
  GATE_OUTGATE_POSITION,
  GATE_OUTGATE_FENCE_Z,
  GATE_OUTGATE_QUEUE_LENGTH,
  YARD_TRUCK_EXPORT_PARK_POSITION,
  YARD_TRUCK_IMPORT_PARK_POSITION,
  YARD_TRUCK_EXPORT_CONTAINER_POSITION,
  YARD_TRUCK_IMPORT_CONTAINER_POSITION,
} from './config'

let truckCounter = 0

const QUEUE_SPACING = 16
const YARD_ZONE_RADIUS = 12
const GATE_STOP_OFFSET = CONTAINER_LENGTH
const TRUCK_TURN_RUNOUT = 7.5
const YARD_STAND_OCCUPY_RADIUS = 4.5
const INGATE_QUEUE_HEADING = Math.PI

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
      z: GATE_INGATE_POSITION.z + GATE_STOP_OFFSET + queueIndex * QUEUE_SPACING,
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

function isIngateLaneOpen(state: BoxEmpireState, truck: TruckVisit): boolean {
  return truck.visitType === 'export_delivery'
    ? state.gatehouse.exportLaneOpen
    : state.gatehouse.importLaneOpen
}

function isOutgateLaneOpen(state: BoxEmpireState): boolean {
  return state.gatehouse.importLaneOpen
}

// Stable queue position for approaching trucks (along the gate lane, pure Z movement)
function ingateQueueZ(state: BoxEmpireState, thisTruck: TruckVisit): number {
  const ahead = state.truckVisits.filter(
    t =>
      t.id !== thisTruck.id &&
      t.queueIndex < thisTruck.queueIndex &&
      (
        t.state === 'approaching' ||
        t.state === 'at_gate' ||
        (t.state === 'driving_to_yard' && t.position.z < GATE_INGATE_POSITION.z + GATE_STOP_OFFSET + 8)
      ),
  ).length
  return GATE_INGATE_POSITION.z + GATE_STOP_OFFSET + ahead * QUEUE_SPACING
}

function isYardZoneBusy(state: BoxEmpireState, thisTruckId: string): boolean {
  const thisTruck = state.truckVisits.find(t => t.id === thisTruckId)
  const stand = thisTruck?.visitType === 'import_pickup'
    ? YARD_TRUCK_IMPORT_PARK_POSITION
    : YARD_TRUCK_EXPORT_PARK_POSITION
  return state.truckVisits.some(t => {
    if (t.id === thisTruckId) return false
    if (t.state !== 'waiting_for_equipment' && t.state !== 'driving_to_yard') return false
    const otherStand = t.visitType === 'import_pickup'
      ? YARD_TRUCK_IMPORT_PARK_POSITION
      : YARD_TRUCK_EXPORT_PARK_POSITION
    if (Math.abs(otherStand.x - stand.x) > 1) return false
    const dx = t.position.x - stand.x
    const dz = t.position.z - stand.z
    const distToStand = Math.sqrt(dx * dx + dz * dz)
    if (t.state === 'waiting_for_equipment') return distToStand < YARD_ZONE_RADIUS
    return distToStand < YARD_STAND_OCCUPY_RADIUS
  })
}

function outgateHoldZ(state: BoxEmpireState, thisTruck: TruckVisit): number {
  const waiters = state.truckVisits.filter(
    t =>
      t.id !== thisTruck.id &&
      t.state === 'returning_to_gate' &&
      t.queueIndex < thisTruck.queueIndex,
  ).length
  return GATE_OUTGATE_FENCE_Z - GATE_STOP_OFFSET - waiters * QUEUE_SPACING
}

function buildOutgateApproachWaypoints(from: Position3D, to: Position3D): Position3D[] {
  const queueStartZ = GATE_OUTGATE_FENCE_Z - GATE_OUTGATE_QUEUE_LENGTH
  const pts: Position3D[] = []
  if (Math.abs(from.z - queueStartZ) > 0.5) {
    pts.push({ x: from.x, y: 0, z: queueStartZ })
  }
  if (Math.abs(from.x - GATE_OUTGATE_POSITION.x) > 0.5) {
    pts.push({ x: GATE_OUTGATE_POSITION.x, y: 0, z: queueStartZ })
  }
  if (Math.abs(queueStartZ - to.z) > 0.5) {
    pts.push({ x: GATE_OUTGATE_POSITION.x, y: 0, z: to.z })
  }
  return pts
}

function clampForwardOnly(currentZ: number, targetZ: number): number {
  // Trucks approach the gate by reducing Z; never command a reverse move while queuing.
  return Math.min(currentZ, targetZ)
}

function getIngateBlockedStopZ(state: BoxEmpireState, thisTruck: TruckVisit, desiredZ: number): number {
  let blockedZ = desiredZ
  for (const other of state.truckVisits) {
    if (other.id === thisTruck.id) continue
    if (Math.abs(other.position.x - GATE_INGATE_LANE_X) > 1.5) continue
    if (other.position.z >= thisTruck.position.z) continue
    if (
      other.state !== 'approaching' &&
      other.state !== 'at_gate' &&
      !(other.state === 'driving_to_yard' && other.position.z < GATE_INGATE_POSITION.z + GATE_STOP_OFFSET + 10)
    ) continue
    blockedZ = Math.max(blockedZ, other.position.z + QUEUE_SPACING)
  }
  return blockedZ
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
      const baseGateZ = GATE_INGATE_POSITION.z + GATE_STOP_OFFSET
      if (isIngateFree(state, truck.id) && isIngateLaneOpen(state, truck)) {
        // Stop short of the barrier until gate processing completes.
        const gatePos = {
          x: GATE_INGATE_LANE_X,
          y: 0,
          z: clampForwardOnly(
            truck.position.z,
            getIngateBlockedStopZ(state, truck, baseGateZ),
          ),
        }
        truck.targetPosition = gatePos
        truck.headingY = INGATE_QUEUE_HEADING
        const { position, arrived } = moveTowards(truck.position, gatePos, TRUCK_SPEED, dt)
        truck.position = position
        if (arrived && Math.abs(gatePos.z - baseGateZ) < 0.1) {
          truck.state = 'at_gate'
          truck.stateStartTime = state.simTime
          result.arrived = true
        }
      } else {
        const holdZ = clampForwardOnly(
          truck.position.z,
          getIngateBlockedStopZ(state, truck, ingateQueueZ(state, truck)),
        )
        const holdPos = { x: GATE_INGATE_LANE_X, y: 0, z: holdZ }
        truck.targetPosition = holdPos
        // Only move if not at hold position
        if (Math.abs(truck.position.z - holdZ) > 0.5) {
          truck.headingY = INGATE_QUEUE_HEADING
          const { position } = moveTowards(truck.position, holdPos, TRUCK_SPEED, dt)
          truck.position = position
        }
        truck.headingY = INGATE_QUEUE_HEADING
      }
      break
    }

    case 'at_gate': {
      truck.headingY = INGATE_QUEUE_HEADING
      if (!isIngateLaneOpen(state, truck)) break
      const elapsed = state.simTime - truck.stateStartTime
      if (elapsed >= GATE_PROCESSING_TIME) {
        // After acceptance: roll forward into the terminal before turning across.
        const runoutPos = {
          x: truck.position.x,
          y: 0,
          z: GATE_INGATE_POSITION.z + GATE_STOP_OFFSET - TRUCK_TURN_RUNOUT,
        }
        const yardStand = truck.visitType === 'import_pickup'
          ? YARD_TRUCK_IMPORT_PARK_POSITION
          : YARD_TRUCK_EXPORT_PARK_POSITION
        truck.waypoints = [runoutPos, ...buildWaypoints(runoutPos, yardStand)]
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
      const gateHoldPos = { x: GATE_OUTGATE_POSITION.x, y: 0, z: GATE_OUTGATE_FENCE_Z - GATE_STOP_OFFSET }
      if (truck.waypointIndex >= truck.waypoints.length) {
        truck.waypoints = buildOutgateApproachWaypoints(truck.position, gateHoldPos)
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

      if (!isOutgateLaneOpen(state)) {
        const holdZ = Math.max(outgateHoldZ(state, truck), gateHoldPos.z)
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
        truck.targetPosition = gateHoldPos
      }
      break
    }

    case 'at_gate_out': {
      if (!isOutgateLaneOpen(state)) break
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
  const gateHoldPos = { x: GATE_OUTGATE_POSITION.x, y: 0, z: GATE_OUTGATE_FENCE_Z - GATE_STOP_OFFSET }
  truck.waypoints = buildOutgateApproachWaypoints(truck.position, gateHoldPos)
  truck.waypointIndex = 0
  truck.targetPosition = truck.waypoints[0] ?? gateHoldPos
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

export function getTruckYardStandPosition(): Position3D {
  return { ...YARD_TRUCK_PARK_POSITION }
}

export function getTruckYardStandPositionForVisitType(
  visitType: 'import_pickup' | 'export_delivery',
): Position3D {
  return visitType === 'import_pickup'
    ? { ...YARD_TRUCK_IMPORT_PARK_POSITION }
    : { ...YARD_TRUCK_EXPORT_PARK_POSITION }
}

export function getTruckContainerPosition(): Position3D {
  return { ...YARD_TRUCK_CONTAINER_POSITION }
}

export function getTruckContainerPositionForVisitType(
  visitType: 'import_pickup' | 'export_delivery',
): Position3D {
  return visitType === 'import_pickup'
    ? { ...YARD_TRUCK_IMPORT_CONTAINER_POSITION }
    : { ...YARD_TRUCK_EXPORT_CONTAINER_POSITION }
}

// Export for config import
export { GATE_INGATE_LANE_X }
