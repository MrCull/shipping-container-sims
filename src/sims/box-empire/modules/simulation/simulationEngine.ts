import type { Container, Equipment, Job, YardSlotRef } from '../../types'
import {
  applyGateOutRevenue,
  applyQuayCraneImportUnloadCost,
  applyReachStackerMoveCost,
  type DomainEventPayload,
} from '../economy/economyLedger'
import { tickEquipment } from '../equipmentController'
import { assignPendingJobs, completeJob, recheckBlockedJobs, getActiveJobForContainer } from '../jobScheduler'
import { createOccupancyWorld } from '../movement/occupancyWorld'
import { createJobsForTruckReadyAtYard, syncContainerToTruck } from '../operations/truckOperations'
import { handleJobCompletion } from '../operations/jobCompletion'
import { advanceTutorialProgress, planTutorialOperations } from '../operations/tutorialOperations'
import { tickTruck, startExportTruckExit } from '../truckManager'
import { dischargeContainerFromVessel, tickVessel } from '../vesselManager'
import { removeContainerFromSlot, getSlotWorldPosition } from '../yardManager'
import { makeYardSlotId } from '../../types'
import { buildSimulationIndexes } from './simulationIndexes'
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
      // Stamp arrivedAt for all import containers on this vessel (enables dwell time display)
      for (const c of state.containers) {
        if (c.visitType === 'import' && c.vesselSlot?.vesselId === vessel.id && c.arrivedAt === 0) {
          c.arrivedAt = state.simTime
        }
      }
      if (!narrator.vesselDockedFired && state.gamePhase !== 'sandbox') {
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
  const { state, dt, callbacks, indexes } = context
  const occupancy = createOccupancyWorld(state)

  for (const truck of state.truckVisits) {
    if (truck.state === 'departed') continue

    const result = tickTruck(truck, state, dt, occupancy)

    if (truck.containerId) {
      const movingContainer = indexes?.containerById.get(truck.containerId)
      if (movingContainer) syncContainerToTruck(movingContainer, truck)
    }

    if (result.readyForEquipment) {
      emit(callbacks, createJobsForTruckReadyAtYard(state, truck))
    }

    if (result.gateOutProcessed && truck.visitType === 'import_pickup' && truck.containerId) {
      const container = indexes?.containerById.get(truck.containerId)
      if (container) processGateOutRevenue(context, container, truck.position)
    }

    if (result.departed && truck.containerId) {
      const container = indexes?.containerById.get(truck.containerId)
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
  context?: SimulationTickContext,
): void {
  const pickedJob = eq.currentJobId
    ? context?.indexes?.jobById.get(eq.currentJobId) ?? state.jobs.find(job => job.id === eq.currentJobId)
    : null
  if (!pickedJob) return

  if (pickedJob.pickupLocation.type === 'yard_slot') {
    const yard = state.yardBlocks[0]
    if (yard) removeContainerFromSlot(yard, pickedContainerId)
    const container = context?.indexes?.containerById.get(pickedContainerId)
      ?? state.containers.find(candidate => candidate.id === pickedContainerId)
    if (container) container.yardSlot = null
  }

  if (pickedJob.pickupLocation.type === 'truck') {
    const truck = state.truckVisits.find(
      candidate => candidate.id === pickedJob.pickupLocation.id && candidate.state === 'waiting_for_equipment',
    )
    if (truck && truck.visitType === 'export_delivery' && truck.containerId === pickedContainerId) {
      truck.containerId = null
      startExportTruckExit(truck, state.simTime, eq.position)
    }
  }

  if (eq.type === 'mobile_harbor_crane' && pickedJob.pickupLocation.type === 'vessel_slot') {
    const container = context?.indexes?.containerById.get(pickedContainerId)
      ?? state.containers.find(candidate => candidate.id === pickedContainerId)
    const vesselId = container?.vesselSlot?.vesselId
    const vessel = vesselId ? context?.indexes?.vesselById.get(vesselId) ?? state.vesselVisits[0] : state.vesselVisits[0]
    if (vessel) dischargeContainerFromVessel(vessel, pickedContainerId)
    if (container) container.vesselSlot = null
  }
}

function processEquipment(context: SimulationTickContext): void {
  const { state, dt, callbacks, isGodMode, indexes } = context
  const occupancy = createOccupancyWorld(state)

  for (const eq of state.equipment) {
    const result = tickEquipment(eq, state, dt, occupancy)

    if (result.pickedContainerId) {
      const pickedJob = eq.currentJobId
        ? (indexes?.jobById.get(eq.currentJobId) ?? state.jobs.find(j => j.id === eq.currentJobId))
        : null
      const fromLoc = pickedJob?.pickupLocation
      const fromDesc = fromLoc
        ? `from ${fromLoc.type} ${fromLoc.id}`
        : 'from unknown'
      callbacks.emitEvent('container.picked', `Container ${result.pickedContainerId} picked up ${fromDesc}`, { containerId: result.pickedContainerId, fromType: fromLoc?.type, fromId: fromLoc?.id })
      if (eq.type === 'mobile_harbor_crane') {
        callbacks.emitEvent('vessel.container.lifted', `Crane lifted container ${result.pickedContainerId}`)
      }
      removePickedContainerFromSource(state, eq, result.pickedContainerId, context)
    }

    if (!result.jobCompleted || !result.jobId) continue

    const job = indexes?.jobById.get(result.jobId) ?? state.jobs.find(candidate => candidate.id === result.jobId)
    completeJob(state, result.jobId)
    callbacks.emitEvent('job.completed', `Job ${result.jobId} completed`)

    if (eq.type === 'mobile_harbor_crane' && result.droppedContainerId) {
      callbacks.emitEvent('vessel.container.placed', `Crane placed container ${result.droppedContainerId}`)
    }

    if (!job || !result.droppedContainerId) continue

    emit(callbacks, applyReachStackerMoveCost(state, job, eq, isGodMode))
    emit(callbacks, applyQuayCraneImportUnloadCost(state, job, eq, isGodMode))

    const container = indexes?.containerById.get(result.droppedContainerId)
      ?? state.containers.find(candidate => candidate.id === result.droppedContainerId)
    if (container) {
      emitMany(callbacks, handleJobCompletion(state, job, container, eq.position))
    }
  }
}

function assignJobs(state: SimulationTickContext['state']): void {
  recheckBlockedJobs(state)
  assignPendingJobs(state)
}

const GRAVITY_CHECK_INTERVAL = 0
let lastGravityCheckTime = 0

export function resetGravityCheck(): void {
  lastGravityCheckTime = -GRAVITY_CHECK_INTERVAL
}

function reconcileYardSlots(state: SimulationTickContext['state'], callbacks: SimulationCallbacks): void {
  const yard = state.yardBlocks[0]
  if (!yard) return

  // Pass 1: clear any slot whose container disagrees it's there (stale reference)
  for (const slot of yard.slots) {
    if (!slot.containerId) continue
    const container = state.containers.find(c => c.id === slot.containerId)
    if (!container) { slot.containerId = null; continue }
    const ys = container.yardSlot
    if (!ys || ys.bay !== slot.bay || ys.row !== slot.row || ys.tier !== slot.tier) {
      callbacks.emitEvent('yard.slot.repaired', `Stale slot cleared: ${slot.containerId} at bay ${slot.bay} tier ${slot.tier} (container says bay ${ys?.bay ?? '?'} tier ${ys?.tier ?? '?'})`, { containerId: slot.containerId, staleBay: slot.bay, staleTier: slot.tier, containerBay: ys?.bay, containerTier: ys?.tier })
      slot.containerId = null
    }
  }

  // Pass 2: re-register any in_yard container whose slot entry was lost
  for (const container of state.containers) {
    if (container.lifecycleState !== 'in_yard') continue
    const ys = container.yardSlot
    if (!ys) continue
    const slot = yard.slots.find(s => s.bay === ys.bay && s.row === ys.row && s.tier === ys.tier)
    if (slot && slot.containerId === null) {
      callbacks.emitEvent('yard.slot.repaired', `Missing slot re-registered: ${container.id} at bay ${ys.bay} tier ${ys.tier}`, { containerId: container.id, bay: ys.bay, tier: ys.tier })
      slot.containerId = container.id
    }
  }
}

function checkYardGravity(state: SimulationTickContext['state'], callbacks: SimulationCallbacks): void {
  if (state.simTime - lastGravityCheckTime < GRAVITY_CHECK_INTERVAL) return
  lastGravityCheckTime = state.simTime

  reconcileYardSlots(state, callbacks)

  const yard = state.yardBlocks[0]
  if (!yard) return

  for (const container of state.containers) {
    if (container.lifecycleState !== 'in_yard') continue
    const slot = container.yardSlot
    if (!slot || slot.tier <= 1) continue  // already on the ground

    // Verify the yard slot data agrees this container is here
    const currentSlot = yard.slots.find(
      s => s.bay === slot.bay && s.row === slot.row && s.tier === slot.tier && s.containerId === container.id,
    )
    if (!currentSlot) continue  // slot data inconsistent — skip safely

    // Check if the tier directly below is empty
    const belowSlot = yard.slots.find(
      s => s.bay === slot.bay && s.row === slot.row && s.tier === slot.tier - 1,
    )
    if (!belowSlot || belowSlot.containerId !== null) continue  // something is already below

    const activeJob = getActiveJobForContainer(state, container.id)

    // If an RS is past travel_to_pickup (already picking or carrying), don't interfere
    if (activeJob && (activeJob.status === 'assigned' || activeJob.status === 'in_progress')) {
      const rs = activeJob.assignedEquipmentId
        ? state.equipment.find(e => e.id === activeJob.assignedEquipmentId)
        : null
      const rsCommitted = rs && rs.state !== 'assigned' && rs.state !== 'travel_to_pickup'
      if (rsCommitted) {
        callbacks.emitEvent('yard.gravity.skipped', `Gravity skipped: ${container.id} floating at bay ${slot.bay} tier ${slot.tier} — RS ${rs.id} is ${rs.state}`, { containerId: container.id, bay: slot.bay, tier: slot.tier, jobId: activeJob.id, rsState: rs.state })
        continue
      }
    }

    // Drop one tier — direct fail-safe, no RS needed
    currentSlot.containerId = null
    belowSlot.containerId = container.id
    const newRef: YardSlotRef = { blockId: slot.blockId, bay: slot.bay, row: slot.row, tier: slot.tier - 1 }
    container.yardSlot = newRef
    container.currentLocation = {
      type: 'yard_slot',
      id: makeYardSlotId(slot.blockId, slot.bay, slot.row, slot.tier - 1),
      position: getSlotWorldPosition(yard, newRef),
    }
    callbacks.emitEvent('yard.gravity.applied', `Gravity: ${container.id} sunk from tier ${slot.tier} to tier ${slot.tier - 1} at bay ${slot.bay}`, { containerId: container.id, bay: slot.bay, fromTier: slot.tier, toTier: slot.tier - 1 })

    // Redirect any active pickup job to the new tier position
    if (activeJob && activeJob.pickupLocation.type === 'yard_slot') {
      activeJob.pickupLocation = {
        type: 'yard_slot',
        id: makeYardSlotId(slot.blockId, slot.bay, slot.row, slot.tier - 1),
        position: getSlotWorldPosition(yard, newRef),
      }
    }
  }
}

export function tickSimulation(context: SimulationTickContext): void {
  const { state, dt, tutorialSteps } = context

  if (state.gamePhase !== 'tutorial' && state.gamePhase !== 'playing' && state.gamePhase !== 'sandbox') return
  if (state.timeScale === 0) return

  const scaledDt = dt * state.timeScale
  state.simTime += scaledDt

  const tickContext: SimulationTickContext = {
    ...context,
    dt: scaledDt,
    indexes: buildSimulationIndexes(state),
  }

  processVessels(tickContext)
  processTrucks(tickContext)
  processEquipment(tickContext)

  assignJobs(state)
  checkYardGravity(state, tickContext.callbacks)
  tickContext.indexes = buildSimulationIndexes(state)
  planTutorialOperations(state, context.flow, context.narrator, context.callbacks, context.isGodMode, tickContext.indexes)
  assignJobs(state)
  if (state.gamePhase !== 'sandbox') {
    advanceTutorialProgress(state, context.flow, context.narrator, tutorialSteps, context.callbacks)
  }
}
