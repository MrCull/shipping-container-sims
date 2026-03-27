// ---------------------------------------------------------------------------
// Box Empire — Job scheduler (creation, assignment, cancellation)
// ---------------------------------------------------------------------------

import type {
  Job,
  JobStatus,
  Location,
  EquipmentType,
  Position3D,
  BoxEmpireState,
} from '../types'
import { isContainerOnTop } from './yardManager'

let jobCounter = 0

export function resetJobCounter(): void {
  jobCounter = 0
}

function nextJobId(): string {
  jobCounter++
  return `job-${jobCounter}`
}

export function createJob(
  containerId: string,
  pickupLocation: Location,
  dropoffLocation: Location,
  equipmentType: EquipmentType,
  priority: number,
  simTime: number,
): Job {
  return {
    id: nextJobId(),
    status: 'pending',
    containerId,
    pickupLocation,
    dropoffLocation,
    assignedEquipmentId: null,
    priority,
    createdAt: simTime,
    startedAt: null,
    completedAt: null,
    equipmentType,
  }
}

function distanceBetween(a: Position3D, b: Position3D): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function isJobAccessible(job: Job, state: BoxEmpireState): boolean {
  if (job.pickupLocation.type !== 'yard_slot') return true
  const yard = state.yardBlocks[0]
  if (!yard) return true
  return isContainerOnTop(yard, job.containerId)
}

export function assignPendingJobs(state: BoxEmpireState): void {
  const pendingJobs = state.jobs
    .filter(j => j.status === 'pending')
    .sort((a, b) => b.priority - a.priority)

  for (const job of pendingJobs) {
    // Skip jobs where the container is buried
    if (!isJobAccessible(job, state)) continue

    const idleEquipment = state.equipment.filter(e => {
      if (e.state !== 'idle') return false
      if (e.type !== job.equipmentType) return false
      if (e.currentJobId) return false
      if (!e.enabled) return false

      // Crane mode check
      if (e.type === 'mobile_harbor_crane') {
        const mode = e.craneMode
        if (mode === 'discharge' && job.pickupLocation.type !== 'vessel_slot') return false
        if (mode === 'load' && job.dropoffLocation.type !== 'vessel_slot') return false
      }

      return true
    })

    if (idleEquipment.length === 0) continue

    idleEquipment.sort(
      (a, b) =>
        distanceBetween(a.position, job.pickupLocation.position) -
        distanceBetween(b.position, job.pickupLocation.position),
    )

    const best = idleEquipment[0]
    job.status = 'assigned'
    job.assignedEquipmentId = best.id
    job.startedAt = state.simTime
    best.currentJobId = job.id
    best.state = 'assigned'
    best.targetPosition = { ...job.pickupLocation.position }
    best.stateStartTime = state.simTime
    best.stateElapsed = 0
  }
}

export function recheckBlockedJobs(state: BoxEmpireState): void {
  for (const job of state.jobs) {
    if (job.status !== 'blocked') continue
    if (isJobAccessible(job, state)) {
      job.status = 'pending'
    }
  }
}

export function cancelJob(state: BoxEmpireState, jobId: string): void {
  const job = state.jobs.find(j => j.id === jobId)
  if (!job) return
  if (job.status === 'completed' || job.status === 'cancelled') return

  job.status = 'cancelled' as JobStatus

  if (job.assignedEquipmentId) {
    const eq = state.equipment.find(e => e.id === job.assignedEquipmentId)
    if (eq) {
      if (eq.carriedContainerId) {
        const container = state.containers.find(c => c.id === eq.carriedContainerId)
        if (container) {
          container.currentLocation = {
            type: 'equipment',
            id: eq.id,
            position: { ...eq.position },
          }
        }
      }
      eq.currentJobId = null
      eq.state = 'idle'
      eq.targetPosition = null
      eq.carriedContainerId = null
    }
  }
}

export function getActiveJobForContainer(
  state: BoxEmpireState,
  containerId: string,
): Job | null {
  return (
    state.jobs.find(
      j =>
        j.containerId === containerId &&
        (j.status === 'pending' || j.status === 'assigned' || j.status === 'in_progress'),
    ) ?? null
  )
}

export function completeJob(state: BoxEmpireState, jobId: string): void {
  const job = state.jobs.find(j => j.id === jobId)
  if (!job) return
  job.status = 'completed'
  job.completedAt = state.simTime
}
