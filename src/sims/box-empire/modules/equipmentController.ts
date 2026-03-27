// ---------------------------------------------------------------------------
// Box Empire — Equipment state machine & movement
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

function getPickDuration(eq: Equipment): number {
  if (eq.type === 'mobile_harbor_crane') return MHC_CYCLE_TIME / 2
  return RS_PICK_CYCLE_TIME
}

function getDropDuration(eq: Equipment): number {
  if (eq.type === 'mobile_harbor_crane') return MHC_CYCLE_TIME / 2
  return RS_PLACE_CYCLE_TIME
}

function getTravelSpeed(eq: Equipment, laden: boolean): number {
  if (eq.type === 'mobile_harbor_crane') return 2
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

  // Disabled equipment does nothing
  if (!eq.enabled) return result

  if (eq.state === 'idle' || !eq.currentJobId) return result

  const job = state.jobs.find(j => j.id === eq.currentJobId)
  if (!job) {
    eq.state = 'idle'
    eq.currentJobId = null
    return result
  }

  eq.stateElapsed += dt

  switch (eq.state) {
    case 'assigned': {
      eq.state = 'travel_to_pickup'
      eq.targetPosition = { x: job.pickupLocation.position.x, y: 0, z: job.pickupLocation.position.z }
      eq.stateStartTime = state.simTime
      eq.stateElapsed = 0
      eq.speed = getTravelSpeed(eq, false)
      break
    }

    case 'travel_to_pickup': {
      if (!eq.targetPosition) {
        eq.targetPosition = { x: job.pickupLocation.position.x, y: 0, z: job.pickupLocation.position.z }
      }
      const { position, arrived } = moveTowards(
        eq.position,
        eq.targetPosition,
        getTravelSpeed(eq, false),
        dt,
      )
      eq.position = position
      eq.position.y = 0
      if (arrived) {
        // Pre-pick accessibility check for yard containers
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
      // Interpolate armTargetY toward pickup height during picking phase
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
        eq.state = 'travel_to_drop'
        eq.targetPosition = { x: job.dropoffLocation.position.x, y: 0, z: job.dropoffLocation.position.z }
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
        eq.speed = getTravelSpeed(eq, true)
        job.status = 'in_progress'
      }
      break
    }

    case 'travel_to_drop': {
      if (!eq.targetPosition) {
        eq.targetPosition = { x: job.dropoffLocation.position.x, y: 0, z: job.dropoffLocation.position.z }
      }
      const { position, arrived } = moveTowards(
        eq.position,
        eq.targetPosition,
        getTravelSpeed(eq, true),
        dt,
      )
      eq.position = position
      eq.position.y = 0
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
      if (arrived) {
        eq.state = 'dropping'
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }

    case 'dropping': {
      // Interpolate armTargetY toward drop height
      const dropTargetY = job.dropoffLocation.position.y
      const dropProgress = Math.min(1, eq.stateElapsed / getDropDuration(eq))
      eq.armTargetY = dropTargetY * dropProgress

      if (eq.stateElapsed >= getDropDuration(eq)) {
        result.droppedContainerId = eq.carriedContainerId
        result.jobCompleted = true
        result.jobId = job.id
        eq.carriedContainerId = null
        eq.state = 'idle'
        eq.currentJobId = null
        eq.targetPosition = null
        eq.armTargetY = 0
        eq.stateStartTime = state.simTime
        eq.stateElapsed = 0
      }
      break
    }
  }

  return result
}
