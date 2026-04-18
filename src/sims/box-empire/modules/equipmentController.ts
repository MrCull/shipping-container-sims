// ---------------------------------------------------------------------------
// Box Empire - Equipment state machine & movement
// ---------------------------------------------------------------------------
// Key design decisions:
//  - Reach Stacker: travels to a *parking position* offset in front of the
//    target slot, then picks/drops by extending its boom. The body never
//    enters the stack footprint.
//  - Mobile Harbor Crane: travels along the quay only while empty to align
//    with vessel bays. It reaches nearby quay exchanges with the boom/trolley.
// ---------------------------------------------------------------------------

import type {
  Equipment,
  BoxEmpireState,
  Location,
  Position3D,
} from '../types'
import type { MoveAttempt, OccupancyWorld } from './movement/occupancyWorld'
import { buildReachStackerRoute, reachStackerParkingPosition } from './movement/reachStackerRouting'
import { getYardServiceLanes } from './movement/terminalGeometry'
import {
  RS_SPEED_UNLADEN,
  RS_SPEED_LADEN,
  RS_PICK_CYCLE_TIME,
  RS_PLACE_CYCLE_TIME,
  MHC_CYCLE_TIME,
  MHC_TRAVEL_SPEED,
  MHC_MIN_SEPARATION_X,
  CONTAINER_HEIGHT,
} from './config'
import { isContainerOnTop } from './yardManager'

const STUCK_FAIL_OPEN_SECONDS = 20
const DEADLOCK_YIELD_SECONDS = 30
const FORCE_THROUGH_SECONDS = 4
const BACKUP_SPEED_FACTOR = 1.1
const BACKUP_TURN_SECONDS = 2

interface BlockRecoveryState {
  blockedSeconds: number
  forceThroughSeconds: number
  blockedById?: string
}

interface ClearingState {
  waypoints: Position3D[]
  waypointIndex: number
}

const equipmentRecovery = new Map<string, BlockRecoveryState>()
const equipmentClearing = new Map<string, ClearingState>()

interface MhcBlockedState {
  blockedSeconds: number
  blockedById: string | undefined
}

interface MhcClearingState {
  targetX: number
}

const mhcBlocked = new Map<string, MhcBlockedState>()
const mhcClearing = new Map<string, MhcClearingState>()

export function resetEquipmentDeadlockState(): void {
  equipmentRecovery.clear()
  equipmentClearing.clear()
  mhcBlocked.clear()
  mhcClearing.clear()
}

function moveTowards(
  current: Position3D,
  target: Position3D,
  speed: number,
  dt: number,
): { position: Position3D; arrived: boolean } {
  const dx = target.x - current.x
  const dz = target.z - current.z
  const axisDx = Math.abs(dx) > 0.1
  const axisDz = Math.abs(dz) > 0.1
  const d = axisDx ? Math.abs(dx) : Math.abs(dz)
  const step = speed * dt
  if (!axisDx && !axisDz) {
    return { position: { x: target.x, y: 0, z: target.z }, arrived: true }
  }
  if (d <= step || d < 0.1) {
    const position = axisDx
      ? { x: target.x, y: 0, z: current.z }
      : { x: current.x, y: 0, z: target.z }
    const arrived = Math.abs(position.x - target.x) < 0.1 && Math.abs(position.z - target.z) < 0.1
    return { position: arrived ? { x: target.x, y: 0, z: target.z } : position, arrived }
  }
  return {
    position: axisDx
      ? { x: current.x + Math.sign(dx) * step, y: 0, z: current.z }
      : { x: current.x, y: 0, z: current.z + Math.sign(dz) * step },
    arrived: false,
  }
}

function axisTravelHeading(from: Position3D, to: Position3D): number | null {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.abs(dx) > 0.1) return dx > 0 ? Math.PI / 2 : -Math.PI / 2
  if (Math.abs(dz) > 0.1) return dz > 0 ? 0 : Math.PI
  return null
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
  const heading = axisTravelHeading(eq.position, wp)
  if (heading !== null) eq.headingY = heading
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
  recovery.blockedById = attempt.blockedBy
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
  const movingX = Math.abs(dx) > 0.1
  const distance = movingX ? Math.abs(dx) : Math.abs(dz)
  if (distance < 0.1) return
  if (!shouldBackUpThisTurn(eq.id, attempt.blockedBy, recovery.blockedSeconds)) return

  const backupStep = Math.max(speed * dt * BACKUP_SPEED_FACTOR, 0.45)
  const backupPosition = {
    x: movingX ? eq.position.x - Math.sign(dx) * backupStep : eq.position.x,
    y: 0,
    z: movingX ? eq.position.z : eq.position.z - Math.sign(dz) * backupStep,
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

function shouldYield(myId: string, theirId: string): boolean {
  return myId.localeCompare(theirId) < 0
}

function buildClearingWaypoints(eq: Equipment): Position3D[] {
  const lanes = getYardServiceLanes()
  const neutralX = eq.position.x >= 0 ? -25 : 25
  const points: Position3D[] = []
  if (Math.abs(eq.position.z - lanes.landsideZ) > 0.5) {
    points.push({ x: eq.position.x, y: 0, z: lanes.landsideZ })
  }
  points.push({ x: neutralX, y: 0, z: lanes.landsideZ })
  return points
}

function initiateDeadlockYield(eq: Equipment, state: BoxEmpireState): void {
  if (eq.currentJobId) {
    const job = state.jobs.find(j => j.id === eq.currentJobId)
    if (job && job.status !== 'completed' && job.status !== 'cancelled') {
      job.status = 'pending'
      job.assignedEquipmentId = null
    }
  }
  eq.currentJobId = null
  eq.state = 'idle'
  equipmentClearing.set(eq.id, { waypoints: buildClearingWaypoints(eq), waypointIndex: 0 })
  equipmentRecovery.delete(eq.id)
}

function tickReachStackerClearing(
  eq: Equipment,
  clearing: ClearingState,
  dt: number,
  occupancy?: OccupancyWorld,
): void {
  if (clearing.waypointIndex >= clearing.waypoints.length) {
    equipmentClearing.delete(eq.id)
    return
  }
  const wp = clearing.waypoints[clearing.waypointIndex]
  const heading = axisTravelHeading(eq.position, wp)
  if (heading !== null) eq.headingY = heading
  const { position, arrived } = moveTowards(eq.position, wp, RS_SPEED_UNLADEN, dt)
  if (occupancy) {
    const attempt = occupancy.tryMoveEntity(eq.id, position, undefined, {})
    if (attempt.allowed) eq.position = attempt.position
  } else {
    eq.position = position
  }
  eq.position.y = 0
  if (arrived) {
    clearing.waypointIndex++
    if (clearing.waypointIndex >= clearing.waypoints.length) {
      equipmentClearing.delete(eq.id)
    }
  }
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
  if (eq.type === 'mobile_harbor_crane') return MHC_TRAVEL_SPEED
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

  if (eq.type === 'reach_stacker') {
    const clearing = equipmentClearing.get(eq.id)
    if (clearing) {
      tickReachStackerClearing(eq, clearing, dt, occupancy)
      return result
    }
  }

  if (eq.type === 'mobile_harbor_crane') {
    const clearing = mhcClearing.get(eq.id)
    if (clearing) {
      tickMhcClearing(eq, clearing, state, dt)
      return result
    }
  }

  if (eq.state === 'idle' || !eq.currentJobId) return result

  const job = state.jobs.find(j => j.id === eq.currentJobId)
  if (!job) {
    eq.state = 'idle'
    eq.currentJobId = null
    return result
  }

  // MHC: base translates only while empty to align with the vessel bay.
  if (eq.type === 'mobile_harbor_crane') {
    return tickMhc(eq, job, state, dt, result)
  }

  // Reach stacker
  return tickReachStacker(eq, job, state, dt, result, occupancy)
}

const MHC_DEADLOCK_SECONDS = MHC_CYCLE_TIME * 1.5
const MHC_CLEAR_DISTANCE = 15

function isMhcBlockedByOther(eq: Equipment, targetX: number, state: BoxEmpireState): string | undefined {
  const direction = Math.sign(targetX - eq.position.x)
  if (direction === 0) return undefined
  for (const other of state.equipment) {
    if (other.id === eq.id || other.type !== 'mobile_harbor_crane' || !other.enabled) continue
    const distAhead = (other.position.x - eq.position.x) * direction
    const distToTarget = Math.abs(targetX - eq.position.x)
    if (distAhead > 0 && distAhead <= distToTarget + MHC_MIN_SEPARATION_X) return other.id
    if (Math.abs(targetX - other.position.x) < MHC_MIN_SEPARATION_X) return other.id
  }
  return undefined
}

function initiateMhcClearance(eq: Equipment, state: BoxEmpireState, blockerId: string | undefined): void {
  if (eq.currentJobId) {
    const job = state.jobs.find(j => j.id === eq.currentJobId)
    if (job && job.status !== 'completed' && job.status !== 'cancelled') {
      job.status = 'pending'
      job.assignedEquipmentId = null
    }
  }
  eq.currentJobId = null
  eq.state = 'idle'
  eq.carriedContainerId = null
  eq.spreaderZ = 0
  eq.armTargetY = 0

  const blocker = state.equipment.find(e => e.id === blockerId)
  const clearX = blocker && blocker.position.x < eq.position.x
    ? eq.position.x + MHC_CLEAR_DISTANCE
    : eq.position.x - MHC_CLEAR_DISTANCE

  mhcClearing.set(eq.id, { targetX: clearX })
  mhcBlocked.delete(eq.id)
}

function tickMhcClearing(eq: Equipment, clearing: MhcClearingState, state: BoxEmpireState, dt: number): void {
  const dx = clearing.targetX - eq.position.x
  const step = MHC_TRAVEL_SPEED * dt
  if (Math.abs(dx) <= step) {
    if (isMhcBlockedByOther(eq, clearing.targetX, state)) return
    eq.position.x = clearing.targetX
    mhcClearing.delete(eq.id)
    mhcBlocked.delete(eq.id)
    return
  }
  if (!isMhcBlockedByOther(eq, clearing.targetX, state)) {
    eq.position.x += Math.sign(dx) * step
  }
}

function mhcTravelAlongQuay(eq: Equipment, targetX: number, dt: number, state: BoxEmpireState): boolean {
  const dx = targetX - eq.position.x
  const step = MHC_TRAVEL_SPEED * dt

  if (Math.abs(dx) <= step) {
    const blockerId = isMhcBlockedByOther(eq, targetX, state)
    if (blockerId) {
      const blocked = mhcBlocked.get(eq.id) ?? { blockedSeconds: 0, blockedById: blockerId }
      blocked.blockedSeconds += dt
      blocked.blockedById = blockerId
      mhcBlocked.set(eq.id, blocked)
      return false
    }
    mhcBlocked.delete(eq.id)
    eq.position.x = targetX
    return true
  }

  const direction = Math.sign(dx)
  let desiredX = eq.position.x + direction * step
  let blockerId: string | undefined
  for (const other of state.equipment) {
    if (other.id === eq.id || other.type !== 'mobile_harbor_crane' || !other.enabled) continue
    if (Math.abs(desiredX - other.position.x) >= MHC_MIN_SEPARATION_X) continue
    blockerId = other.id
    const safeX = other.position.x - direction * MHC_MIN_SEPARATION_X
    if (Math.abs(safeX - eq.position.x) < Math.abs(desiredX - eq.position.x)) {
      desiredX = safeX
    }
  }

  if (blockerId) {
    if (Math.sign(desiredX - eq.position.x) === direction && Math.abs(desiredX - eq.position.x) > 0.01) {
      eq.position.x = desiredX
    }
    const blocked = mhcBlocked.get(eq.id) ?? { blockedSeconds: 0, blockedById: blockerId }
    blocked.blockedSeconds += dt
    blocked.blockedById = blockerId
    mhcBlocked.set(eq.id, blocked)
    return false
  }

  mhcBlocked.delete(eq.id)
  eq.position.x = desiredX
  return false
}

function mhcBaseTargetXForJob(job: import('../types').Job): number {
  if (job.pickupLocation.type === 'vessel_slot') return job.pickupLocation.position.x
  if (job.dropoffLocation.type === 'vessel_slot') return job.dropoffLocation.position.x
  return job.pickupLocation.position.x
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
      const baseTargetX = mhcBaseTargetXForJob(job)
      eq.armTargetY = MHC_TRAVEL_HOIST_Y
      eq.targetPosition = { ...job.pickupLocation.position }
      job.status = 'in_progress'
      if (Math.abs(eq.position.x - baseTargetX) > 0.5) {
        eq.state = 'travel_to_pickup'
      } else {
        eq.position.x = baseTargetX
        eq.spreaderZ = getMhcReachCommand(eq.position, job.pickupLocation.position)
        eq.state = 'picking'
      }
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      break
    }

    case 'travel_to_pickup': {
      // Crane travels empty along quay (X axis) to align with the vessel bay.
      const baseTargetX = mhcBaseTargetXForJob(job)
      eq.targetPosition = { ...job.pickupLocation.position }
      eq.armTargetY = MHC_TRAVEL_HOIST_Y
      eq.spreaderZ = getMhcReachCommand(eq.position, job.pickupLocation.position)
      const arrivedAtPickup = mhcTravelAlongQuay(eq, baseTargetX, dt, state)
      if (!arrivedAtPickup) {
        const blocked = mhcBlocked.get(eq.id)
        if (blocked && blocked.blockedSeconds >= MHC_DEADLOCK_SECONDS) {
          initiateMhcClearance(eq, state, blocked.blockedById)
        }
        break
      }
      eq.spreaderZ = getMhcReachCommand(eq.position, job.pickupLocation.position)
      eq.state = 'picking'
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
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
        eq.armTargetY = MHC_TRAVEL_HOIST_Y
        eq.armDropStartY = MHC_TRAVEL_HOIST_Y

        eq.targetPosition = { ...job.dropoffLocation.position }
        eq.spreaderZ = getMhcReachCommand(eq.position, job.dropoffLocation.position)
        eq.state = 'dropping'
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }

    case 'travel_to_drop': {
      eq.targetPosition = { ...job.dropoffLocation.position }
      eq.armTargetY = MHC_TRAVEL_HOIST_Y
      eq.spreaderZ = getMhcReachCommand(eq.position, job.dropoffLocation.position)
      if (eq.carriedContainerId) {
        const container = state.containers.find(c => c.id === eq.carriedContainerId)
        if (container) {
          container.currentLocation.position = { x: eq.position.x, y: eq.armTargetY, z: eq.position.z }
        }
        eq.state = 'dropping'
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
        break
      }

      const dropBaseTargetX = mhcBaseTargetXForJob(job)
      const arrivedAtDrop = mhcTravelAlongQuay(eq, dropBaseTargetX, dt, state)
      if (!arrivedAtDrop) {
        const blocked = mhcBlocked.get(eq.id)
        if (blocked && blocked.blockedSeconds >= MHC_DEADLOCK_SECONDS) {
          initiateMhcClearance(eq, state, blocked.blockedById)
        }
        break
      }
      eq.spreaderZ = getMhcReachCommand(eq.position, job.dropoffLocation.position)
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
      eq.armTargetY = eq.armDropStartY + (dropTargetY - eq.armDropStartY) * dropProgress

      if (eq.carriedContainerId) {
        const container = state.containers.find(c => c.id === eq.carriedContainerId)
        if (container) {
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
      // RS-vs-RS deadlock: yield if blocked by another RS for too long
      if (!arrived) {
        const recovery = equipmentRecovery.get(eq.id)
        if (
          recovery &&
          recovery.blockedSeconds >= DEADLOCK_YIELD_SECONDS &&
          recovery.blockedById?.startsWith('rs-') &&
          shouldYield(eq.id, recovery.blockedById)
        ) {
          initiateDeadlockYield(eq, state)
          break
        }
      }
      if (arrived) {
        // Pre-pick accessibility check for yard slots
        if (job.pickupLocation.type === 'yard_slot') {
          const yard = state.yardBlocks[0]
          if (yard) {
            const accessible = isContainerOnTop(yard, job.containerId)
            if (!accessible) {
              job.status = 'blocked'
              job.blockedReason = 'Container buried — waiting for shuffle to clear path'
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
