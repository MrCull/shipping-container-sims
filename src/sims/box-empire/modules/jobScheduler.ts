// ---------------------------------------------------------------------------
// Box Empire — Job scheduler (creation, assignment, cancellation)
// ---------------------------------------------------------------------------

import type {
  Job,
  JobStatus,
  Location,
  Equipment,
  EquipmentType,
  Position3D,
  BoxEmpireState,
  ReachStackerServiceSide,
} from '../types'
import { parseYardSlotId } from '../types'
import type { SimulationIndexes } from './simulation/simulationIndexes'
import { isContainerOnTop, makeYardStackKey } from './yardManager'

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
  if (hasActiveInboundMoveToPickupStack(job, state)) return false
  return isContainerOnTop(yard, job.containerId)
}

function isActiveMove(job: Job): boolean {
  return job.status === 'assigned' || job.status === 'in_progress'
}

function hasActiveInboundMoveToPickupStack(job: Job, state: BoxEmpireState): boolean {
  if (job.pickupLocation.type !== 'yard_slot') return false
  const pickupSlot = parseYardSlotId(job.pickupLocation.id)
  if (!pickupSlot) return false
  const pickupStack = makeYardStackKey(pickupSlot.blockId, pickupSlot.bay, pickupSlot.row)

  return state.jobs.some(candidate => {
    if (candidate.id === job.id) return false
    if (!isActiveMove(candidate)) return false
    if (candidate.dropoffLocation.type !== 'yard_slot') return false
    const dropoffSlot = parseYardSlotId(candidate.dropoffLocation.id)
    if (!dropoffSlot) return false
    return makeYardStackKey(dropoffSlot.blockId, dropoffSlot.bay, dropoffSlot.row) === pickupStack
  })
}

export function getMhcJobVesselSlot(job: Job, state: BoxEmpireState): { vesselId: string; bay: number } | null {
  const location = job.pickupLocation.type === 'vessel_slot'
    ? job.pickupLocation
    : job.dropoffLocation.type === 'vessel_slot'
      ? job.dropoffLocation
      : null
  if (!location) return null

  const vessel = state.vesselVisits.find(candidate => location.id.startsWith(`${candidate.id}-`))
  if (!vessel) return null
  const parsed = parseYardSlotId(location.id)
  return { vesselId: vessel.id, bay: parsed?.bay ?? 1 }
}

export function canMhcServeJob(eq: Equipment, job: Job, state: BoxEmpireState): boolean {
  const slot = getMhcJobVesselSlot(job, state)
  if (!slot) return true
  if (!eq.craneAllowedVesselIds.includes(slot.vesselId)) return false
  const allowedBays = eq.craneAllowedBaysByVessel[slot.vesselId]
  return !allowedBays || allowedBays.includes(slot.bay)
}

export function getReachStackerServiceSide(job: Job): ReachStackerServiceSide {
  if (job.pickupLocation.type === 'truck' || job.dropoffLocation.type === 'truck') {
    return 'landside'
  }
  if (job.pickupLocation.type === 'quay_buffer' || job.dropoffLocation.type === 'quay_buffer') {
    return 'waterside'
  }
  return 'internal'
}

export function assignPendingJobs(state: BoxEmpireState): void {
  const pendingJobs = state.jobs
    .filter(j => j.status === 'pending')
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
      return a.id.localeCompare(b.id)
    })

  for (const job of pendingJobs) {
    // If the container is buried / not accessible, mark it blocked so recheckBlockedJobs
    // can revive it the moment it becomes accessible. Without this the job stays pending
    // forever but is silently skipped every tick, causing permanent deadlocks.
    if (!isJobAccessible(job, state)) {
      if (job.pickupLocation.type === 'yard_slot') {
        job.status = 'blocked'
        job.blockedReason = 'Container buried — waiting for shuffle to clear path'
      }
      continue
    }

    const idleEquipment = state.equipment.filter(e => {
      if (e.state !== 'idle') return false
      if (e.type !== job.equipmentType) return false
      if (e.currentJobId) return false
      if (!e.enabled) return false

      if (e.type === 'reach_stacker') {
        const serviceSide = getReachStackerServiceSide(job)
        if (serviceSide === 'landside' && !e.canServeLandside) return false
        if (serviceSide === 'waterside' && !e.canServeWaterside) return false
      }

      // Crane mode check
      if (e.type === 'mobile_harbor_crane') {
        const mode = e.craneMode
        if (mode === 'discharge' && job.pickupLocation.type !== 'vessel_slot') return false
        if (mode === 'load' && job.dropoffLocation.type !== 'vessel_slot') return false
        if (!canMhcServeJob(e, job, state)) return false
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
      job.blockedReason = undefined
      continue
    }
    // Fallback: if the yard-slot record was cleared (container picked up / slot reset)
    // but the container lifecycle still says in_yard, treat as accessible so the job
    // doesn't stay blocked forever.
    if (job.pickupLocation.type === 'yard_slot') {
      const container = state.containers.find(c => c.id === job.containerId)
      if (container?.lifecycleState === 'in_yard' && !hasActiveInboundMoveToPickupStack(job, state)) {
        job.status = 'pending'
      }
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
  indexes?: SimulationIndexes,
): Job | null {
  if (indexes) return indexes.activeJobByContainerId.get(containerId) ?? null
  return (
    state.jobs.find(
      j =>
        j.containerId === containerId &&
        (j.status === 'pending' || j.status === 'assigned' || j.status === 'in_progress' || j.status === 'blocked'),
    ) ?? null
  )
}

export function completeJob(state: BoxEmpireState, jobId: string): void {
  const job = state.jobs.find(j => j.id === jobId)
  if (!job) return
  job.status = 'completed'
  job.completedAt = state.simTime
}
