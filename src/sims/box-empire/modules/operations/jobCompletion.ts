import type { BoxEmpireState, Container, Job, Position3D, YardSlotRef } from '../../types'
import { makeYardSlotId, parseYardSlotId } from '../../types'
import { allocateYardSlot } from '../allocators/yardAllocator'
import {
  createImportQuayToYardJob,
  createImportYardToTruckJob,
} from '../allocators/destinationAllocator'
import { applyVesselLoadRevenue, type DomainEventPayload } from '../economy/economyLedger'
import {
  QUAY_BUFFER_DISCHARGE_POSITION,
  QUAY_BUFFER_LOAD_POSITION,
} from '../config'
import { getActiveJobForContainer } from '../jobScheduler'
import { startTruckReturnToGate } from '../truckManager'
import { loadContainerOnVessel, dischargeContainerFromVessel } from '../vesselManager'
import { getSlotWorldPosition, placeContainerInSlot, removeContainerFromSlot } from '../yardManager'

function settleYardSlot(state: BoxEmpireState, job: Job): YardSlotRef | null {
  const yard = state.yardBlocks[0]
  if (!yard) return null
  const slotRef = parseYardSlotId(job.dropoffLocation.id)
  if (!slotRef) return null

  const occupiedTiers = yard.slots.filter(
    slot => slot.bay === slotRef.bay && slot.row === slotRef.row && slot.containerId !== null,
  ).length
  return { ...slotRef, tier: occupiedTiers + 1 }
}

function createWaitingImportPickupJobIfNeeded(
  state: BoxEmpireState,
  container: Container,
): void {
  if (container.visitType !== 'import' || !container.yardSlot) return
  const waitingTruck = state.truckVisits.find(
    truck =>
      truck.visitType === 'import_pickup' &&
      truck.containerId === container.id &&
      truck.state === 'waiting_for_equipment',
  )
  if (!waitingTruck) return
  if (getActiveJobForContainer(state, container.id)) return

  const pickupJob = createImportYardToTruckJob(container, waitingTruck, state.simTime)
  if (pickupJob) state.jobs.push(pickupJob)
}

export function handleJobCompletion(
  state: BoxEmpireState,
  job: Job,
  container: Container,
  servicedByPosition?: Position3D,
): DomainEventPayload[] {
  const events: DomainEventPayload[] = []
  const yard = state.yardBlocks[0]

  if (job.dropoffLocation.type === 'yard_slot') {
    if (!yard) return events
    const actualSlotRef = settleYardSlot(state, job)
    if (!actualSlotRef) return events

    const actualPos = getSlotWorldPosition(yard, actualSlotRef)
    const actualSlotId = makeYardSlotId(
      actualSlotRef.blockId,
      actualSlotRef.bay,
      actualSlotRef.row,
      actualSlotRef.tier,
    )

    placeContainerInSlot(yard, actualSlotRef, container.id)
    container.yardSlot = actualSlotRef
    container.lifecycleState = 'in_yard'
    container.currentLocation = {
      type: 'yard_slot',
      id: actualSlotId,
      position: actualPos,
    }
    events.push({
      type: 'container.placed',
      message: `Container ${container.id} stored in yard`,
    })
    createWaitingImportPickupJobIfNeeded(state, container)
    return events
  }

  if (job.dropoffLocation.type === 'truck') {
    container.yardSlot = null

    if (container.visitType === 'import' && yard) {
      removeContainerFromSlot(yard, container.id)
    }

    const truck = state.truckVisits.find(
      candidate => candidate.id === job.dropoffLocation.id && candidate.state === 'waiting_for_equipment',
    )
    if (truck) {
      truck.containerId = container.id
      container.lifecycleState = 'returning_to_gate'
      container.currentLocation = {
        type: 'truck',
        id: truck.id,
        position: { ...truck.position },
      }
      startTruckReturnToGate(truck, state.simTime, servicedByPosition)
    }
    return events
  }

  if (job.dropoffLocation.type === 'quay_buffer') {
    // Use the actual drop position baked into the job (MHC may have updated it to its current X).
    // Fall back to constants only if the job position was never set.
    const fallback = container.visitType === 'import'
      ? QUAY_BUFFER_DISCHARGE_POSITION
      : QUAY_BUFFER_LOAD_POSITION
    const bufferPos = { ...job.dropoffLocation.position, y: fallback.y }

    container.currentLocation = {
      type: 'quay_buffer',
      id: container.visitType === 'import' ? 'quay-buffer-discharge' : 'quay-buffer-load',
      position: bufferPos,
    }

    if (container.visitType === 'import') {
      container.lifecycleState = 'discharged_to_buffer'
      // vesselSlot may already be null (cleared in simulationEngine on pickup); call is idempotent
      const vessel = state.vesselVisits.find(v => v.id === container.vesselSlot?.vesselId)
        ?? state.vesselVisits.find(v => v.slots.some(s => s.containerId === container.id))
        ?? state.vesselVisits[0]
      if (vessel) dischargeContainerFromVessel(vessel, container.id)
      container.vesselSlot = null

      const slot = allocateYardSlot(yard, state.jobs, 'import', state.containers)
      if (yard && slot) {
        state.jobs.push(createImportQuayToYardJob(container.id, yard, slot, bufferPos, state.simTime))
      }
      return events
    }

    if (container.visitType === 'export') {
      container.lifecycleState = 'staged_for_loading'
      container.yardSlot = null
      if (yard) removeContainerFromSlot(yard, container.id)
      // The export-quay-to-vessel job will be created by continueExportStagingAndLoading
      return events
    }
  }

  if (job.dropoffLocation.type === 'vessel_slot') {
    const vessel = state.vesselVisits.find(v => job.dropoffLocation.id.startsWith(v.id))
      ?? state.vesselVisits[0]
    if (!vessel) return events

    const parsed = parseYardSlotId(job.dropoffLocation.id)
    const bay = parsed ? parsed.bay : 1
    const row = parsed ? parsed.row : 1
    const tier = parsed ? parsed.tier : 1
    loadContainerOnVessel(vessel, container.id, bay, row, tier)
    container.lifecycleState = 'loaded_on_vessel'
    container.vesselSlot = { vesselId: vessel.id, bay, row, tier }
    container.currentLocation = {
      type: 'vessel_slot',
      id: vessel.id,
      position: { ...job.dropoffLocation.position },
    }

    events.push(applyVesselLoadRevenue(state, container, job.dropoffLocation.position))
    events.push({
      type: 'container.placed',
      message: `Container ${container.id} loaded on ${vessel.name}`,
      data: { vesselId: vessel.id },
    })
  }

  return events
}
