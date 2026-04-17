import type { Container, Job, YardBlock, YardSlotRef } from '../../types'
import { makeYardSlotId } from '../../types'
import { findAvailableSlot, getSlotWorldPosition } from '../yardManager'

export function getReservedYardSlotIds(jobs: Job[]): Set<string> {
  const reserved = new Set<string>()
  for (const job of jobs) {
    if (job.status !== 'pending' && job.status !== 'assigned' && job.status !== 'in_progress') continue
    if (job.dropoffLocation.type !== 'yard_slot') continue
    reserved.add(job.dropoffLocation.id)
  }
  return reserved
}

export function allocateYardSlot(
  yard: YardBlock | undefined,
  jobs: Job[],
  visitType: 'import' | 'export',
  containers: Container[],
): YardSlotRef | null {
  if (!yard) return null
  return findAvailableSlot(yard, getReservedYardSlotIds(jobs), visitType, containers)
}

export function findShuffleTargetSlot(
  yard: YardBlock,
  source: YardSlotRef,
  jobs: Job[],
): YardSlotRef | null {
  const reserved = getReservedYardSlotIds(jobs)
  for (let bay = 1; bay <= yard.bays; bay++) {
    if (bay === source.bay) continue
    for (let row = 1; row <= yard.rows; row++) {
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
