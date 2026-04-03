// ---------------------------------------------------------------------------
// Box Empire — Economy / revenue tracking
// ---------------------------------------------------------------------------

import type { Transaction, TransactionType } from '../types'
import {
  GATE_OUT_REVENUE,
  VESSEL_LOAD_REVENUE,
  REACH_STACKER_MOVE_COST,
  QUAY_CRANE_IMPORT_UNLOAD_COST,
} from './config'

let txCounter = 0

export function createTransaction(
  type: TransactionType,
  containerId: string,
  simTime: number,
): Transaction {
  txCounter++
  let amount = VESSEL_LOAD_REVENUE
  if (type === 'gate_out_revenue') amount = GATE_OUT_REVENUE
  if (type === 'reach_stacker_move_cost') amount = -REACH_STACKER_MOVE_COST
  if (type === 'quay_crane_import_unload_cost') amount = -QUAY_CRANE_IMPORT_UNLOAD_COST
  return {
    id: `tx-${txCounter}`,
    type,
    amount,
    containerId,
    simTime,
  }
}

export function calculateBalance(transactions: Transaction[]): number {
  return transactions.reduce((sum, tx) => sum + tx.amount, 0)
}

export function resetEconomy(): void {
  txCounter = 0
}
