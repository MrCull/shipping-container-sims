import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, triggerRef, watch } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { trackEvent } from '@/utils/analytics'
import type {
  BoxEmpireState,
  CameraCue,
  CameraCueTarget,
  CraneMode,
  Equipment,
  EquipmentType,
  GameEvent,
  GameEventType,
  GamePhase,
  GatehouseState,
  Job,
  Location,
  NarratorDialogState,
  ReachStackerServiceSide,
  Transaction,
} from '../types'
import {
  DEFAULT_TIME_SCALE,
  MAX_TIME_SCALE,
  RS_SPEED_UNLADEN,
  CRANE_POSITION,
  BERTH_X_SPACING,
  FIRST_BERTH_X,
} from '../modules/config'
import {
  canMhcServeJob,
  createJob,
  cancelJob,
  getActiveJobForContainer,
  resetJobCounter,
} from '../modules/jobScheduler'
import { resetEconomy } from '../modules/economy'
import { resetTruckCounter } from '../modules/truckManager'
import { getVesselSlotRefs, peekNextVesselName, resetVesselCounter } from '../modules/vesselManager'
import { createTutorialSteps, getCurrentStep } from '../modules/tutorial'
import { getNarratorGroup } from '../modules/narratorScript'
import {
  createTutorialScenario,
  resetTutorialFlowFlags,
  resetTutorialScenarioCounters,
} from '../modules/scenario/tutorialScenario'
import { tickSimulation, resetGravityCheck } from '../modules/simulation/simulationEngine'
import type { NarratorRuntime, TutorialFlowRuntime } from '../modules/simulation/simulationTypes'
import { getReachStackerHomePosition } from '../modules/movement/terminalGeometry'
import { resetEquipmentDeadlockState } from '../modules/equipmentController'
import { createSpawnedVesselScenario } from '../modules/scenario/tutorialScenario'
import { applyUnprocessedImportFine } from '../modules/economy/economyLedger'

let eventCounter = 0
let cameraCueCounter = 0

export const useGameStore = defineStore('box-empire-game', () => {
  const globalSettings = useGlobalSettingsStore()

  const gamePhase = ref<GamePhase>('menu')
  const simTime = ref(0)
  const timeScale = ref(DEFAULT_TIME_SCALE)
  const tutorialStep = ref(1)
  const tutorialCompleted = ref(false)
  const tutorialOverlayDismissed = ref(false)
  const gatehouse = ref<GatehouseState>({ exportLaneOpen: false, importLaneOpen: false })
  const money = ref(0)
  const transactions = shallowRef<Transaction[]>(markRaw([]))
  const equipment = shallowRef<BoxEmpireState['equipment']>(markRaw([]))
  const containers = shallowRef<BoxEmpireState['containers']>(markRaw([]))
  const yardBlocks = shallowRef<BoxEmpireState['yardBlocks']>(markRaw([]))
  const vesselVisits = shallowRef<BoxEmpireState['vesselVisits']>(markRaw([]))
  const truckVisits = shallowRef<BoxEmpireState['truckVisits']>(markRaw([]))
  const jobs = shallowRef<Job[]>(markRaw([]))
  const selectedContainerId = ref<string | null>(null)
  const selectedEquipmentId = ref<string | null>(null)
  const selectedVesselId = ref<string | null>(null)
  const selectedGatehouseId = ref<string | null>(null)
  const events = ref<GameEvent[]>([])
  const eventHistory = ref<GameEvent[]>([])
  const pendingEventCallbacks = ref<GameEvent[]>([])

  const tutorialSteps = createTutorialSteps()
  const careerIntroPage = ref(1)

  const exportTrucksSent = ref(0)
  const importTrucksSent = ref(0)
  const dischargingStarted = ref(false)
  const loadingStarted = ref(false)
  const importPickupStarted = ref(false)
  const exportStagingStarted = ref(false)

  const narratorDialog = ref<NarratorDialogState | null>(null)
  const cameraCue = ref<CameraCue | null>(null)
  const narratorQueue = ref<string[]>([])
  const narratorShownGroups = ref<Set<string>>(new Set())
  const narratorVesselDockedFired = ref(false)
  const narratorCraneEnabledFired = ref(false)
  const narratorFirstOnQuayFired = ref(false)
  const narratorImportsInYardFired = ref(false)
  const narratorGroup4Fired = ref(false)
  const narratorFirstGateOutMoneyFired = ref(false)
  const narratorExportToQuayFired = ref(false)
  const narratorGroup5Fired = ref(false)

  const activeJobs = computed(() =>
    jobs.value.filter(job => job.status === 'assigned' || job.status === 'in_progress'),
  )
  const pendingJobs = computed(() => jobs.value.filter(job => job.status === 'pending'))
  const yardOccupancy = computed(() => {
    const block = yardBlocks.value[0]
    if (!block) return 0
    const total = block.bays * block.rows * block.maxTier
    const filled = block.slots.filter(slot => slot.containerId !== null).length
    return total > 0 ? filled / total : 0
  })
  const currentTutorialPrompt = computed(() => {
    const step = getCurrentStep(tutorialSteps, tutorialStep.value)
    return step?.prompt ?? ''
  })
  const totalTutorialSteps = computed(() => tutorialSteps.length)
  const isGodMode = computed(() => globalSettings.godModeEnabled)
  const gatehouseOpen = computed(() => gatehouse.value.exportLaneOpen || gatehouse.value.importLaneOpen)

  function getState(): BoxEmpireState {
    return {
      gamePhase: gamePhase.value,
      simTime: simTime.value,
      timeScale: timeScale.value,
      tutorialStep: tutorialStep.value,
      tutorialCompleted: tutorialCompleted.value,
      gatehouse: gatehouse.value,
      money: money.value,
      transactions: transactions.value,
      equipment: equipment.value,
      containers: containers.value,
      yardBlocks: yardBlocks.value,
      vesselVisits: vesselVisits.value,
      truckVisits: truckVisits.value,
      jobs: jobs.value,
      selectedContainerId: selectedContainerId.value,
      selectedEquipmentId: selectedEquipmentId.value,
      selectedVesselId: selectedVesselId.value,
      selectedGatehouseId: selectedGatehouseId.value,
      events: events.value,
    }
  }

  function applyState(state: BoxEmpireState): void {
    gamePhase.value = state.gamePhase
    simTime.value = state.simTime
    timeScale.value = state.timeScale
    tutorialStep.value = state.tutorialStep
    tutorialCompleted.value = state.tutorialCompleted
    gatehouse.value = state.gatehouse
    money.value = state.money
    transactions.value = markRaw(state.transactions)
    equipment.value = markRaw(state.equipment)
    containers.value = markRaw(state.containers)
    yardBlocks.value = markRaw(state.yardBlocks)
    vesselVisits.value = markRaw(state.vesselVisits)
    truckVisits.value = markRaw(state.truckVisits)
    jobs.value = markRaw(state.jobs)
    selectedContainerId.value = state.selectedContainerId
    selectedEquipmentId.value = state.selectedEquipmentId
    selectedVesselId.value = state.selectedVesselId
    selectedGatehouseId.value = state.selectedGatehouseId
    events.value = state.events
  }

  function refreshSimulationCollections(): void {
    triggerRef(transactions)
    triggerRef(equipment)
    triggerRef(containers)
    triggerRef(yardBlocks)
    triggerRef(vesselVisits)
    triggerRef(truckVisits)
    triggerRef(jobs)
  }

  function addEvent(
    type: GameEventType,
    message: string,
    data?: Record<string, unknown>,
    eventTime = simTime.value,
  ): void {
    eventCounter++
    const event: GameEvent = {
      id: `evt-${eventCounter}`,
      type,
      message,
      simTime: eventTime,
      data,
    }
    events.value.unshift(event)
    if (events.value.length > 20) events.value.length = 20
    eventHistory.value.push(event)
    pendingEventCallbacks.value.push(event)
  }

  function emitEvent(type: GameEventType, message: string, data?: Record<string, unknown>): void {
    addEvent(type, message, data)
  }

  function consumePendingEvents(): GameEvent[] {
    const consumed = [...pendingEventCallbacks.value]
    pendingEventCallbacks.value = []
    return consumed
  }

  function getFlowRuntime(): TutorialFlowRuntime {
    return {
      exportTrucksSent: exportTrucksSent.value,
      importTrucksSent: importTrucksSent.value,
      dischargingStarted: dischargingStarted.value,
      loadingStarted: loadingStarted.value,
      importPickupStarted: importPickupStarted.value,
      exportStagingStarted: exportStagingStarted.value,
      tutorialOverlayDismissed: tutorialOverlayDismissed.value,
    }
  }

  function applyFlowRuntime(flow: TutorialFlowRuntime): void {
    exportTrucksSent.value = flow.exportTrucksSent
    importTrucksSent.value = flow.importTrucksSent
    dischargingStarted.value = flow.dischargingStarted
    loadingStarted.value = flow.loadingStarted
    importPickupStarted.value = flow.importPickupStarted
    exportStagingStarted.value = flow.exportStagingStarted
    tutorialOverlayDismissed.value = flow.tutorialOverlayDismissed
  }

  function getNarratorRuntime(): NarratorRuntime {
    return {
      vesselDockedFired: narratorVesselDockedFired.value,
      craneEnabledFired: narratorCraneEnabledFired.value,
      firstOnQuayFired: narratorFirstOnQuayFired.value,
      importsInYardFired: narratorImportsInYardFired.value,
      trucksRollingFired: narratorGroup4Fired.value,
      firstGateOutMoneyFired: narratorFirstGateOutMoneyFired.value,
      exportToQuayFired: narratorExportToQuayFired.value,
      outroFired: narratorGroup5Fired.value,
    }
  }

  function applyNarratorRuntime(narrator: NarratorRuntime): void {
    narratorVesselDockedFired.value = narrator.vesselDockedFired
    narratorCraneEnabledFired.value = narrator.craneEnabledFired
    narratorFirstOnQuayFired.value = narrator.firstOnQuayFired
    narratorImportsInYardFired.value = narrator.importsInYardFired
    narratorGroup4Fired.value = narrator.trucksRollingFired
    narratorFirstGateOutMoneyFired.value = narrator.firstGateOutMoneyFired
    narratorExportToQuayFired.value = narrator.exportToQuayFired
    narratorGroup5Fired.value = narrator.outroFired
  }

  function resetNarratorState(): void {
    narratorDialog.value = null
    cameraCue.value = null
    narratorQueue.value = []
    narratorShownGroups.value = new Set()
    narratorVesselDockedFired.value = false
    narratorCraneEnabledFired.value = false
    narratorFirstOnQuayFired.value = false
    narratorImportsInYardFired.value = false
    narratorGroup4Fired.value = false
    narratorFirstGateOutMoneyFired.value = false
    narratorExportToQuayFired.value = false
    narratorGroup5Fired.value = false
  }

  function initTutorial(): void {
    const godModeEnabled = isGodMode.value

    eventCounter = 0
    eventHistory.value = []
    cameraCueCounter = 0
    resetTutorialScenarioCounters()
    resetJobCounter()
    resetTruckCounter()
    resetVesselCounter()
    resetEconomy()
    resetEquipmentDeadlockState()
    resetGravityCheck()

    const scenario = createTutorialScenario(godModeEnabled)
    applyState({
      ...getState(),
      ...scenario.state,
    })
    pendingEventCallbacks.value = []
    tutorialOverlayDismissed.value = false
    careerIntroPage.value = 1
    applyFlowRuntime(resetTutorialFlowFlags())
    resetNarratorState()
    enqueueNarratorGroup('intro')
    enqueueNarratorGroup('vessel-announcement')
  }

  function setTimeScale(scale: number): void {
    timeScale.value = Math.max(0, Math.min(MAX_TIME_SCALE, scale))
  }

  function resetToMenu(): void {
    eventCounter = 0
    eventHistory.value = []
    cameraCueCounter = 0
    resetTutorialScenarioCounters()
    applyFlowRuntime(resetTutorialFlowFlags())
    resetJobCounter()
    resetTruckCounter()
    resetVesselCounter()
    resetEconomy()
    resetEquipmentDeadlockState()
    resetGravityCheck()
    resetNarratorState()
    applyState({
      gamePhase: 'menu',
      simTime: 0,
      timeScale: 0,
      tutorialStep: 1,
      tutorialCompleted: false,
      gatehouse: { exportLaneOpen: false, importLaneOpen: false },
      money: 0,
      transactions: [],
      equipment: [],
      containers: [],
      yardBlocks: [],
      vesselVisits: [],
      truckVisits: [],
      jobs: [],
      selectedContainerId: null,
      selectedEquipmentId: null,
      selectedVesselId: null,
      selectedGatehouseId: null,
      events: [],
    })
    tutorialCompleted.value = false
    tutorialOverlayDismissed.value = false
    refreshSimulationCollections()
  }

  function togglePause(): void {
    setTimeScale(timeScale.value > 0 ? 0 : DEFAULT_TIME_SCALE)
  }

  function openExportGate(): void {
    if (gatehouse.value.exportLaneOpen) return
    gatehouse.value.exportLaneOpen = true
    emitEvent('gate.opened', 'Export lane opened - trucks can enter')
  }

  function closeExportGate(): void {
    if (!gatehouse.value.exportLaneOpen) return
    gatehouse.value.exportLaneOpen = false
    emitEvent('gate.closed', 'Export lane closed')
  }

  function openImportGate(): void {
    if (gatehouse.value.importLaneOpen) return
    gatehouse.value.importLaneOpen = true
    emitEvent('gate.opened', 'Import pickup lane opened')
  }

  function closeImportGate(): void {
    if (!gatehouse.value.importLaneOpen) return
    gatehouse.value.importLaneOpen = false
    emitEvent('gate.closed', 'Import pickup lane closed')
  }

  function openGatehouse(): void {
    openExportGate()
    openImportGate()
  }

  function closeGatehouse(): void {
    closeExportGate()
    closeImportGate()
  }

  function requestCameraCue(target: CameraCueTarget): void {
    if (isGodMode.value) return
    if (gamePhase.value === 'sandbox') return
    cameraCueCounter++
    cameraCue.value = {
      id: cameraCueCounter,
      target,
    }
  }

  function setReachStackerServiceSide(
    equipmentId: string,
    side: Exclude<ReachStackerServiceSide, 'internal'>,
    enabled: boolean,
  ): void {
    const eq = equipment.value.find(candidate => candidate.id === equipmentId && candidate.type === 'reach_stacker')
    if (!eq) return
    if (side === 'landside') eq.canServeLandside = enabled
    if (side === 'waterside') eq.canServeWaterside = enabled
    triggerRef(equipment)
  }

  function toggleEquipment(equipmentId: string): void {
    const eq = equipment.value.find(candidate => candidate.id === equipmentId)
    if (eq) {
      eq.enabled = !eq.enabled
      triggerRef(equipment)
    }
  }

  function setCraneMode(equipmentId: string, mode: CraneMode): void {
    const eq = equipment.value.find(candidate => candidate.id === equipmentId)
    if (eq) {
      eq.craneMode = mode
      triggerRef(equipment)
    }
  }

  function deallocateDisallowedCraneMoves(eq: Equipment): void {
    if (eq.type !== 'mobile_harbor_crane') return
    if (eq.carriedContainerId) return

    const state = getState()
    const disallowedJobs = jobs.value.filter(
      job =>
        job.assignedEquipmentId === eq.id &&
        (job.status === 'assigned' || job.status === 'in_progress') &&
        !canMhcServeJob(eq, job, state),
    )
    if (disallowedJobs.length === 0) return

    for (const job of disallowedJobs) {
      job.status = 'pending'
      job.assignedEquipmentId = null
      job.startedAt = null
    }

    if (eq.currentJobId && disallowedJobs.some(job => job.id === eq.currentJobId)) {
      eq.currentJobId = null
      eq.state = 'idle'
      eq.targetPosition = null
      eq.armTargetY = 0
      eq.armDropStartY = 0
      eq.spreaderZ = 0
      eq.stateStartTime = simTime.value
      eq.stateElapsed = 0
    }
    triggerRef(equipment)
    triggerRef(jobs)
  }

  function setCraneVesselPermission(equipmentId: string, vesselId: string, enabled: boolean): void {
    const eq = equipment.value.find(candidate => candidate.id === equipmentId && candidate.type === 'mobile_harbor_crane')
    if (!eq) return
    const allowed = new Set(eq.craneAllowedVesselIds)
    if (enabled) {
      allowed.add(vesselId)
      if (!eq.craneAllowedBaysByVessel[vesselId]) {
        eq.craneAllowedBaysByVessel[vesselId] = getVesselSlotRefs().map(slot => slot.bay)
      }
    } else {
      allowed.delete(vesselId)
    }
    eq.craneAllowedVesselIds = [...allowed]
    deallocateDisallowedCraneMoves(eq)
    triggerRef(equipment)
  }

  function setCraneVesselBayPermission(
    equipmentId: string,
    vesselId: string,
    bay: number,
    enabled: boolean,
  ): void {
    const eq = equipment.value.find(candidate => candidate.id === equipmentId && candidate.type === 'mobile_harbor_crane')
    if (!eq) return
    const allowed = new Set(eq.craneAllowedBaysByVessel[vesselId] ?? getVesselSlotRefs().map(slot => slot.bay))
    if (enabled) allowed.add(bay)
    else allowed.delete(bay)
    eq.craneAllowedBaysByVessel[vesselId] = [...allowed].sort((a, b) => a - b)
    deallocateDisallowedCraneMoves(eq)
    triggerRef(equipment)
  }

  function tick(dt: number): void {
    const state = getState()
    const flow = getFlowRuntime()
    const narrator = getNarratorRuntime()

    tickSimulation({
      state,
      dt,
      isGodMode: isGodMode.value,
      tutorialSteps,
      flow,
      narrator,
      callbacks: {
        emitEvent: (type, message, data) => addEvent(type, message, data, state.simTime),
        enqueueNarratorGroup,
        interruptWithNarratorGroup,
        trackTutorialCompleted: data => trackEvent('box_empire_tutorial_completed', data),
      },
    })

    applyState(state)
    applyFlowRuntime(flow)
    applyNarratorRuntime(narrator)
    refreshSimulationCollections()
  }

  function advanceTutorialStep(): void {
    if (tutorialStep.value < tutorialSteps.length) {
      tutorialStep.value++
    }
  }

  function dismissTutorialOverlay(): void {
    tutorialOverlayDismissed.value = true
  }

  function acceptVessel(): void {
    const vessel = vesselVisits.value[0]
    if (!vessel || vessel.state !== 'announced') return
    vessel.arrivalTime = simTime.value
    triggerRef(vesselVisits)
    requestCameraCue('vessel_approach')
  }

  const CAREER_INTRO_LAST_PAGE = 4

  function beginCareerIntro(): void {
    careerIntroPage.value = 1
    gamePhase.value = 'career_intro'
    emitEvent('level.up', 'Level 2 - your terminal awaits')
  }

  function advanceCareerIntro(): void {
    if (careerIntroPage.value < CAREER_INTRO_LAST_PAGE) {
      careerIntroPage.value++
    }
  }

  function exitCareerIntroToMenu(): void {
    gamePhase.value = 'menu'
    careerIntroPage.value = 1
  }

  function enqueueNarratorGroup(groupId: string): void {
    if (narratorShownGroups.value.has(groupId)) return
    narratorShownGroups.value.add(groupId)
    if (isGodMode.value) return
    narratorQueue.value.push(groupId)
    if (!narratorDialog.value) {
      showNextNarratorGroup()
    }
  }

  function showNextNarratorGroup(): void {
    if (isGodMode.value) return
    const nextId = narratorQueue.value.shift()
    if (!nextId) return
    const group = getNarratorGroup(nextId)
    if (!group || group.beats.length === 0) {
      showNextNarratorGroup()
      return
    }

    narratorDialog.value = {
      beats: group.beats,
      currentBeat: 0,
      groupId: group.id,
    }

    switch (group.id) {
      case 'vessel-docked':
        requestCameraCue('crane')
        break
      case 'first-on-quay':
        requestCameraCue('quay_discharge')
        break
      case 'imports-in-yard':
        requestCameraCue('gatehouse')
        break
      case 'trucks-rolling':
        requestCameraCue('outgate')
        break
      case 'first-gate-out-money':
        requestCameraCue('outgate')
        break
      case 'export-to-quay':
        requestCameraCue('quay_load')
        break
      case 'outro':
        requestCameraCue('berth')
        break
      default:
        break
    }
  }

  function interruptWithNarratorGroup(groupId: string): void {
    if (narratorShownGroups.value.has(groupId)) return
    narratorShownGroups.value.add(groupId)
    if (isGodMode.value) return
    narratorQueue.value = narratorQueue.value.filter(id => id !== groupId)
    narratorDialog.value = null
    narratorQueue.value.unshift(groupId)
    showNextNarratorGroup()
  }

  function narratorNextBeat(): void {
    if (!narratorDialog.value) return
    const next = narratorDialog.value.currentBeat + 1
    if (next < narratorDialog.value.beats.length) {
      narratorDialog.value = { ...narratorDialog.value, currentBeat: next }
      if (narratorDialog.value.groupId === 'vessel-announcement' && next === 1) {
        requestCameraCue('vessel_approach')
      }
      return
    }

    narratorDialog.value = null
    showNextNarratorGroup()
  }

  function closeNarratorDialog(): void {
    narratorDialog.value = null
    showNextNarratorGroup()
  }

  function dispatchNarratorAction(action: string): void {
    switch (action) {
      case 'acceptVessel':
        acceptVessel()
        break
      case 'enableCrane': {
        const mhc = equipment.value.find(eq => eq.id === 'mhc-1')
        if (mhc) {
          mhc.enabled = true
          triggerRef(equipment)
        }
        requestCameraCue('crane')
        if (!narratorCraneEnabledFired.value) {
          narratorCraneEnabledFired.value = true
          enqueueNarratorGroup('crane-enabled')
        }
        break
      }
      case 'enableReachStacker': {
        const rs = equipment.value.find(eq => eq.id === 'rs-1')
        if (rs) {
          rs.enabled = true
          triggerRef(equipment)
        }
        requestCameraCue('yard')
        break
      }
      case 'openGatehouse':
        openGatehouse()
        requestCameraCue('gatehouse')
        break
      case 'setSpeed3x':
        setTimeScale(3)
        break
      case 'setSpeed5x':
        setTimeScale(5)
        break
      default:
        break
    }
  }

  function manualReassignContainer(containerId: string, targetLocation: Location): void {
    const state = getState()
    const existingJob = getActiveJobForContainer(state, containerId)
    if (existingJob) {
      cancelJob(state, existingJob.id)
    }

    const container = containers.value.find(candidate => candidate.id === containerId)
    if (!container) return

    const equipmentType: EquipmentType =
      targetLocation.type === 'vessel_slot' || container.currentLocation.type === 'vessel_slot'
        ? 'mobile_harbor_crane'
        : 'reach_stacker'

    const job = createJob(
      containerId,
      { ...container.currentLocation },
      targetLocation,
      equipmentType,
      15,
      simTime.value,
    )
    jobs.value.push(job)
    triggerRef(jobs)
  }

  watch(() => globalSettings.godModeEnabled, (enabled) => {
    if (!enabled) return
    narratorDialog.value = null
    narratorQueue.value = []
    cameraCue.value = null
    for (const vessel of vesselVisits.value) {
      if (vessel.state === 'announced') {
        vessel.arrivalTime = simTime.value
      }
    }
    triggerRef(vesselVisits)
  })

  function startSandboxMode(): void {
    resetTutorialScenarioCounters()
    resetTutorialFlowFlags()
    resetJobCounter()
    resetTruckCounter()
    resetVesselCounter()
    resetEconomy()
    resetGravityCheck()
    resetEquipmentDeadlockState()
    const scenario = createTutorialScenario(true)
    const fresh = scenario.state
    fresh.gamePhase = 'sandbox'
    fresh.vesselVisits = []
    fresh.equipment = []
    fresh.containers = fresh.containers.filter(c => c.lifecycleState !== 'on_vessel')
    resetVesselCounter()  // tutorial vessel was discarded; start names from "Small Feeder 1"
    applyState({ ...getState(), ...fresh })
    gamePhase.value = 'sandbox'
  }

  function deleteEquipment(equipmentId: string): void {
    if (!isGodMode.value && gamePhase.value !== 'sandbox') return
    const eq = equipment.value.find(e => e.id === equipmentId)
    if (!eq) return
    if (eq.type !== 'reach_stacker' && eq.type !== 'mobile_harbor_crane') return
    // Cancel any active job assigned to this equipment
    const activeJob = jobs.value.find(j => j.assignedEquipmentId === equipmentId && (j.status === 'assigned' || j.status === 'in_progress'))
    if (activeJob) {
      activeJob.status = 'cancelled'
      if (eq.carriedContainerId) {
        const container = containers.value.find(c => c.id === eq.carriedContainerId)
        if (container) container.lifecycleState = 'at_gate'
      }
    }
    equipment.value = equipment.value.filter(e => e.id !== equipmentId)
    triggerRef(equipment)
    if (selectedEquipmentId.value === equipmentId) selectedEquipmentId.value = null
  }

  function spawnMobileHarborCrane(opts?: { craneMode?: CraneMode }): void {
    if (!isGodMode.value && gamePhase.value !== 'sandbox') return
    const existingMHCs = equipment.value.filter(eq => eq.type === 'mobile_harbor_crane')
    const newId = `mhc-${existingMHCs.length + 1}`
    const newMHC: Equipment = {
      id: newId,
      type: 'mobile_harbor_crane',
      state: 'idle',
      position: { x: FIRST_BERTH_X + existingMHCs.length * BERTH_X_SPACING, y: 0, z: CRANE_POSITION.z },
      currentJobId: null,
      carriedContainerId: null,
      stateStartTime: simTime.value,
      stateElapsed: 0,
      targetPosition: null,
      speed: 2,
      enabled: true,
      canServeLandside: true,
      canServeWaterside: true,
      craneMode: opts?.craneMode ?? 'both',
      craneAllowedVesselIds: vesselVisits.value.map(vessel => vessel.id),
      craneAllowedBaysByVessel: Object.fromEntries(
        vesselVisits.value.map(vessel => [vessel.id, getVesselSlotRefs().map(slot => slot.bay)]),
      ),
      armTargetY: 0,
      armDropStartY: 0,
      spreaderZ: 0,
      waypoints: [],
      waypointIndex: 0,
      headingY: 0,
    }
    equipment.value.push(newMHC)
    triggerRef(equipment)
    emitEvent('item.spawned', `Mobile Harbor Crane ${newId} deployed`)
  }

  function spawnVessel(opts?: {
    name?: string
    importCount?: number
    exportCount?: number
    dischargeEnabled?: boolean
    loadEnabled?: boolean
  }): void {
    if (!isGodMode.value && gamePhase.value !== 'sandbox') return
    const activeCount = vesselVisits.value.filter(v => v.state !== 'departed').length
    const { vessel, containers: newContainers } = createSpawnedVesselScenario(activeCount, undefined, opts)
    containers.value.push(...newContainers)
    vesselVisits.value.push(vessel)
    const vesselBays = getVesselSlotRefs().map(slot => slot.bay)
    for (const eq of equipment.value) {
      if (eq.type !== 'mobile_harbor_crane') continue
      if (!eq.craneAllowedVesselIds.includes(vessel.id)) eq.craneAllowedVesselIds.push(vessel.id)
      eq.craneAllowedBaysByVessel[vessel.id] = [...vesselBays]
    }
    triggerRef(containers)
    triggerRef(vesselVisits)
    triggerRef(equipment)
    emitEvent('item.spawned', `Vessel ${vessel.name} incoming`)
  }

  function getNextVesselName(): string {
    return peekNextVesselName()
  }

  function setVesselDischargeEnabled(vesselId: string, enabled: boolean): void {
    const vessel = vesselVisits.value.find(v => v.id === vesselId)
    if (vessel) {
      vessel.dischargeEnabled = enabled
      triggerRef(vesselVisits)
    }
  }

  function setVesselLoadEnabled(vesselId: string, enabled: boolean): void {
    const vessel = vesselVisits.value.find(v => v.id === vesselId)
    if (vessel) {
      vessel.loadEnabled = enabled
      triggerRef(vesselVisits)
    }
  }

  function jobInvolvesVessel(job: Job, vesselId: string): boolean {
    return (
      (job.pickupLocation.type === 'vessel_slot' && job.pickupLocation.id.startsWith(`${vesselId}-`)) ||
      (job.dropoffLocation.type === 'vessel_slot' && job.dropoffLocation.id.startsWith(`${vesselId}-`))
    )
  }

  function sailVesselNow(vesselId: string): void {
    const vessel = vesselVisits.value.find(candidate => candidate.id === vesselId)
    if (!vessel || vessel.state === 'departing' || vessel.state === 'departed') return

    const state = getState()
    const cancellableJobs = jobs.value.filter(
      job =>
        jobInvolvesVessel(job, vesselId) &&
        (job.status === 'pending' ||
          job.status === 'assigned' ||
          job.status === 'in_progress' ||
          job.status === 'blocked'),
    )
    for (const job of cancellableJobs) {
      cancelJob(state, job.id)
    }

    const remainingImports = containers.value.filter(
      container =>
        container.visitType === 'import' &&
        container.vesselSlot?.vesselId === vesselId &&
        container.lifecycleState === 'on_vessel',
    )
    for (const container of remainingImports) {
      const event = applyUnprocessedImportFine(state, container, vessel.position)
      addEvent(event.type, event.message, event.data)
    }
    money.value = state.money

    vessel.state = 'departing'
    selectedVesselId.value = null
    addEvent('vessel.departing', `${vessel.name} ordered to sail`, {
      vesselId: vessel.id,
      cancelledMoves: cancellableJobs.length,
      unprocessedImports: remainingImports.length,
    })
    refreshSimulationCollections()
  }

  function spawnReachStacker(opts?: { landsideEnabled?: boolean; watersideEnabled?: boolean }): void {
    if (!isGodMode.value && gamePhase.value !== 'sandbox') return
    const existingRS = equipment.value.filter(eq => eq.type === 'reach_stacker')
    const newId = `rs-${existingRS.length + 1}`
    const home = getReachStackerHomePosition()
    const newRS: Equipment = {
      id: newId,
      type: 'reach_stacker',
      state: 'idle',
      position: { x: home.x + existingRS.length * 4, y: 0, z: home.z },
      currentJobId: null,
      carriedContainerId: null,
      stateStartTime: simTime.value,
      stateElapsed: 0,
      targetPosition: null,
      speed: RS_SPEED_UNLADEN,
      enabled: true,
      canServeLandside: opts?.landsideEnabled ?? true,
      canServeWaterside: opts?.watersideEnabled ?? true,
      craneMode: 'both',
      craneAllowedVesselIds: [],
      craneAllowedBaysByVessel: {},
      armTargetY: 0,
      armDropStartY: 0,
      spreaderZ: 0,
      waypoints: [],
      waypointIndex: 0,
      headingY: 0,
    }
    equipment.value.push(newRS)
    triggerRef(equipment)
    emitEvent('item.spawned', `Reach Stacker ${newId} deployed`)
  }

  return {
    gamePhase,
    simTime,
    timeScale,
    tutorialStep,
    tutorialCompleted,
    tutorialOverlayDismissed,
    gatehouse,
    gatehouseOpen,
    money,
    transactions,
    equipment,
    containers,
    yardBlocks,
    vesselVisits,
    truckVisits,
    jobs,
    selectedContainerId,
    selectedEquipmentId,
    selectedVesselId,
    selectedGatehouseId,
    events,
    activeJobs,
    pendingJobs,
    yardOccupancy,
    currentTutorialPrompt,
    totalTutorialSteps,
    initTutorial,
    tick,
    setTimeScale,
    resetToMenu,
    togglePause,
    openGatehouse,
    closeGatehouse,
    openExportGate,
    closeExportGate,
    openImportGate,
    closeImportGate,
    toggleEquipment,
    setCraneMode,
    setCraneVesselPermission,
    setCraneVesselBayPermission,
    setReachStackerServiceSide,
    advanceTutorialStep,
    dismissTutorialOverlay,
    acceptVessel,
    careerIntroPage,
    beginCareerIntro,
    advanceCareerIntro,
    exitCareerIntroToMenu,
    emitEvent,
    eventHistory,
    consumePendingEvents,
    manualReassignContainer,
    getState,
    narratorDialog,
    cameraCue,
    narratorNextBeat,
    closeNarratorDialog,
    dispatchNarratorAction,
    requestCameraCue,
    spawnReachStacker,
    spawnMobileHarborCrane,
    spawnVessel,
    getNextVesselName,
    setVesselDischargeEnabled,
    setVesselLoadEnabled,
    sailVesselNow,
    startSandboxMode,
    deleteEquipment,
  }
})
