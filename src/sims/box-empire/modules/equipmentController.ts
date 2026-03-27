// ---------------------------------------------------------------------------
// Box Empire — Equipment state machine & movement
// ---------------------------------------------------------------------------
// Key design decisions:
//  - Reach Stacker: travels to a *parking position* offset in front of the
//    target slot, then picks/drops by extending its boom. The body never
//    enters the stack footprint.
//  - Mobile Harbor Crane: base is FIXED. It never translates. Only armTargetY
//    changes to animate the spreader swinging between vessel and quay buffer.
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
  RS_TRUCK_PARK_OFFSET,

} from './config'
import { isContainerOnTop } from './yardManager'

// How far (metres) the RS parks from a yard slot target (in Z, approaching from +Z side)
const RS_PARK_OFFSET = 5.5
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

// Build axis-aligned waypoints: move Z first (to align row), then X (to reach bay)
// RS approaches from +Z (road side), so Z alignment first makes sense
function buildRsWaypoints(from: Position3D, to: Position3D): Position3D[] {
  const pts: Position3D[] = []
  // Corner: same Z as dest, same X as start
  if (Math.abs(from.z - to.z) > 0.5) {
    pts.push({ x: from.x, y: 0, z: to.z })
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
function rsParkingPosition(targetPos: Position3D): Position3D {
  return { x: targetPos.x, y: 0, z: targetPos.z + RS_PARK_OFFSET }
}

// For RS picking from a truck at YARD_IO: park RS_TRUCK_PARK_OFFSET metres on the +Z side
// so RS doesn't drive into the truck
function rsTruckParkingPosition(targetPos: Position3D): Position3D {
  return { x: targetPos.x, y: 0, z: targetPos.z + RS_TRUCK_PARK_OFFSET }
}

// Determine heading for RS at a given position facing a pickup/drop target
function rsFacingHeading(from: Position3D, to: Position3D): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
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
      // spreaderZ: negative = vessel side, positive = quay side
      eq.spreaderZ = job.pickupLocation.type === 'vessel_slot' ? -6 : 4
      eq.state = 'picking'
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      job.status = 'in_progress'
      break
    }

    case 'travel_to_pickup': {
      // Should not happen for MHC, but handle gracefully
      eq.state = 'picking'
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      job.status = 'in_progress'
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
            position: { x: eq.position.x, y: eq.armTargetY, z: eq.position.z },
          }
          result.pickedContainerId = container.id
        }
        // Swing spreader to drop side
        eq.spreaderZ = job.dropoffLocation.type === 'vessel_slot' ? -6 : 4
        eq.armDropStartY = eq.armTargetY   // remember current height for drop lerp
        eq.state = 'dropping'
        eq.targetPosition = { ...job.dropoffLocation.position }
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }

    case 'travel_to_drop': {
      // MHC doesn't travel; jump straight to dropping
      eq.armDropStartY = eq.armTargetY
      eq.state = 'dropping'
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      break
    }

    case 'dropping': {
      const dropTargetY = job.dropoffLocation.position.y
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
        ? rsTruckParkingPosition(job.pickupLocation.position)
        : rsParkingPosition(job.pickupLocation.position)
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
          ? rsTruckParkingPosition(job.pickupLocation.position)
          : rsParkingPosition(job.pickupLocation.position)
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
          ? rsTruckParkingPosition(job.dropoffLocation.position)
          : rsParkingPosition(job.dropoffLocation.position)
        eq.waypoints = buildRsWaypoints(eq.position, dropPark)
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
          ? rsTruckParkingPosition(job.dropoffLocation.position)
          : rsParkingPosition(job.dropoffLocation.position)
        eq.waypoints = buildRsWaypoints(eq.position, dropPark)
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
