// ---------------------------------------------------------------------------
// Box Empire — Tutorial step definitions
// ---------------------------------------------------------------------------

import type { TutorialStep, BoxEmpireState } from '../types'

export function createTutorialSteps(): TutorialStep[] {
  return [
    {
      id: 'welcome',
      stepNumber: 1,
      prompt: "Welcome to Box Empire! You're the manager of this small container terminal.",
      condition: () => false,
    },
    {
      id: 'yard-intro',
      stepNumber: 2,
      prompt: 'This is your yard — containers are stored here in stacks.',
      condition: () => false,
    },
    {
      id: 'open-gate',
      stepNumber: 3,
      prompt: "Click 'Open Gatehouse' to allow trucks carrying export containers to enter.",
      condition: (s: BoxEmpireState) => s.gatehouseOpen,
    },
    {
      id: 'trucks-arriving',
      stepNumber: 4,
      prompt: 'Trucks are arriving! Watch as the reach stacker unloads them into the yard.',
      condition: (s: BoxEmpireState) => {
        const exportInYard = s.containers.filter(
          c => c.visitType === 'export' && c.lifecycleState === 'in_yard',
        )
        return exportInYard.length >= 5
      },
    },
    {
      id: 'vessel-arriving',
      stepNumber: 5,
      prompt: "A vessel has been announced! It's approaching the berth with 5 import containers.",
      condition: (s: BoxEmpireState) => {
        const vessel = s.vesselVisits[0]
        return !!vessel && (vessel.state === 'arrived' || vessel.state === 'discharging')
      },
    },
    {
      id: 'discharging',
      stepNumber: 6,
      prompt: 'The mobile harbor crane is discharging containers from the vessel.',
      condition: (s: BoxEmpireState) => {
        const importProcessed = s.containers.filter(
          c =>
            c.visitType === 'import' &&
            (c.lifecycleState === 'in_yard' || c.lifecycleState === 'departed'),
        )
        return importProcessed.length >= 5
      },
    },
    {
      id: 'gate-out',
      stepNumber: 7,
      prompt: 'Trucks are arriving to collect the import containers. Each gate-out earns $100!',
      condition: (s: BoxEmpireState) => {
        const importDeparted = s.containers.filter(
          c => c.visitType === 'import' && c.lifecycleState === 'departed',
        )
        return importDeparted.length >= 5
      },
    },
    {
      id: 'loading',
      stepNumber: 8,
      prompt: 'Now the export containers are being loaded onto the vessel. Each load earns $150!',
      condition: (s: BoxEmpireState) => {
        const exportLoaded = s.containers.filter(
          c => c.visitType === 'export' && c.lifecycleState === 'loaded_on_vessel',
        )
        const vessel = s.vesselVisits[0]
        return exportLoaded.length >= 5 && !!vessel && vessel.state === 'departed'
      },
    },
  ]
}

export function getCurrentStep(
  steps: TutorialStep[],
  stepNumber: number,
): TutorialStep | null {
  return steps.find(s => s.stepNumber === stepNumber) ?? null
}

export function checkStepAdvance(
  step: TutorialStep,
  state: BoxEmpireState,
): boolean {
  return step.condition(state)
}
