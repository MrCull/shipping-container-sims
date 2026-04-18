import type { BoxEmpireState, Container, TutorialStep } from '../../types'
import {
  TUTORIAL_EXPORT_COUNT,
  TUTORIAL_IMPORT_COUNT,
} from '../config'
import {
  createExportQuayToVesselJob,
  createExportYardToQuayJob,
  createVesselDischargeJob,
  createYardShuffleJob,
  getLoadExchangePositionForCraneX,
} from '../allocators/destinationAllocator'
import { findShuffleTargetSlot } from '../allocators/yardAllocator'
import { getActiveJobForContainer } from '../jobScheduler'
import { getTruckContainerPositionForVisitType } from '../truckManager'
import {
  getDischargeableVesselContainers,
  getNextDischargeContainer,
  getNextLoadSlot,
  getVesselSlotPosition,
  isVesselFullyDischarged,
} from '../vesselManager'
import { isContainerOnTop } from '../yardManager'
import { createImportYardToTruckJob } from '../allocators/destinationAllocator'
import { spawnExportTruck, spawnImportPickupTruck } from './truckOperations'
import { checkStepAdvance, getCurrentStep } from '../tutorial'
import type { DomainEventPayload } from '../economy/economyLedger'
import type { SimulationIndexes } from '../simulation/simulationIndexes'
import type { NarratorRuntime, SimulationCallbacks, TutorialFlowRuntime } from '../simulation/simulationTypes'

function emit(callbacks: SimulationCallbacks, event: DomainEventPayload | null): void {
  if (!event) return
  callbacks.emitEvent(event.type, event.message, event.data)
}

function getActiveJob(
  state: BoxEmpireState,
  containerId: string,
  indexes?: SimulationIndexes,
) {
  return getActiveJobForContainer(state, containerId, indexes)
}

function pushPlannedJob(
  state: BoxEmpireState,
  job: BoxEmpireState['jobs'][number] | null,
  indexes?: SimulationIndexes,
): void {
  if (!job) return
  state.jobs.push(job)
  indexes?.jobById.set(job.id, job)
  if (
    job.status === 'pending' ||
    job.status === 'assigned' ||
    job.status === 'in_progress' ||
    job.status === 'blocked'
  ) {
    if (!indexes?.activeJobByContainerId.has(job.containerId)) {
      indexes?.activeJobByContainerId.set(job.containerId, job)
    }
  }
}

export function createInitialDischargeJob(state: BoxEmpireState): void {
  const vessel = state.vesselVisits[0]
  if (!vessel) return
  const next = getNextDischargeContainer(vessel)
  if (!next) return
  if (getActiveJobForContainer(state, next.containerId)) return
  state.jobs.push(createVesselDischargeJob(vessel, next.containerId, next.bay, next.row, next.tier, state.simTime))
}

function createAvailableDischargeJobsForVessel(
  state: BoxEmpireState,
  vessel: BoxEmpireState['vesselVisits'][number],
  indexes?: SimulationIndexes,
): void {
  for (const next of getDischargeableVesselContainers(vessel)) {
    if (getActiveJob(state, next.containerId, indexes)) continue
    pushPlannedJob(state, createVesselDischargeJob(
      vessel,
      next.containerId,
      next.bay,
      next.row,
      next.tier,
      state.simTime,
    ), indexes)
  }
}

export function createInitialExportStagingJob(state: BoxEmpireState): void {
  const yard = state.yardBlocks[0]
  if (!yard) return
  const loadingVessel = state.vesselVisits.find(v => v.state === 'loading')
  if (!loadingVessel) return
  const loadSlot = getNextLoadSlot(loadingVessel)
  if (loadSlot === null) return
  const loadExchangePosition = getLoadExchangePositionForCraneX(
    getVesselSlotPosition(loadingVessel, loadSlot.bay, loadSlot.row, loadSlot.tier).x,
  )
  const exportInYard = state.containers.find(container => {
    if (container.visitType !== 'export' || container.lifecycleState !== 'in_yard') return false
    if (!container.yardSlot) return false
    if (getActiveJobForContainer(state, container.id)) return false
    return isContainerOnTop(yard, container.id)
  })
  if (!exportInYard) return
  const stageJob = createExportYardToQuayJob(exportInYard, yard, state.simTime, loadExchangePosition)
  if (stageJob) state.jobs.push(stageJob)
}

function continueVesselDischarge(state: BoxEmpireState, indexes?: SimulationIndexes): void {
  for (const vessel of state.vesselVisits) {
    if (vessel.state !== 'discharging') continue

    if (isVesselFullyDischarged(vessel)) {
      vessel.state = 'loading'
      continue
    }

    createAvailableDischargeJobsForVessel(state, vessel, indexes)
  }
}

function maybeStartImportPickupFlow(state: BoxEmpireState, flow: TutorialFlowRuntime): void {
  if (!flow.importPickupStarted) {
    const importInYard = state.containers.filter(
      container => container.visitType === 'import' && container.lifecycleState === 'in_yard',
    ).length
    const anyVesselInProgress = state.vesselVisits.some(v =>
      v.state === 'discharging' || v.state === 'loading' || v.state === 'departing' || v.state === 'departed',
    )
    if (importInYard > 0 && anyVesselInProgress) {
      flow.importPickupStarted = true
    }
  }
}

function spawnNeededImportPickupTruck(
  state: BoxEmpireState,
  flow: TutorialFlowRuntime,
  callbacks: SimulationCallbacks,
): void {
  if (!flow.importPickupStarted || !state.gatehouse.importLaneOpen) return

  const activeImportPickupTrucks = state.truckVisits.filter(
    truck => truck.visitType === 'import_pickup' && truck.state !== 'departed',
  ).length
  const trucksWithContainer = new Set(
    state.truckVisits
      .filter(truck => truck.visitType === 'import_pickup' && truck.containerId && truck.state !== 'departed')
      .map(truck => truck.containerId as string),
  )
  const importNeedingTruck = state.containers.filter(
    container =>
      container.visitType === 'import' &&
      container.lifecycleState === 'in_yard' &&
      !trucksWithContainer.has(container.id),
  )

  if (importNeedingTruck.length > 0 && activeImportPickupTrucks < 2) {
    emit(callbacks, spawnImportPickupTruck(state, flow))
  }
}

function ensureImportPickupJobs(state: BoxEmpireState, indexes?: SimulationIndexes): void {
  const yard = state.yardBlocks[0]
  if (!yard) return

  for (const truck of state.truckVisits) {
    if (truck.visitType !== 'import_pickup') continue
    if (truck.state !== 'waiting_for_equipment') continue
    if (!truck.containerId) continue

    const container = state.containers.find(candidate => candidate.id === truck.containerId)
    if (!container || container.lifecycleState !== 'in_yard' || !container.yardSlot) continue

    if (isContainerOnTop(yard, container.id)) {
      if (!getActiveJob(state, container.id, indexes)) {
        const pickupJob = createImportYardToTruckJob(container, truck, state.simTime)
        pushPlannedJob(state, pickupJob, indexes)
      }
      continue
    }

    const buriedSlot = yard.slots.find(slot => slot.containerId === container.id)
    if (!buriedSlot) continue

    const topSlot = yard.slots
      .filter(
        slot =>
          slot.bay === buriedSlot.bay &&
          slot.row === buriedSlot.row &&
          slot.tier > buriedSlot.tier &&
          slot.containerId !== null,
      )
      .sort((a, b) => b.tier - a.tier)[0]
    if (!topSlot?.containerId) continue
    if (getActiveJob(state, topSlot.containerId, indexes)) continue

    const topRef = {
      blockId: yard.id,
      bay: topSlot.bay,
      row: topSlot.row,
      tier: topSlot.tier,
    }
    const shuffleTarget = findShuffleTargetSlot(yard, topRef, state.jobs)
    if (!shuffleTarget) continue

    pushPlannedJob(state, createYardShuffleJob(topSlot.containerId, yard, topRef, shuffleTarget, state.simTime), indexes)
  }
}

function continueExportStagingAndLoading(
  state: BoxEmpireState,
  callbacks: SimulationCallbacks,
  indexes?: SimulationIndexes,
): void {
  const loadingVessels = state.vesselVisits.filter(v => v.state === 'loading')
  if (loadingVessels.length === 0) return

  const yard = state.yardBlocks[0]
  if (!yard) return

  // RS: stage export containers from yard to quay load buffer
  const quayLoadOccupied = state.containers.some(
    container =>
      container.lifecycleState === 'staged_for_loading' ||
      (container.lifecycleState === 'discharged_to_buffer' && container.visitType === 'export'),
  ) || state.jobs.some(
    job =>
      job.dropoffLocation.id === 'quay-load' &&
      (job.status === 'pending' || job.status === 'assigned' || job.status === 'in_progress'),
  )

  if (!quayLoadOccupied) {
    const rs = state.equipment.find(eq => eq.type === 'reach_stacker')
    if (rs && rs.state === 'idle' && !rs.currentJobId) {
      for (const job of state.jobs) {
        if (job.status !== 'blocked') continue
        if (job.dropoffLocation.type !== 'quay_buffer' || job.dropoffLocation.id !== 'quay-load') continue
        const container = state.containers.find(candidate => candidate.id === job.containerId)
        if (!container || container.visitType !== 'export') continue
        if (isContainerOnTop(yard, container.id)) job.status = 'cancelled'
      }

      const exportInYard = state.containers.find(container => {
        if (container.visitType !== 'export' || container.lifecycleState !== 'in_yard') return false
        if (!container.yardSlot) return false
        const activeJob = getActiveJob(state, container.id, indexes)
        if (activeJob && activeJob.status !== 'blocked') return false
        return isContainerOnTop(yard, container.id)
      })
      if (exportInYard) {
        const targetVessel = loadingVessels.find(v => getNextLoadSlot(v) !== null)
        const targetSlot = targetVessel ? getNextLoadSlot(targetVessel) : null
        const loadExchangePosition = targetVessel && targetSlot
          ? getLoadExchangePositionForCraneX(getVesselSlotPosition(
            targetVessel,
            targetSlot.bay,
            targetSlot.row,
            targetSlot.tier,
          ).x)
          : undefined
        const stageJob = createExportYardToQuayJob(exportInYard, yard, state.simTime, loadExchangePosition)
        pushPlannedJob(state, stageJob, indexes)
      }
    }
  }

  // No exports remain anywhere — all loading vessels can depart
  const noExportsLeft = !state.containers.some(
    c => c.visitType === 'export' && ['in_yard', 'at_gate', 'staged_for_loading'].includes(c.lifecycleState),
  )

  // MHC: load staged exports onto each loading vessel
  for (const vessel of loadingVessels) {
    if (!vessel.loadEnabled || getNextLoadSlot(vessel) === null || noExportsLeft) {
      vessel.state = 'departing'
      callbacks.emitEvent('vessel.departing', `${vessel.name} is departing`)
      continue
    }

    const stagedExport = state.containers.find(container => {
      if (container.visitType !== 'export' || container.lifecycleState !== 'staged_for_loading') return false
      return !getActiveJob(state, container.id, indexes)
    })
    if (!stagedExport) continue

    const loadSlot = getNextLoadSlot(vessel)
    if (loadSlot !== null) {
      pushPlannedJob(state, createExportQuayToVesselJob(
        stagedExport.id,
        vessel,
        loadSlot.bay,
        loadSlot.row,
        loadSlot.tier,
        state.simTime,
        11,
        { ...stagedExport.currentLocation.position },
      ), indexes)
    }
  }
}

function fireNarratorMilestones(
  state: BoxEmpireState,
  narrator: NarratorRuntime,
  callbacks: SimulationCallbacks,
): void {
  if (!narrator.importsInYardFired) {
    const firstInYard = state.containers.some(
      container => container.visitType === 'import' && container.lifecycleState === 'in_yard',
    )
    if (firstInYard) {
      narrator.importsInYardFired = true
      callbacks.interruptWithNarratorGroup('imports-in-yard')
    }
  }

  if (!narrator.trucksRollingFired) {
    const importOnTruck = state.containers.some(
      container => container.visitType === 'import' && container.lifecycleState === 'returning_to_gate',
    )
    if (importOnTruck) {
      narrator.trucksRollingFired = true
      callbacks.enqueueNarratorGroup('trucks-rolling')
    }
  }

  if (!narrator.exportToQuayFired) {
    const firstExportStaged = state.containers.some(
      container => container.visitType === 'export' && container.lifecycleState === 'staged_for_loading',
    )
    if (firstExportStaged) {
      narrator.exportToQuayFired = true
      callbacks.enqueueNarratorGroup('export-to-quay')
    }
  }

  if (!narrator.outroFired) {
    const firstExportLoaded = state.containers.some(
      container => container.visitType === 'export' && container.lifecycleState === 'loaded_on_vessel',
    )
    if (firstExportLoaded) {
      narrator.outroFired = true
      callbacks.enqueueNarratorGroup('outro')
    }
  }
}

function checkTutorialCompletion(state: BoxEmpireState, isGodMode: boolean, callbacks: SimulationCallbacks): void {
  if (state.tutorialCompleted) return
  if (isGodMode) return  // No auto-completion in god mode

  const vessel = state.vesselVisits[0]
  const importDeparted = state.containers.filter(
    container => container.visitType === 'import' && container.lifecycleState === 'departed',
  ).length
  const exportLoaded = state.containers.filter(
    container => container.visitType === 'export' && container.lifecycleState === 'loaded_on_vessel',
  ).length
  const vesselDeparted = vessel && vessel.state === 'departed'

  if (importDeparted < TUTORIAL_IMPORT_COUNT || exportLoaded < TUTORIAL_EXPORT_COUNT || !vesselDeparted) return

  state.tutorialCompleted = true
  state.gamePhase = 'completed'
  callbacks.emitEvent('tutorial.completed', 'Tutorial complete! You processed all containers!')
  callbacks.trackTutorialCompleted({
    import_departed: importDeparted,
    export_loaded: exportLoaded,
    sim_time_seconds: Math.round(state.simTime),
    money: state.money,
  })
}

export function planTutorialOperations(
  state: BoxEmpireState,
  flow: TutorialFlowRuntime,
  narrator: NarratorRuntime,
  callbacks: SimulationCallbacks,
  isGodMode = false,
  indexes?: SimulationIndexes,
): void {
  const exportContainersWaitingAtGate = state.containers.some(
    container => container.visitType === 'export' && container.lifecycleState === 'at_gate',
  )
  const activeExportDeliveryTrucks = state.truckVisits.filter(
    truck => truck.visitType === 'export_delivery' && truck.state !== 'departed',
  ).length
  const vesselActive = state.vesselVisits.some(
    v => v.state !== 'announced' && v.state !== 'departed',
  )
  const sandboxTrucksAllowed = state.gamePhase !== 'sandbox' || vesselActive
  if (state.gatehouse.exportLaneOpen && exportContainersWaitingAtGate && activeExportDeliveryTrucks < 4 && sandboxTrucksAllowed) {
    const truckInterval = 5
    const nextTruckTime = flow.exportTrucksSent * truckInterval + 1
    if (state.simTime > nextTruckTime || flow.exportTrucksSent === 0) {
      emit(callbacks, spawnExportTruck(state, flow))
    }
  }

  // Make discharge work available as soon as a vessel is alongside.
  for (const vessel of state.vesselVisits) {
    if (vessel.state !== 'arrived') continue
    if (!vessel.dischargeEnabled) {
      vessel.state = 'loading'
      continue
    }
    vessel.state = 'discharging'
    flow.dischargingStarted = true
    createAvailableDischargeJobsForVessel(state, vessel, indexes)
  }

  continueVesselDischarge(state, indexes)
  if (state.vesselVisits.some(v => v.state === 'loading')) flow.loadingStarted = true

  maybeStartImportPickupFlow(state, flow)
  spawnNeededImportPickupTruck(state, flow, callbacks)
  ensureImportPickupJobs(state, indexes)

  if (!flow.exportStagingStarted && state.vesselVisits.some(v => v.state === 'loading')) {
    flow.exportStagingStarted = true
    createInitialExportStagingJob(state)
  }

  continueExportStagingAndLoading(state, callbacks, indexes)
  if (state.gamePhase !== 'sandbox') {
    fireNarratorMilestones(state, narrator, callbacks)
    checkTutorialCompletion(state, isGodMode, callbacks)
  }
}

export function advanceTutorialProgress(
  state: BoxEmpireState,
  flow: TutorialFlowRuntime,
  narrator: NarratorRuntime,
  tutorialSteps: TutorialStep[],
  callbacks: SimulationCallbacks,
): void {
  if (state.tutorialCompleted) return
  if (state.tutorialStep > tutorialSteps.length) return

  const step = getCurrentStep(tutorialSteps, state.tutorialStep)
  if (!step || !checkStepAdvance(step, state)) return

  if (state.tutorialStep >= tutorialSteps.length) {
    flow.tutorialOverlayDismissed = true
    return
  }

  const previousStep = state.tutorialStep
  state.tutorialStep++
  if (previousStep === 3 && state.tutorialStep === 4 && !narrator.firstOnQuayFired) {
    narrator.firstOnQuayFired = true
    callbacks.enqueueNarratorGroup('first-on-quay')
  }
}

export function syncWaitingTruckPickupAfterYardPlace(
  state: BoxEmpireState,
  container: Container,
): void {
  if (container.visitType !== 'import' || !container.yardSlot) return
  const waitingTruck = state.truckVisits.find(
    truck => truck.visitType === 'import_pickup' && truck.containerId === container.id && truck.state === 'waiting_for_equipment',
  )
  if (!waitingTruck) return
  if (getActiveJobForContainer(state, container.id)) return

  const pickupJob = createImportYardToTruckJob(container, waitingTruck, state.simTime)
  if (pickupJob) state.jobs.push(pickupJob)
}

export function getTruckPickupPositionForContainer(state: BoxEmpireState, containerId: string) {
  const truck = state.truckVisits.find(candidate => candidate.containerId === containerId)
  if (!truck) return null
  return getTruckContainerPositionForVisitType(truck.visitType)
}
