/**
 * SHC operational states (TT-R11): a coarse, dispatch-oriented view of the
 * existing `ShcStatus` values. Statuses are not renamed; each maps to exactly
 * one of seven states, used by the inspector, the dashboard and the KPIs.
 *
 * A status names the last phase event that fired, so the SHC is already doing
 * the NEXT phase: `routing-empty` (the empty drive is over) means it is
 * positioning at the pickup, `lifting` (the box is picked) means it is about to
 * drive loaded. The table below maps what the SHC is doing, not the label.
 * `queuing-to-deliver` (TT-R12): a loaded SHC resting at a block queue spot (`queuing-for-pad`) or choosing a pad there;
 * an empty SHC resting at a queue spot waiting for work (`queuing-for-work`) is `queuing-to-collect`.
 */
import type { ShcState, ShcStatus } from './state'

export const SHC_OPERATIONAL_STATES = [
  'parked',
  'moving-to-collect',
  'queuing-to-collect',
  'collecting',
  'moving-to-deliver',
  'queuing-to-deliver',
  'delivering',
] as const

export type ShcOperationalState = (typeof SHC_OPERATIONAL_STATES)[number]

/** Every SHC status (the type's members, so a new status fails the compiler until it is mapped). */
const STATUS_STATE: Record<ShcStatus, ShcOperationalState> = {
  parked: 'parked',
  'waiting-for-dispatch': 'parked',
  available: 'parked',
  'waiting-for-pad': 'queuing-to-collect',
  'job-assigned': 'moving-to-collect',
  'routing-to-parking': 'moving-to-collect',
  'queuing-for-pad': 'queuing-to-deliver',
  'queuing-for-work': 'queuing-to-collect',
  'routing-empty': 'collecting',
  'positioning-at-pickup': 'collecting',
  locking: 'collecting',
  lifting: 'moving-to-deliver',
  'routing-loaded': 'delivering',
  'positioning-at-dropoff': 'delivering',
  lowering: 'delivering',
  unlocking: 'delivering',
  clearing: 'delivering',
}

export const SHC_STATUSES = Object.keys(STATUS_STATE) as ShcStatus[]

/**
 * The operational state of an SHC at sim time `now`. An assigned SHC whose
 * trip has not started (its conflict zones are reserved later) is queuing.
 */
export function shcOperationalState(shc: Pick<ShcState, 'status' | 'motion'> & { carrying?: string | null }, now: number): ShcOperationalState {
  if (shc.status === 'job-assigned') {
    const departs = shc.motion.reduce((m, s) => Math.min(m, s.t0), Infinity)
    if (shc.motion.length > 0 && now < departs) return 'queuing-to-collect'
  }
  if (shc.status === 'waiting-for-pad' && shc.carrying) return 'queuing-to-deliver' // asking for a pad at the queue spot
  return STATUS_STATE[shc.status]
}
