// ---------------------------------------------------------------------------
// Box Empire - Equipment state machine & movement
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
  Location,
  Position3D,
} from '../types'
import type { MoveAttempt, OccupancyWorld } from './movement/occupancyWorld'
import { buildReachStackerRoute, reachStackerParkingPosition } from './movement/reachStackerRouting'
import {
  RS_SPEED_UNLADEN,
  RS_SPEED_LADEN,
  RS_PICK_CYCLE_TIME,
  RS_PLACE_CYCLE_TIME,
  MHC_CYCLE_TIME,
  CONTAINER_HEIGHT,
} from './config'
import { isContainerOnTop } from './yardManager'

const STUCK_FAIL_OPEN_SECONDS = 20
const FORCE_THROUGH_SECONDS = 4
const BACKUP_SPEED_FACTOR = 1.1
const BACKUP_TURN_SECONDS = 2

interface BlockRecoveryState {
  blockedSeconds: number
  forceThroughSeconds: number
}

const equipmentRecovery = new Map<string, BlockRecoveryState>()

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

function advanceRsWaypoints(
  eq: Equipment,
  speed: number,
  dt: number,
  occupancy?: OccupancyWorld,
): boolean {
  if (eq.waypointIndex >= eq.waypoints.length) return true
  const wp = eq.waypoints[eq.waypointIndex]
  eq.targetPosition = wp
  const { position, arrived } = moveTowards(eq.position, wp, speed, dt)
  if (occupancy) {
    const recovery = equipmentRecovery.get(eq.id)
    const forceThrough = recovery && recovery.forceThroughSeconds > 0
    const attempt = occupancy.tryMoveEntity(
      eq.id,
      position,
      undefined,
      forceThrough ? { ignoreDynamic: true } : {},
    )
    if (!attempt.allowed) {
      recoverBlockedEquipmentMove(eq, wp, position, speed, dt, occupancy, attempt)
      return false
    }
    if (forceThrough) {
      recovery.forceThroughSeconds = Math.max(0, recovery.forceThroughSeconds - dt)
      if (recovery.forceThroughSeconds <= 0) equipmentRecovery.delete(eq.id)
    } else {
      equipmentRecovery.delete(eq.id)
    }
    eq.position = attempt.position
  } else {
    equipmentRecovery.delete(eq.id)
    eq.position = position
  }
  eq.position.y = 0
  if (arrived) {
    eq.waypointIndex++
    if (eq.waypointIndex >= eq.waypoints.length) return true
  }
  return false
}

function recoverBlockedEquipmentMove(
  eq: Equipment,
  target: Position3D,
  attemptedPosition: Position3D,
  speed: number,
  dt: number,
  occupancy: OccupancyWorld,
  attempt: MoveAttempt,
): void {
  if (attempt.blockedByStatic) return

  const recovery = equipmentRecovery.get(eq.id) ?? { blockedSeconds: 0, forceThroughSeconds: 0 }
  recovery.blockedSeconds += dt
  equipmentRecovery.set(eq.id, recovery)

  if (recovery.blockedSeconds >= STUCK_FAIL_OPEN_SECONDS) {
    recovery.forceThroughSeconds = FORCE_THROUGH_SECONDS
    const forced = occupancy.tryMoveEntity(eq.id, attemptedPosition, undefined, { ignoreDynamic: true })
    if (forced.allowed) {
      eq.position = forced.position
    }
    return
  }

  const dx = target.x - eq.position.x
  const dz = target.z - eq.position.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  if (distance < 0.1) return
  if (!shouldBackUpThisTurn(eq.id, attempt.blockedBy, recovery.blockedSeconds)) return

  const backupStep = Math.max(speed * dt * BACKUP_SPEED_FACTOR, 0.45)
  const backupPosition = {
    x: eq.position.x - (dx / distance) * backupStep,
    y: 0,
    z: eq.position.z - (dz / distance) * backupStep,
  }
  const backedUp = occupancy.tryMoveEntity(eq.id, backupPosition)
  if (backedUp.allowed) {
    eq.position = backedUp.position
    eq.position.y = 0
  }
}

function shouldBackUpThisTurn(entityId: string, blockedBy: string | undefined, blockedSeconds: number): boolean {
  if (!blockedBy) return true
  const phase = Math.floor(blockedSeconds / BACKUP_TURN_SECONDS) % 2
  const entityFirst = entityId.localeCompare(blockedBy) < 0
  return phase === 0 ? entityFirst : !entityFirst
}

// Determine heading for RS at a given position facing a pickup/drop target
function rsFacingHeading(from: Position3D, to: Position3D): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

function rsWorkingHeading(from: Position3D, location: Location): number {
  if (location.type === 'quay_buffer') return Math.PI
  return rsFacingHeading(from, location.position)
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
  occupancy?: OccupancyWorld,
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
  return tickReachStacker(eq, job, state, dt, result, occupancy)
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
  occupancy?: OccupancyWorld,
): EquipmentTickResult {
  eq.stateElapsed += dt

  switch (eq.state) {
    case 'assigned': {
      eq.state = 'travel_to_pickup'
      const parkPos = reachStackerParkingPosition(eq.position, job, 'pickup', occupancy, eq.id)
      eq.waypoints = buildReachStackerRoute(eq.position, parkPos, job, 'pickup')
      eq.waypointIndex = 0
      eq.targetPosition = eq.waypoints[0] ?? parkPos
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      eq.speed = getTravelSpeed(eq, false)
      break
    }

    case 'travel_to_pickup': {
      if (eq.waypoints.length === 0) {
        const parkPos = reachStackerParkingPosition(eq.position, job, 'pickup', occupancy, eq.id)
        eq.waypoints = buildReachStackerRoute(eq.position, parkPos, job, 'pickup')
        eq.waypointIndex = 0
      }
      const arrived = advanceRsWaypoints(eq, getTravelSpeed(eq, false), dt, occupancy)
      // Update heading to face the pickup target
      eq.headingY = rsWorkingHeading(eq.position, job.pickupLocation)
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
        eq.headingY = rsWorkingHeading(eq.position, job.pickupLocation)
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

        const dropPark = reachStackerParkingPosition(eq.position, job, 'dropoff', occupancy, eq.id)
        eq.waypoints = buildReachStackerRoute(eq.position, dropPark, job, 'dropoff')
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
        const dropPark = reachStackerParkingPosition(eq.position, job, 'dropoff', occupancy, eq.id)
        eq.waypoints = buildReachStackerRoute(eq.position, dropPark, job, 'dropoff')
        eq.waypointIndex = 0
      }
      // Update heading to face the dropoff target
      eq.headingY = rsWorkingHeading(eq.position, job.dropoffLocation)
      const travelArrived = advanceRsWaypoints(eq, getTravelSpeed(eq, true), dt, occupancy)
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
        eq.headingY = rsWorkingHeading(eq.position, job.dropoffLocation)
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
