/**
 * Invariant checker. When enabled, the engine runs every invariant after
 * every processed event; a violation is logged as an `InvariantViolated`
 * event caused by the offending event and, in fail-fast mode, stops the run.
 *
 * Add an invariant: append to INVARIANTS with a stable dotted id. When a
 * ticket adds a new custody owner kind, extend `custodyHolders`.
 */
import { overlappingReservations } from './reservations'
import type { CustodyRef, SimState } from './state'

export interface InvariantViolation {
  invariant: string
  message: string
  /** Offending event (set by the engine). */
  eventId?: number
  t?: number
}

export interface Invariant {
  id: string
  description: string
  /** Returns one message per violation (empty = holds). */
  check(state: SimState): string[]
}

const refKey = (r: CustodyRef) => `${r.kind}:${r.id}`

/** Every place that physically holds a container, with what it holds. */
function custodyHolders(state: SimState): { owner: CustodyRef; containerId: string }[] {
  const holders: { owner: CustodyRef; containerId: string }[] = []
  for (const s of Object.values(state.vesselSlots))
    if (s.containerId) holders.push({ owner: { kind: 'vesselSlot', id: s.id }, containerId: s.containerId })
  for (const s of Object.values(state.sts))
    if (s.carrying) holders.push({ owner: { kind: 'sts', id: s.id }, containerId: s.carrying })
  for (const g of Object.values(state.groundPositions))
    if (g.containerId) holders.push({ owner: { kind: 'groundPosition', id: g.id }, containerId: g.containerId })
  for (const s of Object.values(state.shcs))
    if (s.carrying) holders.push({ owner: { kind: 'shc', id: s.id }, containerId: s.carrying })
  for (const p of Object.values(state.wtpPads))
    if (p.containerId) holders.push({ owner: { kind: 'wtpPad', id: p.id }, containerId: p.containerId })
  for (const a of Object.values(state.ascs))
    if (a.carrying) holders.push({ owner: { kind: 'asc', id: a.id }, containerId: a.carrying })
  for (const y of Object.values(state.yardSlots))
    if (y.containerId) holders.push({ owner: { kind: 'yardSlot', id: y.id }, containerId: y.containerId })
  return holders
}

/** The box a ground position or WTP pad currently holds. */
function placeHolder(state: SimState, ref: CustodyRef): string | null {
  if (ref.kind === 'groundPosition') return state.groundPositions[ref.id]?.containerId ?? null
  if (ref.kind === 'wtpPad') return state.wtpPads[ref.id]?.containerId ?? null
  return null
}

export const INVARIANTS: Invariant[] = [
  {
    id: 'custody.single-owner',
    description:
      'Every container is held by exactly one custody owner, and that owner is the one the container records. ' +
      'This also catches a double-occupied ground position or WTP pad: a place holds one box, so the box set down second displaces the first.',
    check(state) {
      const messages: string[] = []
      const heldBy = new Map<string, string[]>()
      for (const h of custodyHolders(state)) {
        if (!state.containers[h.containerId]) {
          messages.push(`${refKey(h.owner)} holds unknown container ${h.containerId}`)
          continue
        }
        const list = heldBy.get(h.containerId) ?? []
        list.push(refKey(h.owner))
        heldBy.set(h.containerId, list)
      }
      for (const box of Object.values(state.containers)) {
        const owners = heldBy.get(box.id) ?? []
        const recorded = refKey(box.custody)
        if (owners.length !== 1 || owners[0] !== recorded) {
          const held = owners.length ? owners.join(', ') : 'nobody'
          const other = placeHolder(state, box.custody)
          const why = other && other !== box.id ? ` (${recorded} is double-occupied: ${other} was set down on it)` : ''
          messages.push(`container ${box.id} records custody ${recorded} but is held by ${held}${why}`)
        }
      }
      return messages
    },
  },
  {
    id: 'reservation.no-overlap',
    description: 'No two conflict-zone reservations overlap in time.',
    check(state) {
      return overlappingReservations(state.reservations).map(
        ([a, b]) =>
          `zone ${a.zone}: ${a.holder} [${a.from.toFixed(3)}, ${a.to.toFixed(3)}) overlaps ${b.holder} [${b.from.toFixed(3)}, ${b.to.toFixed(3)})`,
      )
    },
  },
  {
    id: 'claim.single-holder',
    description: 'No container is claimed by two SHCs at once, and every claimed job names its SHC.',
    check(state) {
      const messages: string[] = []
      const claims = new Map<string, string[]>()
      for (const shc of Object.values(state.shcs)) {
        if (!shc.jobId) continue
        const job = state.shcJobs[shc.jobId]
        if (!job) {
          messages.push(`${shc.id} claims unknown job ${shc.jobId}`)
          continue
        }
        if (job.shcId !== shc.id) messages.push(`${shc.id} claims job ${job.id}, which names ${job.shcId ?? 'no SHC'}`)
        claims.set(job.containerId, [...(claims.get(job.containerId) ?? []), shc.id])
      }
      for (const [containerId, holders] of claims)
        if (holders.length > 1) messages.push(`container ${containerId} is claimed by ${holders.join(', ')}`)
      return messages
    },
  },
]

export function checkInvariants(state: SimState): InvariantViolation[] {
  const violations: InvariantViolation[] = []
  for (const inv of INVARIANTS)
    for (const message of inv.check(state)) violations.push({ invariant: inv.id, message })
  return violations
}
