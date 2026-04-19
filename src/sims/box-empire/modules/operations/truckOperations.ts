import type { BoxEmpireState, Container, TruckVisit } from '../../types'
import { createExportTruckToYardJob, createImportYardToTruckJob } from '../allocators/destinationAllocator'
import { allocateYardSlot } from '../allocators/yardAllocator'
import { createTruck, getTruckYardStandPositionForVisitType } from '../truckManager'
import { isContainerOnTop } from '../yardManager'
import type { DomainEventPayload } from '../economy/economyLedger'
import type { TutorialFlowRuntime } from '../simulation/simulationTypes'

export function spawnExportTruck(state: BoxEmpireState, flow: TutorialFlowRuntime): DomainEventPayload | null {
  const assignedContainerIds = new Set(
    state.truckVisits.filter(truck => truck.containerId).map(truck => truck.containerId),
  )
  const container = state.containers.find(
    candidate =>
      candidate.visitType === 'export' &&
      candidate.lifecycleState === 'at_gate' &&
      candidate.currentLocation.type === 'gate_buffer' &&
      !assignedContainerIds.has(candidate.id),
  )
  if (!container) return null

  const truck = createTruck(container.id, 'export_delivery')
  truck.stateStartTime = state.simTime
  container.currentLocation = {
    type: 'truck',
    id: truck.id,
    position: { ...truck.position },
  }
  state.truckVisits.push(truck)
  flow.exportTrucksSent++

  return {
    type: 'truck.arrived',
    message: `Export truck ${truck.id} approaching gate`,
    data: { truckId: truck.id },
  }
}

export function spawnImportPickupTruck(state: BoxEmpireState, flow: TutorialFlowRuntime): DomainEventPayload | null {
  const pickupTruckContainerIds = new Set(
    state.truckVisits
      .filter(truck => truck.visitType === 'import_pickup' && truck.containerId)
      .map(truck => truck.containerId),
  )
  const yard = state.yardBlocks[0]
  const eligible = state.containers.filter(
    container =>
      container.visitType === 'import' &&
      container.lifecycleState === 'in_yard' &&
      !pickupTruckContainerIds.has(container.id),
  )
  const container = eligible.find(candidate => yard && isContainerOnTop(yard, candidate.id)) ?? eligible[0]
  if (!container) return null

  const truck = createTruck(null, 'import_pickup')
  truck.stateStartTime = state.simTime
  truck.containerId = container.id
  state.truckVisits.push(truck)
  flow.importTrucksSent++

  return {
    type: 'truck.arrived',
    message: `Import pickup truck ${truck.id} approaching`,
    data: { truckId: truck.id },
  }
}

export function syncContainerToTruck(container: Container, truck: TruckVisit): void {
  if (container.currentLocation.type !== 'truck' && container.lifecycleState !== 'returning_to_gate') return
  container.currentLocation.position = { ...truck.position }
}

export function createJobsForTruckReadyAtYard(state: BoxEmpireState, truck: TruckVisit): DomainEventPayload | null {
  if (truck.visitType === 'export_delivery' && truck.containerId) {
    const container = state.containers.find(candidate => candidate.id === truck.containerId)
    const truckStandPosition = getTruckYardStandPositionForVisitType(truck.visitType)
    if (container) {
      container.currentLocation = {
        type: 'truck',
        id: truck.id,
        position: truckStandPosition,
      }
    }

    const yard = state.yardBlocks[0]
    const slot = allocateYardSlot(yard, state.jobs, 'export', state.containers)
    if (!yard || !slot) return null

    const job = createExportTruckToYardJob(truck, yard, slot, state.simTime)
    if (!job) return null
    state.jobs.push(job)
    return {
      type: 'job.created',
      message: 'Job to store export container in yard',
    }
  }

  if (truck.visitType === 'import_pickup' && truck.containerId) {
    const container = state.containers.find(candidate => candidate.id === truck.containerId)
    if (!container || container.lifecycleState !== 'in_yard' || !container.yardSlot) return null

    const job = createImportYardToTruckJob(container, truck, state.simTime, 10.5)
    if (!job) return null
    state.jobs.push(job)
    return {
      type: 'job.created',
      message: 'Job to deliver import container to truck',
    }
  }

  return null
}
