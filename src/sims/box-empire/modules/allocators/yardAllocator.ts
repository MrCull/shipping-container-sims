import type { Container, Job, YardBlock, YardSlotRef } from '../../types'
import { makeYardSlotId, parseYardSlotId } from '../../types'
import { findAvailableSlot, getSlotWorldPosition, makeYardStackKey } from '../yardManager'

function isActiveMove(job: Job): boolean {
  return job.status === 'assigned' || job.status === 'in_progress'
}

export function getReservedYardSlotIds(jobs: Job[]): Set<string> {
  const reserved = new Set<string>()
  for (const job of jobs) {
    if (job.status !== 'pending' && job.status !== 'assigned' && job.status !== 'in_progress') continue
    if (job.dropoffLocation.type !== 'yard_slot') continue
    reserved.add(job.dropoffLocation.id)
  }
  return reserved
}

export function getOutboundYardStackKeys(jobs: Job[]): Set<string> {
  const blocked = new Set<string>()
  for (const job of jobs) {
    if (!isActiveMove(job)) continue
    if (job.pickupLocation.type !== 'yard_slot') continue
    if (job.dropoffLocation.type === 'yard_slot') continue
    const slot = parseYardSlotId(job.pickupLocation.id)
    if (!slot) continue
    blocked.add(makeYardStackKey(slot.blockId, slot.bay, slot.row))
  }
  return blocked
}

export function allocateYardSlot(
  yard: YardBlock | undefined,
  jobs: Job[],
  visitType: 'import' | 'export',
  containers: Container[],
): YardSlotRef | null {
  if (!yard) return null
  return findAvailableSlot(yard, getReservedYardSlotIds(jobs), visitType, containers, getOutboundYardStackKeys(jobs))
}

export function findShuffleTargetSlot(
  yard: YardBlock,
  source: YardSlotRef,
  jobs: Job[],
): YardSlotRef | null {
  const reserved = getReservedYardSlotIds(jobs)
  const blockedStacks = getOutboundYardStackKeys(jobs)
  for (let bay = 1; bay <= yard.bays; bay++) {
    if (bay === source.bay) continue
    for (let row = 1; row <= yard.rows; row++) {
      if (blockedStacks.has(makeYardStackKey(yard.id, bay, row))) continue
      const tiersOccupied = yard.slots.filter(
        slot => slot.bay === bay && slot.row === row && slot.containerId !== null,
      ).length
      if (tiersOccupied >= yard.maxTier) continue
      const candidate: YardSlotRef = {
        blockId: yard.id,
        bay,
        row,
        tier: tiersOccupied + 1,
      }
      const slotId = makeYardSlotId(candidate.blockId, candidate.bay, candidate.row, candidate.tier)
      if (!reserved.has(slotId)) return candidate
    }
  }
  return null
}

export function yardSlotLocation(yard: YardBlock, slot: YardSlotRef) {
  const id = makeYardSlotId(slot.blockId, slot.bay, slot.row, slot.tier)
  return {
    type: 'yard_slot' as const,
    id,
    position: getSlotWorldPosition(yard, slot),
  }
}
