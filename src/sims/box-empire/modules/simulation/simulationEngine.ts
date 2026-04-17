import type { Container, Equipment, Job } from '../../types'
import {
  applyGateOutRevenue,
  applyQuayCraneImportUnloadCost,
  applyReachStackerMoveCost,
  type DomainEventPayload,
} from '../economy/economyLedger'
import { tickEquipment } from '../equipmentController'
import { assignPendingJobs, completeJob, recheckBlockedJobs } from '../jobScheduler'
import { createOccupancyWorld } from '../movement/occupancyWorld'
import { createJobsForTruckReadyAtYard, syncContainerToTruck } from '../operations/truckOperations'
import { handleJobCompletion } from '../operations/jobCompletion'
import { advanceTutorialProgress, planTutorialOperations } from '../operations/tutorialOperations'
import { tickTruck, startExportTruckExit } from '../truckManager'
import { dischargeContainerFromVessel, tickVessel } from '../vesselManager'
import { removeContainerFromSlot } from '../yardManager'
import type { SimulationCallbacks, SimulationTickContext } from './simulationTypes'

function emit(callbacks: SimulationCallbacks, event: DomainEventPayload | null): void {
  if (!event) return
  callbacks.emitEvent(event.type, event.message, event.data)
}

function emitMany(callbacks: SimulationCallbacks, events: DomainEventPayload[]): void {
  for (const event of events) emit(callbacks, event)
}

function cancelPendingVesselJobs(jobs: Job[]): void {
  for (const job of jobs) {
    if (job.status !== 'pending' && job.status !== 'blocked') continue
    if (job.pickupLocation.type !== 'vessel_slot' && job.dropoffLocation.type !== 'vessel_slot') continue
    job.status = 'cancelled'
  }
}

function processVessels(context: SimulationTickContext): void {
  const { state, dt, isGodMode, narrator, callbacks } = context

  for (const vessel of state.vesselVisits) {
    if (isGodMode && vessel.state === 'announced') {
      vessel.arrivalTime = state.simTime
    }
    const result = tickVessel(vessel, state, dt, isGodMode)
    if (!result.stateChanged) continue

    if (result.newState === 'arriving') {
      callbacks.emitEvent('vessel.arriving', `${vessel.name} is approaching the berth`)
    }
    if (result.newState === 'arrived') {
      callbacks.emitEvent('vessel.arrived', `${vessel.name} has arrived at berth`)
      vessel.state = 'arrived'
      if (!narrator.vesselDockedFired) {
        narrator.vesselDockedFired = true
        callbacks.enqueueNarratorGroup('vessel-docked')
      }
    }
    if (result.newState === 'departing') {
      callbacks.emitEvent('vessel.departing', `${vessel.name} is departing`)
    }
    if (result.newState === 'departed') {
      callbacks.emitEvent('vessel.departed', `${vessel.name} has departed`)
      cancelPendingVesselJobs(state.jobs)
    }
  }
}

function processGateOutRevenue(
  context: SimulationTickContext,
  truckContainer: Container,
  truckPosition: { x: number; y: number; z: number },
): void {
  const { state, narrator, callbacks } = context

  emit(callbacks, applyGateOutRevenue(state, truckContainer, truckPosition))
  if (!narrator.firstGateOutMoneyFired) {
    narrator.firstGateOutMoneyFired = true
    callbacks.enqueueNarratorGroup('first-gate-out-money')
  }
  truckContainer.lifecycleState = 'at_gate'
  truckContainer.currentLocation = {
    type: 'truck',
    id: truckContainer.currentLocation.id,
    position: { ...truckPosition },
  }
}

function processTrucks(context: SimulationTickContext): void {
  const { state, dt, callbacks } = context
  const occupancy = createOccupancyWorld(state)

  for (const truck of state.truckVisits) {
    if (truck.state === 'departed') continue

    const result = tickTruck(truck, state, dt, occupancy)

    if (truck.containerId) {
      const movingContainer = state.containers.find(container => container.id === truck.containerId)
      if (movingContainer) syncContainerToTruck(movingContainer, truck)
    }

    if (result.readyForEquipment) {
      emit(callbacks, createJobsForTruckReadyAtYard(state, truck))
    }

    if (result.gateOutProcessed && truck.visitType === 'import_pickup' && truck.containerId) {
      const container = state.containers.find(candidate => candidate.id === truck.containerId)
      if (container) processGateOutRevenue(context, container, truck.position)
    }

    if (result.departed && truck.containerId) {
      const container = state.containers.find(candidate => candidate.id === truck.containerId)
      if (
        container &&
        (container.lifecycleState === 'at_gate' || container.lifecycleState === 'returning_to_gate')
      ) {
        container.lifecycleState = 'departed'
      }
      occupancy.remove(truck.id)
    }
  }
}

function removePickedContainerFromSource(
  state: SimulationTickContext['state'],
  eq: Equipment,
  pickedContainerId: string,
): void {
  const pickedJob = state.jobs.find(job => job.id === eq.currentJobId)
  if (!pickedJob) return

  if (pickedJob.pickupLocation.type === 'yard_slot') {
    const yard = state.yardBlocks[0]
    if (yard) removeContainerFromSlot(yard, pickedContainerId)
    const container = state.containers.find(candidate => candidate.id === pickedContainerId)
    if (container) container.yardSlot = null
  }

  if (pickedJob.pickupLocation.type === 'truck') {
    const truck = state.truckVisits.find(
      candidate => candidate.id === pickedJob.pickupLocation.id && candidate.state === 'waiting_for_equipment',
    )
    if (truck && truck.visitType === 'export_delivery' && truck.containerId === pickedContainerId) {
      truck.containerId = null
      startExportTruckExit(truck, state.simTime)
    }
  }

  if (eq.type === 'mobile_harbor_crane' && pickedJob.pickupLocation.type === 'vessel_slot') {
    const vessel = state.vesselVisits[0]
    if (vessel) dischargeContainerFromVessel(vessel, pickedContainerId)
    const container = state.containers.find(candidate => candidate.id === pickedContainerId)
    if (container) container.vesselSlot = null
  }
}

function processEquipment(context: SimulationTickContext): void {
  const { state, dt, callbacks, isGodMode } = context
  const occupancy = createOccupancyWorld(state)

  for (const eq of state.equipment) {
    const result = tickEquipment(eq, state, dt, occupancy)

    if (result.pickedContainerId) {
      callbacks.emitEvent('container.picked', `Container ${result.pickedContainerId} picked up`)
      if (eq.type === 'mobile_harbor_crane') {
        callbacks.emitEvent('vessel.container.lifted', `Crane lifted container ${result.pickedContainerId}`)
      }
      removePickedContainerFromSource(state, eq, result.pickedContainerId)
    }

    if (!result.jobCompleted || !result.jobId) continue

    const job = state.jobs.find(candidate => candidate.id === result.jobId)
    completeJob(state, result.jobId)
    callbacks.emitEvent('job.completed', `Job ${result.jobId} completed`)

    if (eq.type === 'mobile_harbor_crane' && result.droppedContainerId) {
      callbacks.emitEvent('vessel.container.placed', `Crane placed container ${result.droppedContainerId}`)
    }

    if (!job || !result.droppedContainerId) continue

    emit(callbacks, applyReachStackerMoveCost(state, job, eq, isGodMode))
    emit(callbacks, applyQuayCraneImportUnloadCost(state, job, eq, isGodMode))

    const container = state.containers.find(candidate => candidate.id === result.droppedContainerId)
    if (container) {
      emitMany(callbacks, handleJobCompletion(state, job, container))
    }
  }
}

function assignJobs(state: SimulationTickContext['state']): void {
  recheckBlockedJobs(state)
  assignPendingJobs(state)
}

export function tickSimulation(context: SimulationTickContext): void {
  const { state, dt, tutorialSteps } = context

  if (state.gamePhase !== 'tutorial' && state.gamePhase !== 'playing') return
  if (state.timeScale === 0) return

  const scaledDt = dt * state.timeScale
  state.simTime += scaledDt

  const tickContext: SimulationTickContext = {
    ...context,
    dt: scaledDt,
  }

  processVessels(tickContext)
  processTrucks(tickContext)
  processEquipment(tickContext)

  assignJobs(state)
  planTutorialOperations(state, context.flow, context.narrator, context.callbacks)
  assignJobs(state)
  advanceTutorialProgress(state, context.flow, context.narrator, tutorialSteps, context.callbacks)
}
