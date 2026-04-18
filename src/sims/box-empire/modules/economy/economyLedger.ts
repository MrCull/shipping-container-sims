import type { BoxEmpireState, Container, Equipment, GameEventType, Job, Position3D } from '../../types'
import {
  GATE_OUT_REVENUE,
  QUAY_CRANE_IMPORT_UNLOAD_COST,
  REACH_STACKER_MOVE_COST,
  UNPROCESSED_IMPORT_FINE,
  VESSEL_LOAD_REVENUE,
} from '../config'
import { createTransaction } from '../economy'

export interface DomainEventPayload {
  type: GameEventType
  message: string
  data?: Record<string, unknown>
}

function pushTransaction(state: BoxEmpireState, tx: ReturnType<typeof createTransaction>): void {
  state.transactions.push(tx)
  state.money += tx.amount
}

export function applyGateOutRevenue(
  state: BoxEmpireState,
  container: Container,
  position: Position3D,
): DomainEventPayload {
  const tx = createTransaction('gate_out_revenue', container.id, state.simTime)
  pushTransaction(state, tx)
  container.revenueEarned += tx.amount
  return {
    type: 'money.earned',
    message: `+$${GATE_OUT_REVENUE} - import container gate-out`,
    data: {
      amount: GATE_OUT_REVENUE,
      position: { ...position },
    },
  }
}

export function applyVesselLoadRevenue(
  state: BoxEmpireState,
  container: Container,
  position: Position3D,
): DomainEventPayload {
  const tx = createTransaction('vessel_load_revenue', container.id, state.simTime)
  pushTransaction(state, tx)
  container.revenueEarned += tx.amount
  return {
    type: 'money.earned',
    message: `+$${VESSEL_LOAD_REVENUE} - export container loaded on vessel`,
    data: {
      amount: VESSEL_LOAD_REVENUE,
      position: { ...position },
    },
  }
}

export function applyReachStackerMoveCost(
  state: BoxEmpireState,
  job: Job,
  eq: Equipment,
  isGodMode: boolean,
): DomainEventPayload | null {
  if (eq.type !== 'reach_stacker') return null
  if (isGodMode) return null

  const tx = createTransaction('reach_stacker_move_cost', job.containerId, state.simTime)
  pushTransaction(state, tx)
  return {
    type: 'money.spent',
    message: `-$${REACH_STACKER_MOVE_COST} - reach stacker move cost`,
    data: {
      amount: REACH_STACKER_MOVE_COST,
      position: { ...job.dropoffLocation.position },
    },
  }
}

export function applyQuayCraneImportUnloadCost(
  state: BoxEmpireState,
  job: Job,
  eq: Equipment,
  isGodMode: boolean,
): DomainEventPayload | null {
  if (eq.type !== 'mobile_harbor_crane') return null
  if (job.pickupLocation.type !== 'vessel_slot') return null
  if (job.dropoffLocation.type !== 'quay_buffer') return null
  if (isGodMode) return null

  const tx = createTransaction('quay_crane_import_unload_cost', job.containerId, state.simTime)
  pushTransaction(state, tx)
  return {
    type: 'money.spent',
    message: `-$${QUAY_CRANE_IMPORT_UNLOAD_COST} - quay crane import unload cost`,
    data: {
      amount: QUAY_CRANE_IMPORT_UNLOAD_COST,
      position: { ...job.dropoffLocation.position },
    },
  }
}

export function applyUnprocessedImportFine(
  state: BoxEmpireState,
  container: Container,
  position: Position3D,
): DomainEventPayload {
  const tx = createTransaction('unprocessed_import_fine', container.id, state.simTime)
  pushTransaction(state, tx)
  return {
    type: 'money.spent',
    message: `-$${UNPROCESSED_IMPORT_FINE} - import left on departing vessel`,
    data: {
      amount: UNPROCESSED_IMPORT_FINE,
      position: { ...position },
    },
  }
}
