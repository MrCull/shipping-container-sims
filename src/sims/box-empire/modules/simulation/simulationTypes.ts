import type { BoxEmpireState, GameEventType, TutorialStep } from '../../types'
import type { SimulationIndexes } from './simulationIndexes'

export interface TutorialFlowRuntime {
  exportTrucksSent: number
  importTrucksSent: number
  dischargingStarted: boolean
  loadingStarted: boolean
  importPickupStarted: boolean
  exportStagingStarted: boolean
  tutorialOverlayDismissed: boolean
}

export interface NarratorRuntime {
  vesselDockedFired: boolean
  craneEnabledFired: boolean
  firstOnQuayFired: boolean
  importsInYardFired: boolean
  dischargeCompletedFired: boolean
  trucksRollingFired: boolean
  firstGateOutMoneyFired: boolean
  exportToQuayFired: boolean
  outroFired: boolean
}

export interface SimulationCallbacks {
  emitEvent: (type: GameEventType, message: string, data?: Record<string, unknown>) => void
  enqueueNarratorGroup: (groupId: string) => void
  interruptWithNarratorGroup: (groupId: string) => void
  trackTutorialCompleted: (data: {
    import_departed: number
    export_loaded: number
    sim_time_seconds: number
    money: number
  }) => void
}

export interface SimulationTickContext {
  state: BoxEmpireState
  dt: number
  isGodMode: boolean
  tutorialSteps: TutorialStep[]
  flow: TutorialFlowRuntime
  narrator: NarratorRuntime
  callbacks: SimulationCallbacks
  indexes?: SimulationIndexes
}
