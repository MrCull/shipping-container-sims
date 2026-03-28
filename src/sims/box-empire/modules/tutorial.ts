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
      id: 'accept-vessel',
      stepNumber: 2,
      prompt: "A vessel has been announced: Tiny Feeder — inbound with 5 import containers and ready to load 5 exports. Accept the vessel call to bring her in.",
      condition: (s: BoxEmpireState) => {
        const vessel = s.vesselVisits[0]
        return !!vessel && vessel.state !== 'announced'
      },
    },
    {
      id: 'vessel-arriving',
      stepNumber: 3,
      prompt: 'The vessel is on its way. The crane will begin discharging as soon as she berths.',
      condition: (s: BoxEmpireState) => {
        const discharged = s.containers.filter(
          c =>
            c.visitType === 'import' &&
            (c.lifecycleState === 'discharged_to_buffer' ||
              c.lifecycleState === 'in_yard' ||
              c.lifecycleState === 'departed'),
        )
        return discharged.length >= 1
      },
    },
    {
      id: 'open-gate',
      stepNumber: 4,
      prompt: 'First container is on the quay! Open the gatehouse — export trucks with containers are waiting outside, and import pickup trucks are ready to collect.',
      condition: (s: BoxEmpireState) => s.gatehouse.exportLaneOpen && s.gatehouse.importLaneOpen,
    },
    {
      id: 'trucks-arriving',
      stepNumber: 5,
      prompt: 'Trucks are rolling in! The reach stacker handles export deliveries into the yard and loads import pickups onto trucks.',
      condition: (s: BoxEmpireState) => {
        const exportInYard = s.containers.filter(
          c => c.visitType === 'export' && c.lifecycleState === 'in_yard',
        )
        return exportInYard.length >= 5
      },
    },
    {
      id: 'discharging',
      stepNumber: 6,
      prompt: 'The mobile harbor crane is discharging containers from the vessel. Once complete it will load your exports.',
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
      prompt: 'Import trucks are collecting containers and heading out. Each gate-out earns $100!',
      condition: (s: BoxEmpireState) => {
        const importDone = s.containers.filter(
          c =>
            c.visitType === 'import' &&
            (c.lifecycleState === 'departed' || c.lifecycleState === 'at_gate'),
        )
        const gateOutRevenue = s.transactions.filter(
          t => t.type === 'gate_out_revenue',
        ).length
        return importDone.length >= 5 || gateOutRevenue >= 5
      },
    },
    {
      id: 'loading',
      stepNumber: 8,
      prompt: 'Export containers are being loaded onto the vessel. Each load earns $150!',
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
