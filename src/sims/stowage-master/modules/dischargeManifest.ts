import type { Container, Slot, ShipPreset } from '../types'
import { CONTAINER, PORTS } from './config'
import { generateContainerId, generateWeight, getWeightCategory } from './containerFactory'

/**
 * The "local port" — Import containers discharged here.
 * Gold colour makes them visually distinct from transit/export cargo.
 */
const LOCAL_PORT = { name: 'Local', color: 0xffd700, hex: '#ffd700', order: 0 } as const

/** Future ports used for transit containers. Skip index 0 (Local). */
const TRANSIT_PORTS = PORTS.slice(1)

function makeImportContainer(): Container {
  const weight = Math.round(generateWeight() * 10) / 10
  return {
    id: generateContainerId(),
    weight,
    weightCategory: getWeightCategory(weight),
    port: LOCAL_PORT.name,
    portColor: LOCAL_PORT.color,
    portHex: LOCAL_PORT.hex,
    portOrder: LOCAL_PORT.order,
    isHazmat: false,
    isImport: true,
    isTransit: false,
  }
}

function makeTransitContainer(): Container {
  const weight = Math.round(generateWeight() * 10) / 10
  const port = TRANSIT_PORTS[Math.floor(Math.random() * TRANSIT_PORTS.length)]
  return {
    id: generateContainerId(),
    weight,
    weightCategory: getWeightCategory(weight),
    port: port.name,
    portColor: port.color,
    portHex: port.hex,
    portOrder: port.order,
    isHazmat: false,
    isImport: false,
    isTransit: true,
  }
}

/**
 * Builds an ordered list of slot IDs: lower tiers first, centre rows first.
 */
function buildOrderedSlotIds(preset: ShipPreset, grid: Record<string, Slot>): string[] {
  const activeBays = preset.bays - preset.sternBlockedBays
  const centreRow = Math.floor(preset.rows / 2)

  const rowPriority: number[] = []
  for (let offset = 0; offset <= Math.floor(preset.rows / 2); offset++) {
    if (centreRow - offset >= 0) rowPriority.push(centreRow - offset)
    if (offset > 0 && centreRow + offset < preset.rows) rowPriority.push(centreRow + offset)
  }

  const orderedIds: string[] = []
  for (let t = 0; t < preset.tiers; t++) {
    const tierNum = (t + 1) * 2
    for (const r of rowPriority) {
      const rowNum = r + 1
      for (let b = 0; b < activeBays; b++) {
        const bayNum = b * 2 + 1
        const id = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(tierNum).padStart(2, '0')}`
        if (grid[id]) orderedIds.push(id)
      }
    }
  }
  return orderedIds
}

function canPlace(slotId: string, grid: Record<string, Slot>): boolean {
  const slot = grid[slotId]
  if (!slot || slot.container) return false
  if (slot.tierIndex === 0) return true
  const belowTierNum = slot.tier - 2
  const belowId = `${String(slot.bay).padStart(2, '0')}-${String(slot.row).padStart(2, '0')}-${String(belowTierNum).padStart(2, '0')}`
  return !!(grid[belowId]?.container)
}

/**
 * Generates Import and (optionally) Transit containers and places them into the grid.
 *
 * Import containers (gold) — discharged at this port.
 * Transit containers (port-coloured) — stay on board, but may be stacked on top of
 * Import containers creating "overstow" that the player must restow.
 *
 * Strategy:
 * 1. Place imports in lower tiers first, spread across bays/rows.
 * 2. Place transit containers in remaining slots — deliberately placing some directly
 *    on top of import stacks to create mandatory restow situations.
 */
export function generateDischargeManifest(
  count: number,
  preset: ShipPreset,
  grid: Record<string, Slot>,
  transitCount: number = 0
): Container[] {
  const placed: Container[] = []
  const orderedIds = buildOrderedSlotIds(preset, grid)

  // 1 — Place import containers (lower tiers first)
  let importPlaced = 0
  for (const id of orderedIds) {
    if (importPlaced >= count) break
    if (!canPlace(id, grid)) continue
    const container = makeImportContainer()
    grid[id].container = container
    placed.push(container)
    importPlaced++
  }

  if (transitCount <= 0) return placed

  // 2 — Place transit containers.
  // First attempt: stack directly on top of import containers to create overstow.
  // Then fill remaining free slots if more transit needed.
  const transitSlots: string[] = []

  // Priority A: slots immediately above an import container (guaranteed overstow)
  for (const id of orderedIds) {
    const slot = grid[id]
    if (!slot?.container?.isImport) continue
    const aboveTierNum = slot.tier + 2
    const aboveId = `${String(slot.bay).padStart(2, '0')}-${String(slot.row).padStart(2, '0')}-${String(aboveTierNum).padStart(2, '0')}`
    if (grid[aboveId] && !grid[aboveId].container) {
      transitSlots.push(aboveId)
    }
  }

  // Priority B: any other free slots (transit not blocking anything)
  for (const id of orderedIds) {
    if (!grid[id] || grid[id].container) continue
    if (!transitSlots.includes(id)) transitSlots.push(id)
  }

  let transitPlaced = 0
  for (const id of transitSlots) {
    if (transitPlaced >= transitCount) break
    if (!canPlace(id, grid)) continue
    const container = makeTransitContainer()
    grid[id].container = container
    placed.push(container)
    transitPlaced++
  }

  return placed
}

/**
 * Returns slot IDs that are actionable during the discharge phase:
 * - Import containers that are on top of their stack (ready to discharge).
 * - Transit containers that are on top of their stack AND sit directly above an import
 *   container (must be restowed to expose the import below).
 */
export function getDischargeableSlots(grid: Record<string, Slot>, preset: ShipPreset): string[] {
  const actionable: string[] = []
  const activeBays = preset.bays - preset.sternBlockedBays

  for (let b = 0; b < activeBays; b++) {
    const bayNum = b * 2 + 1
    for (let r = 0; r < preset.rows; r++) {
      const rowNum = r + 1
      // Walk from top tier downward to find the topmost occupied slot in this stack.
      for (let t = preset.tiers - 1; t >= 0; t--) {
        const tierNum = (t + 1) * 2
        const id = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(tierNum).padStart(2, '0')}`
        const slot = grid[id]
        if (!slot?.container) continue

        const container = slot.container

        if (container.isImport) {
          // Top of stack — ready to discharge
          actionable.push(id)
          break
        }

        if (container.isTransit) {
          // Transit container at top of stack — check if it sits above an import
          const belowTierNum = tierNum - 2
          const belowId = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(belowTierNum).padStart(2, '0')}`
          const belowSlot = grid[belowId]
          if (belowSlot?.container?.isImport) {
            // This transit container is an overstow — must be restowed
            actionable.push(id)
          }
          break
        }

        // Any other container (non-import, non-transit) — skip this stack
        break
      }
    }
  }

  return actionable
}

/**
 * Returns the slot IDs that are valid restow destinations for a transit container.
 * A slot is valid if: empty, stackable (support below), and not in the same bay/row
 * as a local import (to avoid creating new overstow situations).
 */
export function getRestowSlots(
  grid: Record<string, Slot>,
  preset: ShipPreset,
  excludeSlotId: string
): string[] {
  const valid: string[] = []
  const activeBays = preset.bays - preset.sternBlockedBays

  // Parse the excluded slot so we can also exclude the slot directly above it
  const excludeParts = excludeSlotId.split('-')
  const excludeBay = excludeParts[0]
  const excludeRow = excludeParts[1]
  const excludeTier = parseInt(excludeParts[2])
  const slotAboveExcluded = `${excludeBay}-${excludeRow}-${String(excludeTier + 2).padStart(2, '0')}`

  for (let b = 0; b < activeBays; b++) {
    const bayNum = b * 2 + 1
    for (let r = 0; r < preset.rows; r++) {
      const rowNum = r + 1
      for (let t = 0; t < preset.tiers; t++) {
        const tierNum = (t + 1) * 2
        const id = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(tierNum).padStart(2, '0')}`
        // Exclude the container's own slot and the slot directly above it
        if (id === excludeSlotId || id === slotAboveExcluded) continue
        const slot = grid[id]
        if (!slot || slot.container) continue

        // Must have support below (or be ground tier)
        if (t > 0) {
          const belowTierNum = tierNum - 2
          const belowId = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(belowTierNum).padStart(2, '0')}`
          if (!grid[belowId]?.container) continue
        }

        // Avoid placing transit directly above an import (no new overstow)
        if (t > 0) {
          const belowTierNum = tierNum - 2
          const belowId = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(belowTierNum).padStart(2, '0')}`
          if (grid[belowId]?.container?.isImport) continue
        }

        valid.push(id)
        break // Only expose lowest free slot per stack
      }
    }
  }

  return valid
}

/** Returns the world Y position of the top surface of a container sitting in `slot`. */
export function getContainerTopY(slot: Slot, preset: ShipPreset): number {
  const deckY = preset.deckOffsetY ?? preset.height * 0.3
  return slot.yOffset + deckY + CONTAINER.size.y / 2
}
