import type { BoxEmpireState, Container, Equipment, Job, TruckVisit, YardBlock } from '../../types'
import {
  CONTAINER_MAX_WEIGHT_KG,
  CONTAINER_MIN_WEIGHT_KG,
  CRANE_POSITION,
  DEFAULT_TIME_SCALE,
  SHIPPING_LINE_COLORS,
  SHIPPING_LINES,
  TUTORIAL_EXPORT_COUNT,
  TUTORIAL_IMPORT_COUNT,
} from '../config'
import { getReachStackerHomePosition } from '../movement/terminalGeometry'
import { createYardBlock } from '../yardManager'
import { createTutorialVessel, getVesselSlotPosition } from '../vesselManager'

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

function randomShippingLine(): string {
  return SHIPPING_LINES[Math.floor(Math.random() * SHIPPING_LINES.length)]
}

function shippingLineColor(line: string): string {
  return SHIPPING_LINE_COLORS[line] ?? '#888888'
}

export function resetTutorialScenarioCounters(): void {
  containerCounter = 0
}

export interface TutorialScenario {
  state: Pick<
    BoxEmpireState,
    | 'gamePhase'
    | 'simTime'
    | 'timeScale'
    | 'tutorialStep'
    | 'tutorialCompleted'
    | 'gatehouse'
    | 'money'
    | 'transactions'
    | 'equipment'
    | 'containers'
    | 'yardBlocks'
    | 'vesselVisits'
    | 'truckVisits'
    | 'jobs'
    | 'selectedContainerId'
    | 'selectedEquipmentId'
    | 'selectedGatehouseId'
    | 'events'
  >
}

function createImportContainers(): Container[] {
  const containers: Container[] = []
  for (let i = 0; i < TUTORIAL_IMPORT_COUNT; i++) {
    const line = randomShippingLine()
    containers.push({
      id: nextContainerId('IMPU'),
      size: '20ft',
      shippingLine: line,
      ownerColor: shippingLineColor(line),
      weight: randomWeight(),
      lifecycleState: 'on_vessel',
      visitType: 'import',
      currentLocation: {
        type: 'vessel_slot',
        id: 'vessel-1',
        position: { x: 0, y: 4 + i * 2.64, z: -8 },
      },
      yardSlot: null,
      vesselSlot: { vesselId: 'vessel-1', bay: i + 1, row: 1, tier: 1 },
      arrivedAt: 0,
      revenueEarned: 0,
    })
  }
  return containers
}

function createExportContainers(): Container[] {
  const containers: Container[] = []
  for (let i = 0; i < TUTORIAL_EXPORT_COUNT; i++) {
    const line = randomShippingLine()
    containers.push({
      id: nextContainerId('EXPU'),
      size: '20ft',
      shippingLine: line,
      ownerColor: shippingLineColor(line),
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
      arrivedAt: 0,
      revenueEarned: 0,
    })
  }
  return containers
}

function createTutorialEquipment(godModeEnabled: boolean): Equipment[] {
  return [
    {
      id: 'rs-1',
      type: 'reach_stacker',
      state: 'idle',
      position: getReachStackerHomePosition(),
      currentJobId: null,
      carriedContainerId: null,
      stateStartTime: 0,
      stateElapsed: 0,
      targetPosition: null,
      speed: 5,
      enabled: godModeEnabled,
      canServeLandside: true,
      canServeWaterside: true,
      craneMode: 'both',
      armTargetY: 0,
      armDropStartY: 0,
      spreaderZ: 0,
      waypoints: [],
      waypointIndex: 0,
      headingY: 0,
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
      enabled: godModeEnabled,
      canServeLandside: true,
      canServeWaterside: true,
      craneMode: 'both',
      armTargetY: 0,
      armDropStartY: 0,
      spreaderZ: 0,
      waypoints: [],
      waypointIndex: 0,
      headingY: 0,
    },
  ]
}

export function createTutorialScenario(godModeEnabled: boolean): TutorialScenario {
  const yardBlocks: YardBlock[] = [createYardBlock()]
  const importContainers = createImportContainers()
  const exportContainers = createExportContainers()
  const vessel = createTutorialVessel(importContainers, Number.MAX_SAFE_INTEGER)

  importContainers.forEach((container, i) => {
    container.currentLocation.position = getVesselSlotPosition(vessel, i + 1)
  })

  return {
    state: {
      gamePhase: 'tutorial',
      simTime: 0,
      timeScale: DEFAULT_TIME_SCALE,
      tutorialStep: 2,
      tutorialCompleted: false,
      gatehouse: {
        exportLaneOpen: godModeEnabled,
        importLaneOpen: godModeEnabled,
      },
      money: 0,
      transactions: [],
      equipment: createTutorialEquipment(godModeEnabled),
      containers: [...importContainers, ...exportContainers],
      yardBlocks,
      vesselVisits: [vessel],
      truckVisits: [] as TruckVisit[],
      jobs: [] as Job[],
      selectedContainerId: null,
      selectedEquipmentId: null,
      selectedGatehouseId: null,
      events: [],
    },
  }
}

export function resetTutorialFlowFlags() {
  return {
    exportTrucksSent: 0,
    importTrucksSent: 0,
    dischargingStarted: false,
    loadingStarted: false,
    importPickupStarted: false,
    exportStagingStarted: false,
    tutorialOverlayDismissed: false,
  }
}
