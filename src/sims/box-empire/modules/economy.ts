// ---------------------------------------------------------------------------
// Box Empire — Economy / revenue tracking
// ---------------------------------------------------------------------------

import type { Transaction, TransactionType } from '../types'
import { GATE_OUT_REVENUE, VESSEL_LOAD_REVENUE } from './config'

let txCounter = 0

export function createTransaction(
  type: TransactionType,
  containerId: string,
  simTime: number,
): Transaction {
  txCounter++
  const amount = type === 'gate_out_revenue' ? GATE_OUT_REVENUE : VESSEL_LOAD_REVENUE
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
