// ---------------------------------------------------------------------------
// Box Empire — Equipment state machine & movement
// ---------------------------------------------------------------------------
// Key design decisions:
//  - Reach Stacker: travels to a *parking position* offset in front of the
//    target slot, then picks/drops by extending its boom. The body never
//    enters the stack footprint.
//  - Mobile Harbor Crane: base is FIXED. It never translates. Only armTargetY
//    and targetPosition/reach commands change; the renderer handles slew,
//    trolley travel, and hoist geometry from that state.
// ---------------------------------------------------------------------------

import type {
  Equipment,
  BoxEmpireState,
  Position3D,
} from '../types'
import {
  RS_SPEED_UNLADEN,
  RS_SPEED_LADEN,
  RS_PICK_CYCLE_TIME,
  RS_PLACE_CYCLE_TIME,
  MHC_CYCLE_TIME,
  CONTAINER_HEIGHT,
  RS_TRUCK_PARK_OFFSET,
  RS_YARD_PARK_OFFSET,
} from './config'
import { isContainerOnTop } from './yardManager'

// How far (metres) the RS parks from a yard slot target (in Z, approaching from +Z side)
const RS_PARK_OFFSET = RS_YARD_PARK_OFFSET
// RS faces a slot: +Z side of stack → headingY = π (facing -Z)


function distanceTo(a: Position3D, b: Position3D): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function moveTowards(
  current: Position3D,
  target: Position3D,
  speed: number,
  dt: number,
): { position: Position3D; arrived: boolean } {
  const d = distanceTo(current, target)
  const step = speed * dt
  if (d <= step || d < 0.1) {
    return { position: { x: target.x, y: 0, z: target.z }, arrived: true }
  }
  const ratio = step / d
  return {
    position: {
      x: current.x + (target.x - current.x) * ratio,
      y: 0,
      z: current.z + (target.z - current.z) * ratio,
    },
    arrived: false,
  }
}

// Yard container band (single row centred at z=20, WIDTH=2.44m) + RS body clearance.
// Any path that crosses this Z range would drive through the container stacks.
const YARD_SEA_EDGE_Z  = 16.5   // sea-side safe limit  (row front – clearance)
const YARD_ROAD_EDGE_Z = 23.5   // road-side safe limit (row rear  + clearance)
// X position clear of ALL yard containers (leftmost bay starts at x=−15).
// Used as a bypass lane to cross the yard band without hitting stacks.
const YARD_BYPASS_X    = -19.0
const YARD_LANDSIDE_SERVICE_Z = YARD_ROAD_EDGE_Z + 3.0

// Build axis-aligned waypoints, routing around the container yard band when needed.
function buildRsWaypoints(from: Position3D, to: Position3D, preferXFirst: boolean = false): Position3D[] {
  const pts: Position3D[] = []

  const minZ = Math.min(from.z, to.z)
  const maxZ = Math.max(from.z, to.z)
  const crossesYard = minZ < YARD_SEA_EDGE_Z && maxZ > YARD_ROAD_EDGE_Z

  if (crossesYard) {
    // Route via bypass lane left of all containers to avoid driving through stacks.
    // Use the further-left of the current X or the bypass X to avoid backtracking.
    const bypassX = Math.min(from.x, YARD_BYPASS_X)
    pts.push({ x: bypassX, y: 0, z: from.z })  // move to bypass lane (safe side)
    pts.push({ x: bypassX, y: 0, z: to.z })    // cross the yard band on bypass lane
    pts.push({ x: to.x,    y: 0, z: to.z })    // approach target X
  } else {
    if (preferXFirst) {
      if (Math.abs(from.x - to.x) > 0.5) {
        pts.push({ x: to.x, y: 0, z: from.z })
      }
      pts.push({ x: to.x, y: 0, z: to.z })
    } else {
      // Standard routing: align Z first, then X
      if (Math.abs(from.z - to.z) > 0.5) {
        pts.push({ x: from.x, y: 0, z: to.z })
      }
      pts.push({ x: to.x, y: 0, z: to.z })
    }
  }

  return pts
}

function buildRsYardToTruckWaypoints(from: Position3D, to: Position3D): Position3D[] {
  const pts: Position3D[] = []
  const serviceLaneZ = Math.max(from.z, YARD_LANDSIDE_SERVICE_Z)

  if (Math.abs(from.z - serviceLaneZ) > 0.5) {
    pts.push({ x: from.x, y: 0, z: serviceLaneZ })
  }
  if (Math.abs(from.x - to.x) > 0.5) {
    pts.push({ x: to.x, y: 0, z: serviceLaneZ })
  }
  pts.push({ x: to.x, y: 0, z: to.z })

  return pts
}

function buildRsTruckToYardWaypoints(from: Position3D, to: Position3D): Position3D[] {
  const pts: Position3D[] = []
  const serviceLaneZ = Math.max(from.z, YARD_LANDSIDE_SERVICE_Z)

  if (Math.abs(from.z - serviceLaneZ) > 0.5) {
    pts.push({ x: from.x, y: 0, z: serviceLaneZ })
  }
  if (Math.abs(from.x - to.x) > 0.5) {
    pts.push({ x: to.x, y: 0, z: serviceLaneZ })
  }
  pts.push({ x: to.x, y: 0, z: to.z })

  return pts
}

function advanceRsWaypoints(eq: Equipment, speed: number, dt: number): boolean {
  if (eq.waypointIndex >= eq.waypoints.length) return true
  const wp = eq.waypoints[eq.waypointIndex]
  eq.targetPosition = wp
  const { position, arrived } = moveTowards(eq.position, wp, speed, dt)
  eq.position = position
  eq.position.y = 0
  if (arrived) {
    eq.waypointIndex++
    if (eq.waypointIndex >= eq.waypoints.length) return true
  }
  return false
}

// For RS picking/dropping at yard slots: park RS_PARK_OFFSET behind target (in +Z)
function chooseClosestPosition(from: Position3D, candidates: Position3D[]): Position3D {
  return candidates.reduce((best, candidate) =>
    distanceTo(from, candidate) <= distanceTo(from, best) ? candidate : best,
  )
}

function rsParkingPosition(currentPos: Position3D, targetPos: Position3D): Position3D {
  return chooseClosestPosition(currentPos, [
    { x: targetPos.x, y: 0, z: targetPos.z + RS_PARK_OFFSET },
    { x: targetPos.x, y: 0, z: targetPos.z - RS_PARK_OFFSET },
  ])
}

// For RS picking/dropping at a truck at YARD_IO: park RS_TRUCK_PARK_OFFSET metres to the +X side
// so the RS approaches the long face of the container (container length runs along truck Z axis).
// targetPos is YARD_IO_CONTAINER_POSITION (the actual container world position, z=34),
// so no extra Z offset is needed — the RS parks directly beside the container.
function rsTruckParkingPosition(currentPos: Position3D, targetPos: Position3D): Position3D {
  return chooseClosestPosition(currentPos, [
    { x: targetPos.x + RS_TRUCK_PARK_OFFSET, y: 0, z: targetPos.z },
    { x: targetPos.x - RS_TRUCK_PARK_OFFSET, y: 0, z: targetPos.z },
  ])
}

// Determine heading for RS at a given position facing a pickup/drop target
function rsFacingHeading(from: Position3D, to: Position3D): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

function shouldUseStackHuggingRoute(job: import('../types').Job): boolean {
  return job.pickupLocation.type === 'yard_slot' && job.dropoffLocation.type === 'truck'
}

function buildRsDropWaypoints(
  from: Position3D,
  to: Position3D,
  job: import('../types').Job,
): Position3D[] {
  if (shouldUseStackHuggingRoute(job)) {
    return buildRsYardToTruckWaypoints(from, to)
  }
  if (job.pickupLocation.type === 'truck' && job.dropoffLocation.type === 'yard_slot') {
    return buildRsTruckToYardWaypoints(from, to)
  }
  return buildRsWaypoints(from, to)
}

function getPickDuration(eq: Equipment): number {
  if (eq.type === 'mobile_harbor_crane') return MHC_CYCLE_TIME / 2
  return RS_PICK_CYCLE_TIME
}

function getDropDuration(eq: Equipment): number {
  if (eq.type === 'mobile_harbor_crane') return MHC_CYCLE_TIME / 2
  return RS_PLACE_CYCLE_TIME
}

function getTravelSpeed(eq: Equipment, laden: boolean): number {
  if (eq.type === 'mobile_harbor_crane') return 0  // MHC never translates
  return laden ? RS_SPEED_LADEN : RS_SPEED_UNLADEN
}

const MHC_TRAVEL_HOIST_Y = 10.5
const MHC_SPREADER_CLEARANCE_Y = 0.55

function getMhcSpreaderTargetY(containerCenterY: number): number {
  return containerCenterY + CONTAINER_HEIGHT / 2 + MHC_SPREADER_CLEARANCE_Y
}

function getMhcReachCommand(cranePosition: Position3D, target: Position3D): number {
  const dx = target.x - cranePosition.x
  const dz = target.z - cranePosition.z
  const reach = Math.sqrt(dx * dx + dz * dz)
  return dz >= 0 ? reach : -reach
}

export interface EquipmentTickResult {
  jobCompleted: boolean
  jobId: string | null
  pickedContainerId: string | null
  droppedContainerId: string | null
  jobBlocked: boolean
}

export function tickEquipment(
  eq: Equipment,
  state: BoxEmpireState,
  dt: number,
): EquipmentTickResult {
  const result: EquipmentTickResult = {
    jobCompleted: false,
    jobId: null,
    pickedContainerId: null,
    droppedContainerId: null,
    jobBlocked: false,
  }

  if (!eq.enabled) return result
  if (eq.state === 'idle' || !eq.currentJobId) return result

  const job = state.jobs.find(j => j.id === eq.currentJobId)
  if (!job) {
    eq.state = 'idle'
    eq.currentJobId = null
    return result
  }

  // MHC: base is always fixed; skip any translation completely.
  // Just animate armTargetY through the pick/drop cycle.
  if (eq.type === 'mobile_harbor_crane') {
    return tickMhc(eq, job, state, dt, result)
  }

  // Reach stacker
  return tickReachStacker(eq, job, state, dt, result)
}

function tickMhc(
  eq: Equipment,
  job: import('../types').Job,
  state: BoxEmpireState,
  dt: number,
  result: EquipmentTickResult,
): EquipmentTickResult {
  eq.stateElapsed += dt

  switch (eq.state) {
    case 'assigned': {
      // Transition straight to picking; base does not move.
      eq.targetPosition = { ...job.pickupLocation.position }
      eq.spreaderZ = getMhcReachCommand(eq.position, job.pickupLocation.position)
      eq.armTargetY = MHC_TRAVEL_HOIST_Y
      eq.state = 'picking'
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      job.status = 'in_progress'
      break
    }

    case 'travel_to_pickup': {
      // Should not happen for MHC, but handle gracefully
      eq.targetPosition = { ...job.pickupLocation.position }
      eq.spreaderZ = getMhcReachCommand(eq.position, job.pickupLocation.position)
      eq.armTargetY = MHC_TRAVEL_HOIST_Y
      eq.state = 'picking'
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      job.status = 'in_progress'
      break
    }

    case 'picking': {
      eq.targetPosition = { ...job.pickupLocation.position }
      eq.spreaderZ = getMhcReachCommand(eq.position, job.pickupLocation.position)
      const pickTargetY = getMhcSpreaderTargetY(job.pickupLocation.position.y)
      const pickProgress = Math.min(1, eq.stateElapsed / getPickDuration(eq))
      eq.armTargetY = MHC_TRAVEL_HOIST_Y + (pickTargetY - MHC_TRAVEL_HOIST_Y) * pickProgress

      if (eq.stateElapsed >= getPickDuration(eq)) {
        const container = state.containers.find(c => c.id === job.containerId)
        if (container) {
          eq.carriedContainerId = container.id
          container.currentLocation = {
            type: 'equipment',
            id: eq.id,
            position: { x: eq.position.x, y: eq.armTargetY, z: eq.position.z },
          }
          result.pickedContainerId = container.id
        }
        eq.targetPosition = { ...job.dropoffLocation.position }
        eq.spreaderZ = getMhcReachCommand(eq.position, job.dropoffLocation.position)
        eq.armTargetY = MHC_TRAVEL_HOIST_Y
        eq.armDropStartY = MHC_TRAVEL_HOIST_Y
        eq.state = 'dropping'
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }

    case 'travel_to_drop': {
      // MHC doesn't travel; jump straight to dropping
      eq.targetPosition = { ...job.dropoffLocation.position }
      eq.spreaderZ = getMhcReachCommand(eq.position, job.dropoffLocation.position)
      eq.armTargetY = MHC_TRAVEL_HOIST_Y
      eq.armDropStartY = MHC_TRAVEL_HOIST_Y
      eq.state = 'dropping'
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      break
    }

    case 'dropping': {
      eq.targetPosition = { ...job.dropoffLocation.position }
      eq.spreaderZ = getMhcReachCommand(eq.position, job.dropoffLocation.position)
      const dropTargetY = getMhcSpreaderTargetY(job.dropoffLocation.position.y)
      const dropProgress = Math.min(1, eq.stateElapsed / getDropDuration(eq))
      // Lerp from pickup height (armDropStartY) down to the drop target Y
      eq.armTargetY = eq.armDropStartY + (dropTargetY - eq.armDropStartY) * dropProgress

      if (eq.carriedContainerId) {
        const container = state.containers.find(c => c.id === eq.carriedContainerId)
        if (container) {
          // Animate container position between pickup and dropoff
          const pickPos = job.pickupLocation.position
          const dropPos = job.dropoffLocation.position
          container.currentLocation.position = {
            x: pickPos.x + (dropPos.x - pickPos.x) * dropProgress,
            y: eq.armTargetY,
            z: pickPos.z + (dropPos.z - pickPos.z) * dropProgress,
          }
        }
      }

      if (eq.stateElapsed >= getDropDuration(eq)) {
        result.droppedContainerId = eq.carriedContainerId
        result.jobCompleted = true
        result.jobId = job.id
        eq.carriedContainerId = null
        eq.state = 'idle'
        eq.currentJobId = null
        eq.targetPosition = null
        eq.armTargetY = 0
        eq.armDropStartY = 0
        eq.spreaderZ = 0
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }
  }

  return result
}

function tickReachStacker(
  eq: Equipment,
  job: import('../types').Job,
  state: BoxEmpireState,
  dt: number,
  result: EquipmentTickResult,
): EquipmentTickResult {
  eq.stateElapsed += dt

  switch (eq.state) {
    case 'assigned': {
      eq.state = 'travel_to_pickup'
      // For truck pickups (at YARD_IO), use RS_TRUCK_PARK_OFFSET so RS doesn't drive into truck
      // For yard/quay pickups, use RS_PARK_OFFSET
      const isPickFromTruck = job.pickupLocation.type === 'truck'
      const parkPos = isPickFromTruck
        ? rsTruckParkingPosition(eq.position, job.pickupLocation.position)
        : rsParkingPosition(eq.position, job.pickupLocation.position)
      eq.waypoints = buildRsWaypoints(eq.position, parkPos)
      eq.waypointIndex = 0
      eq.targetPosition = eq.waypoints[0] ?? parkPos
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      eq.speed = getTravelSpeed(eq, false)
      break
    }

    case 'travel_to_pickup': {
      if (eq.waypoints.length === 0) {
        const isPickFromTruck = job.pickupLocation.type === 'truck'
        const parkPos = isPickFromTruck
          ? rsTruckParkingPosition(eq.position, job.pickupLocation.position)
          : rsParkingPosition(eq.position, job.pickupLocation.position)
        eq.waypoints = buildRsWaypoints(eq.position, parkPos)
        eq.waypointIndex = 0
      }
      const arrived = advanceRsWaypoints(eq, getTravelSpeed(eq, false), dt)
      // Update heading to face the pickup target
      eq.headingY = rsFacingHeading(eq.position, job.pickupLocation.position)
      if (arrived) {
        // Pre-pick accessibility check for yard slots
        if (job.pickupLocation.type === 'yard_slot') {
          const yard = state.yardBlocks[0]
          if (yard) {
            const accessible = isContainerOnTop(yard, job.containerId)
            if (!accessible) {
              job.status = 'blocked'
              result.jobBlocked = true
              eq.state = 'idle'
              eq.currentJobId = null
              eq.targetPosition = null
              break
            }
          }
        }
        // Face pickup target when parked
        eq.headingY = rsFacingHeading(eq.position, job.pickupLocation.position)
        eq.state = 'picking'
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }

    case 'picking': {
      const pickTargetY = job.pickupLocation.position.y
      const pickProgress = Math.min(1, eq.stateElapsed / getPickDuration(eq))
      eq.armTargetY = pickTargetY * pickProgress

      if (eq.stateElapsed >= getPickDuration(eq)) {
        const container = state.containers.find(c => c.id === job.containerId)
        if (container) {
          eq.carriedContainerId = container.id
          container.currentLocation = {
            type: 'equipment',
            id: eq.id,
            position: { ...job.pickupLocation.position, y: eq.armTargetY },
          }
          result.pickedContainerId = container.id
        }
        // Raise arm to travel-safe height
        const dropTargetY = job.dropoffLocation.position.y
        const travelHeight = Math.max(pickTargetY, dropTargetY) + 1.5
        eq.armTargetY = travelHeight

        // Drop position: same side as approach (+Z park offset for yard; truck offset for truck drop)
        const isDropToTruck = job.dropoffLocation.type === 'truck'
        const dropPark = isDropToTruck
          ? rsTruckParkingPosition(eq.position, job.dropoffLocation.position)
          : rsParkingPosition(eq.position, job.dropoffLocation.position)
        eq.waypoints = buildRsDropWaypoints(eq.position, dropPark, job)
        eq.waypointIndex = 0
        eq.targetPosition = eq.waypoints[0] ?? dropPark
        eq.state = 'travel_to_drop'
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
        eq.speed = getTravelSpeed(eq, true)
        job.status = 'in_progress'
      }
      break
    }

    case 'travel_to_drop': {
      if (eq.waypoints.length === 0) {
        const isDropToTruck = job.dropoffLocation.type === 'truck'
        const dropPark = isDropToTruck
          ? rsTruckParkingPosition(eq.position, job.dropoffLocation.position)
          : rsParkingPosition(eq.position, job.dropoffLocation.position)
        eq.waypoints = buildRsDropWaypoints(eq.position, dropPark, job)
        eq.waypointIndex = 0
      }
      // Update heading to face the dropoff target
      eq.headingY = rsFacingHeading(eq.position, job.dropoffLocation.position)
      const travelArrived = advanceRsWaypoints(eq, getTravelSpeed(eq, true), dt)
      if (eq.carriedContainerId) {
        const container = state.containers.find(c => c.id === eq.carriedContainerId)
        if (container) {
          container.currentLocation.position = {
            x: eq.position.x,
            y: eq.armTargetY,
            z: eq.position.z,
          }
        }
      }
      if (travelArrived) {
        // Face dropoff target once parked
        eq.headingY = rsFacingHeading(eq.position, job.dropoffLocation.position)
        eq.armDropStartY = eq.armTargetY
        eq.state = 'dropping'
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }

    case 'dropping': {
      const dropTargetY = job.dropoffLocation.position.y
      const dropProgress = Math.min(1, eq.stateElapsed / getDropDuration(eq))
      eq.armTargetY = eq.armDropStartY + (dropTargetY - eq.armDropStartY) * dropProgress

      if (eq.carriedContainerId) {
        const container = state.containers.find(c => c.id === eq.carriedContainerId)
        if (container) {
          // Container stays at drop slot X,Z while arm lowers
          container.currentLocation.position = {
            x: job.dropoffLocation.position.x,
            y: eq.armTargetY,
            z: job.dropoffLocation.position.z,
          }
        }
      }

      if (eq.stateElapsed >= getDropDuration(eq)) {
        result.droppedContainerId = eq.carriedContainerId
        result.jobCompleted = true
        result.jobId = job.id
        eq.carriedContainerId = null
        eq.state = 'idle'
        eq.currentJobId = null
        eq.targetPosition = null
        eq.armTargetY = 0
        eq.armDropStartY = 0
        eq.spreaderZ = 0
        eq.waypoints = []
        eq.waypointIndex = 0
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }
  }

  return result
}
