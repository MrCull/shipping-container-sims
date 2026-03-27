// ---------------------------------------------------------------------------
// Box Empire — Pinia store
// ---------------------------------------------------------------------------

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  GamePhase,
  Container,
  Equipment,
  YardBlock,
  VesselVisit,
  TruckVisit,
  Job,
  Transaction,
  GameEvent,
  GameEventType,
  Location,
  BoxEmpireState,
} from '../types'
import {
  CONTAINER_COLOR_LIST,
  CONTAINER_MIN_WEIGHT_KG,
  CONTAINER_MAX_WEIGHT_KG,
  QUAY_BUFFER_POSITION,
  YARD_IO_POSITION,
  CRANE_POSITION,
  GATE_OUT_REVENUE,
  VESSEL_LOAD_REVENUE,
  DEFAULT_TIME_SCALE,
  MAX_TIME_SCALE,
  TUTORIAL_EXPORT_COUNT,
  TUTORIAL_IMPORT_COUNT,
} from '../modules/config'
import { createYardBlock, findAvailableSlot, placeContainerInSlot, removeContainerFromSlot, getSlotWorldPosition } from '../modules/yardManager'
import { createTutorialVessel, getNextDischargeContainer, getNextLoadSlot, dischargeContainerFromVessel, loadContainerOnVessel, isVesselFullyDischarged, tickVessel, getVesselSlotPosition } from '../modules/vesselManager'
import { createTruck, tickTruck, startTruckDeparture, resetTruckCounter } from '../modules/truckManager'
import { tickEquipment } from '../modules/equipmentController'
import { createJob, assignPendingJobs, completeJob, resetJobCounter, getActiveJobForContainer, cancelJob } from '../modules/jobScheduler'
import { createTransaction, resetEconomy } from '../modules/economy'
import { createTutorialSteps, getCurrentStep, checkStepAdvance } from '../modules/tutorial'
import { resetVesselCounter } from '../modules/vesselManager'

let eventCounter = 0
let containerCounter = 0

function nextContainerId(prefix: string): string {
  containerCounter++
  return `${prefix}${String(containerCounter).padStart(7, '0')}`
}

function randomWeight(): number {
  return Math.floor(
    CONTAINER_MIN_WEIGHT_KG + Math.random() * (CONTAINER_MAX_WEIGHT_KG - CONTAINER_MIN_WEIGHT_KG),
  )
}

function randomColor(): string {
  return CONTAINER_COLOR_LIST[Math.floor(Math.random() * CONTAINER_COLOR_LIST.length)]
}

export const useGameStore = defineStore('box-empire-game', () => {
  // ---- Reactive state -----------------------------------------------------
  const gamePhase = ref<GamePhase>('menu')
  const simTime = ref(0)
  const timeScale = ref(DEFAULT_TIME_SCALE)
  const tutorialStep = ref(1)
  const tutorialCompleted = ref(false)
  const gatehouseOpen = ref(false)
  const money = ref(0)
  const transactions = ref<Transaction[]>([])
  const equipment = ref<Equipment[]>([])
  const containers = ref<Container[]>([])
  const yardBlocks = ref<YardBlock[]>([])
  const vesselVisits = ref<VesselVisit[]>([])
  const truckVisits = ref<TruckVisit[]>([])
  const jobs = ref<Job[]>([])
  const selectedContainerId = ref<string | null>(null)
  const selectedEquipmentId = ref<string | null>(null)
  const events = ref<GameEvent[]>([])
  const pendingEventCallbacks = ref<GameEvent[]>([])

  const tutorialSteps = createTutorialSteps()

  // ---- Export/import tracking for tutorial flow ---------------------------
  const exportTrucksSent = ref(0)
  const importTrucksSent = ref(0)
  const dischargingStarted = ref(false)
  const loadingStarted = ref(false)
  const importPickupStarted = ref(false)
  const exportStagingStarted = ref(false)

  // ---- Computed -----------------------------------------------------------
  const activeJobs = computed(() =>
    jobs.value.filter(j => j.status === 'assigned' || j.status === 'in_progress'),
  )
  const pendingJobs = computed(() => jobs.value.filter(j => j.status === 'pending'))
  const yardOccupancy = computed(() => {
    const block = yardBlocks.value[0]
    if (!block) return 0
    const total = block.bays * block.rows * block.maxTier
    const filled = block.slots.filter(s => s.containerId !== null).length
    return total > 0 ? filled / total : 0
  })
  const currentTutorialPrompt = computed(() => {
    const step = getCurrentStep(tutorialSteps, tutorialStep.value)
    return step?.prompt ?? ''
  })
  const totalTutorialSteps = computed(() => tutorialSteps.length)

  // ---- State snapshot for modules -----------------------------------------
  function getState(): BoxEmpireState {
    return {
      gamePhase: gamePhase.value,
      simTime: simTime.value,
      timeScale: timeScale.value,
      tutorialStep: tutorialStep.value,
      tutorialCompleted: tutorialCompleted.value,
      gatehouseOpen: gatehouseOpen.value,
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
      events: events.value,
    }
  }

  // ---- Event helpers ------------------------------------------------------
  function emitEvent(type: GameEventType, message: string, data?: Record<string, unknown>): void {
    eventCounter++
    const evt: GameEvent = {
      id: `evt-${eventCounter}`,
      type,
      message,
      simTime: simTime.value,
      data,
    }
    events.value.unshift(evt)
    if (events.value.length > 20) events.value.length = 20
    pendingEventCallbacks.value.push(evt)
  }

  function consumePendingEvents(): GameEvent[] {
    const evts = [...pendingEventCallbacks.value]
    pendingEventCallbacks.value = []
    return evts
  }

  // ---- Init ---------------------------------------------------------------
  function initTutorial(): void {
    eventCounter = 0
    containerCounter = 0
    resetJobCounter()
    resetTruckCounter()
    resetVesselCounter()
    resetEconomy()

    gamePhase.value = 'tutorial'
    simTime.value = 0
    timeScale.value = DEFAULT_TIME_SCALE
    tutorialStep.value = 1
    tutorialCompleted.value = false
    gatehouseOpen.value = false
    money.value = 0
    transactions.value = []
    events.value = []
    selectedContainerId.value = null
    selectedEquipmentId.value = null
    exportTrucksSent.value = 0
    importTrucksSent.value = 0
    dischargingStarted.value = false
    loadingStarted.value = false
    importPickupStarted.value = false
    exportStagingStarted.value = false

    const yard = createYardBlock()
    yardBlocks.value = [yard]

    const importContainers: Container[] = []
    for (let i = 0; i < TUTORIAL_IMPORT_COUNT; i++) {
      const c: Container = {
        id: nextContainerId('IMPU'),
        size: '20ft',
        ownerColor: randomColor(),
        weight: randomWeight(),
        lifecycleState: 'on_vessel',
        visitType: 'import',
        currentLocation: {
          type: 'vessel_slot',
          id: 'vessel-1',
          position: { x: 0, y: 4 + i * 2.64, z: -8 },
        },
        yardSlot: null,
        vesselSlot: { vesselId: 'vessel-1', bay: 1, row: 1, tier: i + 1 },
      }
      importContainers.push(c)
    }

    const exportContainers: Container[] = []
    for (let i = 0; i < TUTORIAL_EXPORT_COUNT; i++) {
      exportContainers.push({
        id: nextContainerId('EXPU'),
        size: '20ft',
        ownerColor: randomColor(),
        weight: randomWeight(),
        lifecycleState: 'at_gate',
        visitType: 'export',
        currentLocation: {
          type: 'gate_buffer',
          id: `truck-export-${i + 1}`,
          position: { x: 0, y: 0, z: 0 },
        },
        yardSlot: null,
        vesselSlot: null,
      })
    }

    containers.value = [...importContainers, ...exportContainers]

    const vessel = createTutorialVessel(importContainers, 60)
    vesselVisits.value = [vessel]

    importContainers.forEach((c, i) => {
      c.currentLocation.position = getVesselSlotPosition(vessel, i + 1)
    })

    equipment.value = [
      {
        id: 'rs-1',
        type: 'reach_stacker',
        state: 'idle',
        position: { x: 10, y: 0, z: 25 },
        currentJobId: null,
        carriedContainerId: null,
        stateStartTime: 0,
        stateElapsed: 0,
        targetPosition: null,
        speed: 5,
      },
      {
        id: 'mhc-1',
        type: 'mobile_harbor_crane',
        state: 'idle',
        position: { ...CRANE_POSITION },
        currentJobId: null,
        carriedContainerId: null,
        stateStartTime: 0,
        stateElapsed: 0,
        targetPosition: null,
        speed: 2,
      },
    ]

    truckVisits.value = []
    jobs.value = []
  }

  // ---- Time controls ------------------------------------------------------
  function setTimeScale(scale: number): void {
    timeScale.value = Math.max(0, Math.min(MAX_TIME_SCALE, scale))
  }

  function togglePause(): void {
    if (timeScale.value > 0) {
      timeScale.value = 0
    } else {
      timeScale.value = DEFAULT_TIME_SCALE
    }
  }

  // ---- Gate ---------------------------------------------------------------
  function openGatehouse(): void {
    if (gatehouseOpen.value) return
    gatehouseOpen.value = true
    emitEvent('gate.opened', 'Gatehouse opened — trucks can now enter')
  }

  function closeGatehouse(): void {
    if (!gatehouseOpen.value) return
    gatehouseOpen.value = false
    emitEvent('gate.closed', 'Gatehouse closed')
  }

  // ---- Truck spawning helpers ---------------------------------------------
  function spawnExportTruck(containerIndex: number): void {
    const container = containers.value.find(
      c => c.visitType === 'export' && c.lifecycleState === 'at_gate',
    )
    if (!container) return
    const truck = createTruck(container.id, 'export_delivery')
    truck.stateStartTime = simTime.value
    container.currentLocation = {
      type: 'truck',
      id: truck.id,
      position: { ...truck.position },
    }
    truckVisits.value.push(truck)
    exportTrucksSent.value++
    emitEvent('truck.arrived', `Export truck ${truck.id} approaching gate`, { truckId: truck.id })
    void containerIndex
  }

  function spawnImportPickupTruck(): void {
    const container = containers.value.find(
      c => c.visitType === 'import' && c.lifecycleState === 'in_yard',
    )
    if (!container) return
    const truck = createTruck(null, 'import_pickup')
    truck.stateStartTime = simTime.value
    truck.containerId = container.id
    truckVisits.value.push(truck)
    importTrucksSent.value++
    emitEvent('truck.arrived', `Import pickup truck ${truck.id} approaching`, { truckId: truck.id })
  }

  // ---- Main tick ----------------------------------------------------------
  function tick(dt: number): void {
    if (gamePhase.value !== 'tutorial' && gamePhase.value !== 'playing') return
    if (timeScale.value === 0) return

    const scaledDt = dt * timeScale.value
    simTime.value += scaledDt

    const state = getState()

    // Tick vessels
    for (const vessel of vesselVisits.value) {
      const vResult = tickVessel(vessel, state, scaledDt)
      if (vResult.stateChanged) {
        if (vResult.newState === 'arrived') {
          emitEvent('vessel.arrived', `${vessel.name} has arrived at berth`)
          vessel.state = 'arrived'
        }
        if (vResult.newState === 'departed') {
          emitEvent('vessel.departed', `${vessel.name} has departed`)
        }
      }
    }

    // Tick trucks
    for (const truck of truckVisits.value) {
      if (truck.state === 'departed') continue
      const tResult = tickTruck(truck, state, scaledDt)

      if (tResult.readyForEquipment) {
        if (truck.visitType === 'export_delivery' && truck.containerId) {
          const container = containers.value.find(c => c.id === truck.containerId)
          if (container) {
            container.currentLocation = {
              type: 'truck',
              id: truck.id,
              position: { ...YARD_IO_POSITION },
            }
          }
          const yard = yardBlocks.value[0]
          const slot = findAvailableSlot(yard)
          if (slot && truck.containerId) {
            const dropPos = getSlotWorldPosition(yard, slot)
            const job = createJob(
              truck.containerId,
              { type: 'truck', id: truck.id, position: { ...YARD_IO_POSITION } },
              { type: 'yard_slot', id: `${slot.blockId}-${slot.bay}-${slot.row}-${slot.tier}`, position: dropPos },
              'reach_stacker',
              10,
              simTime.value,
            )
            jobs.value.push(job)
            emitEvent('job.created', `Job to store export container in yard`)
          }
        } else if (truck.visitType === 'import_pickup' && truck.containerId) {
          const container = containers.value.find(c => c.id === truck.containerId)
          if (container && container.lifecycleState === 'in_yard') {
            const job = createJob(
              truck.containerId,
              {
                type: 'yard_slot',
                id: container.yardSlot
                  ? `${container.yardSlot.blockId}-${container.yardSlot.bay}-${container.yardSlot.row}-${container.yardSlot.tier}`
                  : 'yard',
                position: { ...container.currentLocation.position },
              },
              { type: 'truck', id: truck.id, position: { ...YARD_IO_POSITION } },
              'reach_stacker',
              8,
              simTime.value,
            )
            jobs.value.push(job)
            emitEvent('job.created', `Job to deliver import container to truck`)
          }
        }
      }
    }

    // Tick equipment
    for (const eq of equipment.value) {
      const eResult = tickEquipment(eq, state, scaledDt)

      if (eResult.pickedContainerId) {
        emitEvent('container.picked', `Container ${eResult.pickedContainerId} picked up`)
      }

      if (eResult.jobCompleted && eResult.jobId) {
        const job = jobs.value.find(j => j.id === eResult.jobId)
        completeJob(state, eResult.jobId)
        emitEvent('job.completed', `Job ${eResult.jobId} completed`)

        if (job && eResult.droppedContainerId) {
          const container = containers.value.find(c => c.id === eResult.droppedContainerId)
          if (container) {
            handleJobCompletion(job, container)
          }
        }
      }
    }

    // Assign pending jobs to idle equipment
    assignPendingJobs(state)

    // Tutorial flow logic
    handleTutorialFlow()

    // Check tutorial step advancement
    checkTutorialAdvance()
  }

  function handleJobCompletion(job: Job, container: Container): void {
    if (job.dropoffLocation.type === 'yard_slot') {
      const yard = yardBlocks.value[0]
      const parts = job.dropoffLocation.id.split('-')
      if (parts.length >= 4) {
        const slotRef = {
          blockId: parts[0] + '-' + parts[1],
          bay: parseInt(parts[2]),
          row: parseInt(parts[3]),
          tier: parseInt(parts[4]),
        }
        placeContainerInSlot(yard, slotRef, container.id)
        container.yardSlot = slotRef
        container.lifecycleState = 'in_yard'
        container.currentLocation = {
          type: 'yard_slot',
          id: job.dropoffLocation.id,
          position: { ...job.dropoffLocation.position },
        }
        emitEvent('container.placed', `Container ${container.id} stored in yard`)

        if (container.visitType === 'export') {
          const truck = truckVisits.value.find(
            t => t.containerId === container.id && t.state === 'waiting_for_equipment',
          )
          if (truck) {
            truck.containerId = null
            startTruckDeparture(truck, simTime.value)
          }
        }
      }
    } else if (job.dropoffLocation.type === 'truck') {
      container.lifecycleState = 'at_gate'
      container.currentLocation = {
        type: 'truck',
        id: job.dropoffLocation.id,
        position: { ...job.dropoffLocation.position },
      }
      container.yardSlot = null

      if (container.visitType === 'import') {
        const yard = yardBlocks.value[0]
        removeContainerFromSlot(yard, container.id)
      }

      const truck = truckVisits.value.find(
        t => t.id === job.dropoffLocation.id && t.state === 'waiting_for_equipment',
      )
      if (truck) {
        truck.containerId = container.id
        startTruckDeparture(truck, simTime.value)
        container.lifecycleState = 'departed'
        container.currentLocation = {
          type: 'gate_buffer',
          id: 'departed',
          position: { ...truck.position },
        }

        if (container.visitType === 'import') {
          const tx = createTransaction('gate_out_revenue', container.id, simTime.value)
          transactions.value.push(tx)
          money.value += tx.amount
          emitEvent('money.earned', `+$${GATE_OUT_REVENUE} — import container gate-out`, { amount: GATE_OUT_REVENUE })
        }
      }
    } else if (job.dropoffLocation.type === 'quay_buffer') {
      container.currentLocation = {
        type: 'quay_buffer',
        id: 'quay-buffer',
        position: { ...QUAY_BUFFER_POSITION },
      }

      if (container.visitType === 'import') {
        container.lifecycleState = 'discharged_to_buffer'
        const vessel = vesselVisits.value[0]
        if (vessel) dischargeContainerFromVessel(vessel, container.id)
        container.vesselSlot = null

        const yard = yardBlocks.value[0]
        const slot = findAvailableSlot(yard)
        if (slot) {
          const dropPos = getSlotWorldPosition(yard, slot)
          const moveJob = createJob(
            container.id,
            { type: 'quay_buffer', id: 'quay-buffer', position: { ...QUAY_BUFFER_POSITION } },
            { type: 'yard_slot', id: `${slot.blockId}-${slot.bay}-${slot.row}-${slot.tier}`, position: dropPos },
            'reach_stacker',
            9,
            simTime.value,
          )
          jobs.value.push(moveJob)
        }
      } else if (container.visitType === 'export') {
        container.lifecycleState = 'staged_for_loading'
        container.yardSlot = null

        const yard = yardBlocks.value[0]
        removeContainerFromSlot(yard, container.id)

        const vessel = vesselVisits.value[0]
        if (vessel) {
          const loadTier = getNextLoadSlot(vessel)
          if (loadTier !== null) {
            const vesselPos = getVesselSlotPosition(vessel, loadTier)
            const loadJob = createJob(
              container.id,
              { type: 'quay_buffer', id: 'quay-buffer', position: { ...QUAY_BUFFER_POSITION } },
              { type: 'vessel_slot', id: `vessel-slot-${loadTier}`, position: vesselPos },
              'mobile_harbor_crane',
              10,
              simTime.value,
            )
            jobs.value.push(loadJob)
          }
        }
      }
    } else if (job.dropoffLocation.type === 'vessel_slot') {
      const vessel = vesselVisits.value[0]
      if (vessel) {
        const tierMatch = job.dropoffLocation.id.match(/(\d+)$/)
        const tier = tierMatch ? parseInt(tierMatch[1]) : 1
        loadContainerOnVessel(vessel, container.id, tier)
        container.lifecycleState = 'loaded_on_vessel'
        container.vesselSlot = { vesselId: vessel.id, bay: 1, row: 1, tier }
        container.currentLocation = {
          type: 'vessel_slot',
          id: vessel.id,
          position: { ...job.dropoffLocation.position },
        }

        const tx = createTransaction('vessel_load_revenue', container.id, simTime.value)
        transactions.value.push(tx)
        money.value += tx.amount
        emitEvent('money.earned', `+$${VESSEL_LOAD_REVENUE} — export container loaded on vessel`, { amount: VESSEL_LOAD_REVENUE })
        emitEvent('container.placed', `Container ${container.id} loaded on ${vessel.name}`)
      }
    }
  }

  function handleTutorialFlow(): void {
    // Phase: spawn export trucks when gate opens
    if (gatehouseOpen.value && exportTrucksSent.value < TUTORIAL_EXPORT_COUNT) {
      const truckInterval = 5
      const nextTruckTime = exportTrucksSent.value * truckInterval + 1
      if (simTime.value > nextTruckTime || exportTrucksSent.value === 0) {
        spawnExportTruck(exportTrucksSent.value)
      }
    }

    // Phase: Start discharging when vessel arrives and all exports are in yard
    const vessel = vesselVisits.value[0]
    if (vessel && vessel.state === 'arrived' && !dischargingStarted.value) {
      const exportsInYard = containers.value.filter(
        c => c.visitType === 'export' && c.lifecycleState === 'in_yard',
      ).length
      if (exportsInYard >= TUTORIAL_EXPORT_COUNT) {
        dischargingStarted.value = true
        vessel.state = 'discharging'
        startDischarge()
      }
    }

    // Phase: Continue discharging (create new discharge jobs as crane becomes idle)
    if (vessel && vessel.state === 'discharging') {
      const crane = equipment.value.find(e => e.id === 'mhc-1')
      if (crane && crane.state === 'idle' && !crane.currentJobId) {
        const next = getNextDischargeContainer(vessel)
        if (next) {
          const vesselPos = getVesselSlotPosition(vessel, next.tier)
          const dischargeJob = createJob(
            next.containerId,
            { type: 'vessel_slot', id: `vessel-slot-${next.tier}`, position: vesselPos },
            { type: 'quay_buffer', id: 'quay-buffer', position: { ...QUAY_BUFFER_POSITION } },
            'mobile_harbor_crane',
            12,
            simTime.value,
          )
          jobs.value.push(dischargeJob)
        } else if (isVesselFullyDischarged(vessel)) {
          vessel.state = 'loading'
          loadingStarted.value = true
        }
      }
    }

    // Phase: Spawn import pickup trucks
    if (!importPickupStarted.value) {
      const importInYard = containers.value.filter(
        c => c.visitType === 'import' && c.lifecycleState === 'in_yard',
      ).length
      if (importInYard > 0 && vessel && (vessel.state === 'discharging' || vessel.state === 'loading' || vessel.state === 'departing' || vessel.state === 'departed')) {
        importPickupStarted.value = true
      }
    }

    if (importPickupStarted.value && importTrucksSent.value < TUTORIAL_IMPORT_COUNT) {
      const importInYard = containers.value.filter(
        c => c.visitType === 'import' && c.lifecycleState === 'in_yard',
      )
      const importPickupTrucksActive = truckVisits.value.filter(
        t => t.visitType === 'import_pickup' && t.state !== 'departed',
      ).length
      const importDone = containers.value.filter(
        c => c.visitType === 'import' && c.lifecycleState === 'departed',
      ).length

      if (importInYard.length > 0 && importPickupTrucksActive < 2 && (importTrucksSent.value < importDone + importInYard.length)) {
        spawnImportPickupTruck()
      }
    }

    // Phase: Start loading export containers onto vessel
    if (vessel && vessel.state === 'loading' && !exportStagingStarted.value) {
      exportStagingStarted.value = true
      startExportStaging()
    }

    // Phase: Continue staging export containers
    if (vessel && vessel.state === 'loading') {
      const rs = equipment.value.find(e => e.id === 'rs-1')
      if (rs && rs.state === 'idle' && !rs.currentJobId) {
        const exportInYard = containers.value.find(
          c => c.visitType === 'export' && c.lifecycleState === 'in_yard',
        )
        if (exportInYard && exportInYard.yardSlot) {
          const yard = yardBlocks.value[0]
          const slotPos = getSlotWorldPosition(yard, exportInYard.yardSlot)
          const stageJob = createJob(
            exportInYard.id,
            {
              type: 'yard_slot',
              id: `${exportInYard.yardSlot.blockId}-${exportInYard.yardSlot.bay}-${exportInYard.yardSlot.row}-${exportInYard.yardSlot.tier}`,
              position: slotPos,
            },
            { type: 'quay_buffer', id: 'quay-buffer', position: { ...QUAY_BUFFER_POSITION } },
            'reach_stacker',
            10,
            simTime.value,
          )
          jobs.value.push(stageJob)
        }
      }

      // Continue creating crane load jobs
      const crane = equipment.value.find(e => e.id === 'mhc-1')
      if (crane && crane.state === 'idle' && !crane.currentJobId) {
        const stagedExport = containers.value.find(
          c => c.visitType === 'export' && c.lifecycleState === 'staged_for_loading',
        )
        if (stagedExport) {
          const loadTier = getNextLoadSlot(vessel)
          if (loadTier !== null) {
            const vesselPos = getVesselSlotPosition(vessel, loadTier)
            const loadJob = createJob(
              stagedExport.id,
              { type: 'quay_buffer', id: 'quay-buffer', position: { ...QUAY_BUFFER_POSITION } },
              { type: 'vessel_slot', id: `vessel-slot-${loadTier}`, position: vesselPos },
              'mobile_harbor_crane',
              11,
              simTime.value,
            )
            jobs.value.push(loadJob)
          }
        }
      }

      // Check if loading is complete
      const exportLoaded = containers.value.filter(
        c => c.visitType === 'export' && c.lifecycleState === 'loaded_on_vessel',
      ).length
      if (exportLoaded >= TUTORIAL_EXPORT_COUNT) {
        vessel.state = 'departing'
      }
    }

    // Tutorial completion check
    if (!tutorialCompleted.value) {
      const importDeparted = containers.value.filter(
        c => c.visitType === 'import' && c.lifecycleState === 'departed',
      ).length
      const exportLoaded = containers.value.filter(
        c => c.visitType === 'export' && c.lifecycleState === 'loaded_on_vessel',
      ).length
      const vesselDeparted = vessel && vessel.state === 'departed'

      if (importDeparted >= TUTORIAL_IMPORT_COUNT && exportLoaded >= TUTORIAL_EXPORT_COUNT && vesselDeparted) {
        tutorialCompleted.value = true
        gamePhase.value = 'completed'
        emitEvent('tutorial.completed', 'Tutorial complete! You processed all containers!')
      }
    }
  }

  function startDischarge(): void {
    const vessel = vesselVisits.value[0]
    if (!vessel) return
    const next = getNextDischargeContainer(vessel)
    if (!next) return
    const vesselPos = getVesselSlotPosition(vessel, next.tier)
    const dischargeJob = createJob(
      next.containerId,
      { type: 'vessel_slot', id: `vessel-slot-${next.tier}`, position: vesselPos },
      { type: 'quay_buffer', id: 'quay-buffer', position: { ...QUAY_BUFFER_POSITION } },
      'mobile_harbor_crane',
      12,
      simTime.value,
    )
    jobs.value.push(dischargeJob)
  }

  function startExportStaging(): void {
    const exportInYard = containers.value.find(
      c => c.visitType === 'export' && c.lifecycleState === 'in_yard',
    )
    if (!exportInYard || !exportInYard.yardSlot) return
    const yard = yardBlocks.value[0]
    const slotPos = getSlotWorldPosition(yard, exportInYard.yardSlot)
    const stageJob = createJob(
      exportInYard.id,
      {
        type: 'yard_slot',
        id: `${exportInYard.yardSlot.blockId}-${exportInYard.yardSlot.bay}-${exportInYard.yardSlot.row}-${exportInYard.yardSlot.tier}`,
        position: slotPos,
      },
      { type: 'quay_buffer', id: 'quay-buffer', position: { ...QUAY_BUFFER_POSITION } },
      'reach_stacker',
      10,
      simTime.value,
    )
    jobs.value.push(stageJob)
  }

  function checkTutorialAdvance(): void {
    if (tutorialCompleted.value) return
    const step = getCurrentStep(tutorialSteps, tutorialStep.value)
    if (!step) return
    const state = getState()
    if (checkStepAdvance(step, state)) {
      tutorialStep.value++
    }
  }

  function advanceTutorialStep(): void {
    if (tutorialStep.value < tutorialSteps.length) {
      tutorialStep.value++
    }
  }

  // ---- Manual override ----------------------------------------------------
  function manualReassignContainer(containerId: string, targetLocation: Location): void {
    const existingJob = getActiveJobForContainer(getState(), containerId)
    if (existingJob) {
      cancelJob(getState(), existingJob.id)
    }

    const container = containers.value.find(c => c.id === containerId)
    if (!container) return

    const equipType: import('../types').EquipmentType =
      targetLocation.type === 'vessel_slot' || container.currentLocation.type === 'vessel_slot'
        ? 'mobile_harbor_crane'
        : 'reach_stacker'

    const job = createJob(
      containerId,
      { ...container.currentLocation },
      targetLocation,
      equipType,
      15,
      simTime.value,
    )
    jobs.value.push(job)
  }

  return {
    gamePhase,
    simTime,
    timeScale,
    tutorialStep,
    tutorialCompleted,
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
    events,
    activeJobs,
    pendingJobs,
    yardOccupancy,
    currentTutorialPrompt,
    totalTutorialSteps,
    initTutorial,
    tick,
    setTimeScale,
    togglePause,
    openGatehouse,
    closeGatehouse,
    advanceTutorialStep,
    emitEvent,
    consumePendingEvents,
    manualReassignContainer,
    getState,
  }
})
