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
} from '../allocators/destinationAllocator'
import { findShuffleTargetSlot } from '../allocators/yardAllocator'
import { getActiveJobForContainer } from '../jobScheduler'
import { getTruckContainerPositionForVisitType } from '../truckManager'
import {
  getNextDischargeContainer,
  getNextLoadSlot,
  isVesselFullyDischarged,
} from '../vesselManager'
import { isContainerOnTop } from '../yardManager'
import { createImportYardToTruckJob } from '../allocators/destinationAllocator'
import { spawnExportTruck, spawnImportPickupTruck } from './truckOperations'
import { checkStepAdvance, getCurrentStep } from '../tutorial'
import type { DomainEventPayload } from '../economy/economyLedger'
import type { NarratorRuntime, SimulationCallbacks, TutorialFlowRuntime } from '../simulation/simulationTypes'

function emit(callbacks: SimulationCallbacks, event: DomainEventPayload | null): void {
  if (!event) return
  callbacks.emitEvent(event.type, event.message, event.data)
}

export function createInitialDischargeJob(state: BoxEmpireState): void {
  const vessel = state.vesselVisits[0]
  if (!vessel) return
  const next = getNextDischargeContainer(vessel)
  if (!next) return
  if (getActiveJobForContainer(state, next.containerId)) return
  state.jobs.push(createVesselDischargeJob(vessel, next.containerId, next.tier, state.simTime))
}

export function createInitialExportStagingJob(state: BoxEmpireState): void {
  const yard = state.yardBlocks[0]
  if (!yard) return
  const exportInYard = state.containers.find(container => {
    if (container.visitType !== 'export' || container.lifecycleState !== 'in_yard') return false
    if (!container.yardSlot) return false
    if (getActiveJobForContainer(state, container.id)) return false
    return isContainerOnTop(yard, container.id)
  })
  if (!exportInYard) return
  const stageJob = createExportYardToQuayJob(exportInYard, yard, state.simTime)
  if (stageJob) state.jobs.push(stageJob)
}

function continueVesselDischarge(state: BoxEmpireState): void {
  const vessel = state.vesselVisits[0]
  if (!vessel || vessel.state !== 'discharging') return

  const crane = state.equipment.find(eq => eq.type === 'mobile_harbor_crane' && eq.enabled)
  if (!crane || crane.state !== 'idle' || crane.currentJobId) return

  if (isVesselFullyDischarged(vessel)) {
    vessel.state = 'loading'
    return
  }

  const quayDischargeOccupied = state.containers.some(
    container => container.visitType === 'import' && container.lifecycleState === 'discharged_to_buffer',
  ) || state.jobs.some(
    job =>
      job.dropoffLocation.id === 'quay-discharge' &&
      (job.status === 'pending' || job.status === 'assigned' || job.status === 'in_progress'),
  )
  if (quayDischargeOccupied) return

  const next = getNextDischargeContainer(vessel)
  if (!next || getActiveJobForContainer(state, next.containerId)) return
  state.jobs.push(createVesselDischargeJob(vessel, next.containerId, next.tier, state.simTime))
}

function maybeStartImportPickupFlow(state: BoxEmpireState, flow: TutorialFlowRuntime): void {
  if (!flow.importPickupStarted) {
    const importInYard = state.containers.filter(
      container => container.visitType === 'import' && container.lifecycleState === 'in_yard',
    ).length
    const vessel = state.vesselVisits[0]
    if (
      importInYard > 0 &&
      vessel &&
      (vessel.state === 'discharging' ||
        vessel.state === 'loading' ||
        vessel.state === 'departing' ||
        vessel.state === 'departed')
    ) {
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

function ensureImportPickupJobs(state: BoxEmpireState): void {
  const yard = state.yardBlocks[0]
  if (!yard) return

  for (const truck of state.truckVisits) {
    if (truck.visitType !== 'import_pickup') continue
    if (truck.state !== 'waiting_for_equipment') continue
    if (!truck.containerId) continue

    const container = state.containers.find(candidate => candidate.id === truck.containerId)
    if (!container || container.lifecycleState !== 'in_yard' || !container.yardSlot) continue

    if (isContainerOnTop(yard, container.id)) {
      if (!getActiveJobForContainer(state, container.id)) {
        const pickupJob = createImportYardToTruckJob(container, truck, state.simTime)
        if (pickupJob) state.jobs.push(pickupJob)
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
    if (getActiveJobForContainer(state, topSlot.containerId)) continue

    const topRef = {
      blockId: yard.id,
      bay: topSlot.bay,
      row: topSlot.row,
      tier: topSlot.tier,
    }
    const shuffleTarget = findShuffleTargetSlot(yard, topRef, state.jobs)
    if (!shuffleTarget) continue

    state.jobs.push(createYardShuffleJob(topSlot.containerId, yard, topRef, shuffleTarget, state.simTime))
  }
}

function continueExportStagingAndLoading(state: BoxEmpireState, callbacks: SimulationCallbacks): void {
  const vessel = state.vesselVisits[0]
  if (!vessel || vessel.state !== 'loading') return

  const yard = state.yardBlocks[0]
  if (!yard) return

  const rs = state.equipment.find(eq => eq.type === 'reach_stacker')
  const quayLoadOccupied = state.containers.some(
    container =>
      container.lifecycleState === 'staged_for_loading' ||
      (container.lifecycleState === 'discharged_to_buffer' && container.visitType === 'export'),
  ) || state.jobs.some(
    job =>
      job.dropoffLocation.id === 'quay-load' &&
      (job.status === 'pending' || job.status === 'assigned' || job.status === 'in_progress'),
  )

  if (rs && rs.state === 'idle' && !rs.currentJobId && !quayLoadOccupied) {
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
      const activeJob = getActiveJobForContainer(state, container.id)
      if (activeJob && activeJob.status !== 'blocked') return false
      return isContainerOnTop(yard, container.id)
    })

    if (exportInYard) {
      const stageJob = createExportYardToQuayJob(exportInYard, yard, state.simTime)
      if (stageJob) state.jobs.push(stageJob)
    }
  }

  const crane = state.equipment.find(eq => eq.type === 'mobile_harbor_crane')
  if (crane && crane.state === 'idle' && !crane.currentJobId) {
    const stagedExport = state.containers.find(container => {
      if (container.visitType !== 'export' || container.lifecycleState !== 'staged_for_loading') return false
      return !getActiveJobForContainer(state, container.id)
    })
    if (stagedExport) {
      const loadBay = getNextLoadSlot(vessel)
      if (loadBay !== null) {
        state.jobs.push(createExportQuayToVesselJob(stagedExport.id, vessel, loadBay, state.simTime, 11))
      }
    }
  }

  const exportLoaded = state.containers.filter(
    container => container.visitType === 'export' && container.lifecycleState === 'loaded_on_vessel',
  ).length
  if (exportLoaded >= TUTORIAL_EXPORT_COUNT) {
    vessel.state = 'departing'
    callbacks.emitEvent('vessel.departing', `${vessel.name} is departing`)
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

function checkTutorialCompletion(state: BoxEmpireState, callbacks: SimulationCallbacks): void {
  if (state.tutorialCompleted) return

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
): void {
  if (state.gatehouse.exportLaneOpen && flow.exportTrucksSent < TUTORIAL_EXPORT_COUNT) {
    const truckInterval = 5
    const nextTruckTime = flow.exportTrucksSent * truckInterval + 1
    if (state.simTime > nextTruckTime || flow.exportTrucksSent === 0) {
      emit(callbacks, spawnExportTruck(state, flow))
    }
  }

  const vessel = state.vesselVisits[0]
  const crane = state.equipment.find(eq => eq.id === 'mhc-1')
  if (vessel && vessel.state === 'arrived' && crane?.enabled && !flow.dischargingStarted) {
    flow.dischargingStarted = true
    vessel.state = 'discharging'
    createInitialDischargeJob(state)
  }

  continueVesselDischarge(state)
  if (vessel?.state === 'loading') flow.loadingStarted = true

  maybeStartImportPickupFlow(state, flow)
  spawnNeededImportPickupTruck(state, flow, callbacks)
  ensureImportPickupJobs(state)

  if (vessel && vessel.state === 'loading' && !flow.exportStagingStarted) {
    flow.exportStagingStarted = true
    createInitialExportStagingJob(state)
  }

  continueExportStagingAndLoading(state, callbacks)
  fireNarratorMilestones(state, narrator, callbacks)
  checkTutorialCompletion(state, callbacks)
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
