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
} from './config'
import { isContainerOnTop } from './yardManager'

// How far (metres) the reach stacker body parks away from the target container
// in the Z direction so it does not drive into the stack.
const RS_PARK_OFFSET = 5.5

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

// For reach stacker: compute a parking position in front of the target.
// The RS approaches from the +Z side (from the road), so park at target.z + offset.
function rsParkingPosition(targetPos: Position3D): Position3D {
  return { x: targetPos.x, y: 0, z: targetPos.z + RS_PARK_OFFSET }
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
      const parkPos = rsParkingPosition(job.pickupLocation.position)
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
        const parkPos = rsParkingPosition(job.pickupLocation.position)
        eq.waypoints = buildRsWaypoints(eq.position, parkPos)
        eq.waypointIndex = 0
      }
      const arrived = advanceRsWaypoints(eq, getTravelSpeed(eq, false), dt)
      if (arrived) {
        // Pre-pick accessibility check
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
          // Container sits at the pickup slot (where it actually is)
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

        const dropPark = rsParkingPosition(job.dropoffLocation.position)
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
        const dropPark = rsParkingPosition(job.dropoffLocation.position)
        eq.waypoints = buildRsWaypoints(eq.position, dropPark)
        eq.waypointIndex = 0
      }
      const travelArrived = advanceRsWaypoints(eq, getTravelSpeed(eq, true), dt)
      if (eq.carriedContainerId) {
        const container = state.containers.find(c => c.id === eq.carriedContainerId)
        if (container) {
          // Container rides above RS at travel height, aligned on current waypoint X,Z
          container.currentLocation.position = {
            x: eq.position.x,
            y: eq.armTargetY,
            z: eq.position.z,
          }
        }
      }
      if (travelArrived) {
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
