/**
 * Invariant checker. When enabled, the engine runs every invariant after
 * every processed event; a violation is logged as an `InvariantViolated`
 * event caused by the offending event and, in fail-fast mode, stops the run.
 *
 * Add an invariant: append to INVARIANTS with a stable dotted id. When a
 * ticket adds a new custody owner kind, extend `custodyHolders`.
 */
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
  return holders
}

export const INVARIANTS: Invariant[] = [
  {
    id: 'custody.single-owner',
    description:
      'Every container is held by exactly one custody owner, and that owner is the one the container records.',
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
          messages.push(`container ${box.id} records custody ${recorded} but is held by ${held}`)
        }
      }
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
