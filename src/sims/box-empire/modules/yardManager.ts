// ---------------------------------------------------------------------------
// Box Empire — Yard slot management
// ---------------------------------------------------------------------------

import type { YardBlock, YardSlot, YardSlotRef, Position3D } from '../types'
import { makeYardSlotId } from '../types'
import {
  CONTAINER_LENGTH,
  CONTAINER_WIDTH,
  CONTAINER_HEIGHT,
  CONTAINER_BAY_GAP,
  CONTAINER_ROW_GAP,
  CONTAINER_STACK_GAP_Y,
  TUTORIAL_YARD,
  YARD_BLOCK_POSITION,
} from './config'

export function createYardBlock(): YardBlock {
  const slots: YardSlot[] = []
  for (let bay = 1; bay <= TUTORIAL_YARD.bays; bay++) {
    for (let row = 1; row <= TUTORIAL_YARD.rows; row++) {
      for (let tier = 1; tier <= TUTORIAL_YARD.maxTier; tier++) {
        slots.push({
          blockId: TUTORIAL_YARD.id,
          bay,
          row,
          tier,
          containerId: null,
        })
      }
    }
  }
  return {
    id: TUTORIAL_YARD.id,
    type: 'mixed',
    bays: TUTORIAL_YARD.bays,
    rows: TUTORIAL_YARD.rows,
    maxTier: TUTORIAL_YARD.maxTier,
    slots,
    position: { ...YARD_BLOCK_POSITION },
  }
}

export function findAvailableSlot(
  block: YardBlock,
  reservedSlotIds?: Set<string>,
  preferredVisitType?: 'import' | 'export',
  containers?: import('../types').Container[],
): YardSlotRef | null {
  function trySlotInBay(bay: number, row: number): YardSlotRef | null {
    const tiersInStack = block.slots.filter(
      s => s.bay === bay && s.row === row && s.containerId !== null,
    ).length
    if (tiersInStack >= block.maxTier) return null
    const candidate: YardSlotRef = {
      blockId: block.id,
      bay,
      row,
      tier: tiersInStack + 1,
    }
    const slotId = makeYardSlotId(candidate.blockId, candidate.bay, candidate.row, candidate.tier)
    if (reservedSlotIds && reservedSlotIds.has(slotId)) return null
    return candidate
  }

  function bayHasContainerOfType(bay: number, visitType: 'import' | 'export'): boolean {
    if (!containers) return false
    const containerIdsInBay = block.slots
      .filter(s => s.bay === bay && s.containerId !== null)
      .map(s => s.containerId as string)
    return containerIdsInBay.some(cid => {
      const c = containers.find(co => co.id === cid)
      return c?.visitType === visitType
    })
  }

  function bayHasAnyContainer(bay: number): boolean {
    return block.slots.some(s => s.bay === bay && s.containerId !== null)
  }

  if (preferredVisitType && containers) {
    // Pass 1: empty bays — spread containers out so each is accessible without unstuffing
    for (let bay = 1; bay <= block.bays; bay++) {
      if (!bayHasAnyContainer(bay)) {
        for (let row = 1; row <= block.rows; row++) {
          const slot = trySlotInBay(bay, row)
          if (slot) return slot
        }
      }
    }

    // Pass 2: bays that already have the same type (stack only when no empty bays remain)
    for (let bay = 1; bay <= block.bays; bay++) {
      if (bayHasContainerOfType(bay, preferredVisitType)) {
        for (let row = 1; row <= block.rows; row++) {
          const slot = trySlotInBay(bay, row)
          if (slot) return slot
        }
      }
    }

    // Pass 3: fall through to any available
  }

  for (let bay = 1; bay <= block.bays; bay++) {
    for (let row = 1; row <= block.rows; row++) {
      const slot = trySlotInBay(bay, row)
      if (slot) return slot
    }
  }
  return null
}

export function placeContainerInSlot(
  block: YardBlock,
  ref: YardSlotRef,
  containerId: string,
): void {
  const slot = block.slots.find(
    s => s.bay === ref.bay && s.row === ref.row && s.tier === ref.tier,
  )
  if (slot) slot.containerId = containerId
}

export function removeContainerFromSlot(
  block: YardBlock,
  containerId: string,
): YardSlotRef | null {
  const slot = block.slots.find(s => s.containerId === containerId)
  if (!slot) return null
  const ref: YardSlotRef = {
    blockId: slot.blockId,
    bay: slot.bay,
    row: slot.row,
    tier: slot.tier,
  }
  slot.containerId = null
  return ref
}

export function getSlotWorldPosition(
  block: YardBlock,
  ref: YardSlotRef,
): Position3D {
  const bayOffset = (ref.bay - 1) * (CONTAINER_LENGTH + CONTAINER_BAY_GAP)
  const rowOffset = (ref.row - 1) * (CONTAINER_WIDTH + CONTAINER_ROW_GAP)
  const tierOffset = (ref.tier - 1) * (CONTAINER_HEIGHT + CONTAINER_STACK_GAP_Y)

  return {
    x: block.position.x + bayOffset,
    y: tierOffset + CONTAINER_HEIGHT / 2,
    z: block.position.z + rowOffset,
  }
}

export function getYardOccupancy(block: YardBlock): number {
  const total = block.bays * block.rows * block.maxTier
  const filled = block.slots.filter(s => s.containerId !== null).length
  return total > 0 ? filled / total : 0
}

export function isContainerOnTop(block: YardBlock, containerId: string): boolean {
  const slot = block.slots.find(s => s.containerId === containerId)
  if (!slot) return false
  const above = block.slots.find(
    s => s.bay === slot.bay && s.row === slot.row && s.tier === slot.tier + 1 && s.containerId !== null,
  )
  return !above
}
