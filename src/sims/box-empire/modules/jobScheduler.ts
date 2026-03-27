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

export function assignPendingJobs(state: BoxEmpireState): void {
  const pendingJobs = state.jobs
    .filter(j => j.status === 'pending')
    .sort((a, b) => b.priority - a.priority)

  for (const job of pendingJobs) {
    const idleEquipment = state.equipment.filter(
      e => e.state === 'idle' && e.type === job.equipmentType && !e.currentJobId,
    )

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

export function cancelJob(state: BoxEmpireState, jobId: string): void {
  const job = state.jobs.find(j => j.id === jobId)
  if (!job) return
  if (job.status === 'completed' || job.status === 'cancelled') return

  const prevStatus = job.status
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

  void prevStatus
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
