import type { Container, Slot, ShipPreset } from '../types'
import { CONTAINER } from './config'
import { generateContainerId, generateWeight, getWeightCategory } from './containerFactory'

/**
 * The "local port" — all Import containers have this as their POD since they are
 * being discharged here. A single colour makes them visually distinct from export cargo.
 */
const LOCAL_PORT = { name: 'Local', color: 0xffd700, hex: '#ffd700', order: 0 } as const

/**
 * Generates `count` Import containers and places them into the grid.
 * Distribution strategy (per knowledge-base discharge sequencing):
 * - Spread across centre rows to keep initial load balanced.
 * - Fill lower tiers first (bottom-up stacking).
 * - Avoid packing all weight in one bay.
 * Returns the list of containers placed (useful for the store to track).
 */
export function generateDischargeManifest(
  count: number,
  preset: ShipPreset,
  grid: Record<string, Slot>
): Container[] {
  const placed: Container[] = []

  // Build an ordered list of preferred slot IDs: lower tiers first, centre rows first.
  const activeBays = preset.bays - preset.sternBlockedBays
  const centreRow = Math.floor(preset.rows / 2)

  // Row priority: centre outward
  const rowPriority: number[] = []
  for (let offset = 0; offset <= Math.floor(preset.rows / 2); offset++) {
    const mid = centreRow
    if (mid - offset >= 0) rowPriority.push(mid - offset)
    if (offset > 0 && mid + offset < preset.rows) rowPriority.push(mid + offset)
  }

  // Build slots tier-by-tier (tier 0 first), iterating rows by priority, bays spread evenly.
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

  let placedCount = 0
  for (const id of orderedIds) {
    if (placedCount >= count) break
    const slot = grid[id]
    if (!slot || slot.container) continue

    // Validate stacking: tier 0 can always be placed; higher tiers need container below.
    if (slot.tierIndex > 0) {
      const belowTierNum = slot.tier - 2
      const belowId = `${String(slot.bay).padStart(2, '0')}-${String(slot.row).padStart(2, '0')}-${String(belowTierNum).padStart(2, '0')}`
      if (!grid[belowId] || !grid[belowId].container) continue
    }

    const weight = Math.round(generateWeight() * 10) / 10

    // All import containers share the local port colour (POD = this terminal)
    const container: Container = {
      id: generateContainerId(),
      weight,
      weightCategory: getWeightCategory(weight),
      port: LOCAL_PORT.name,
      portColor: LOCAL_PORT.color,
      portHex: LOCAL_PORT.hex,
      portOrder: LOCAL_PORT.order,
      isHazmat: false,
      isImport: true,
    }

    slot.container = container
    placed.push(container)
    placedCount++
  }

  return placed
}

/**
 * Returns slot IDs that contain Import containers and are on top of their stack
 * (i.e. clickable for discharge — no container above them).
 */
export function getDischargeableSlots(grid: Record<string, Slot>, preset: ShipPreset): string[] {
  const dischargeable: string[] = []
  const activeBays = preset.bays - preset.sternBlockedBays

  for (let b = 0; b < activeBays; b++) {
    const bayNum = b * 2 + 1
    for (let r = 0; r < preset.rows; r++) {
      const rowNum = r + 1
      // Walk tiers from top down; the first occupied tier with an Import container that
      // has nothing above it is the top of the stack.
      for (let t = preset.tiers - 1; t >= 0; t--) {
        const tierNum = (t + 1) * 2
        const id = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(tierNum).padStart(2, '0')}`
        const slot = grid[id]
        if (!slot) continue

        if (slot.container && slot.container.isImport) {
          // Check nothing sits above this slot in the same stack
          const aboveTierNum = tierNum + 2
          const aboveId = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(aboveTierNum).padStart(2, '0')}`
          const aboveSlot = grid[aboveId]
          if (!aboveSlot || !aboveSlot.container) {
            dischargeable.push(id)
          }
          // Only expose the topmost import container per stack
          break
        }

        if (slot.container && !slot.container.isImport) {
          // Stack has a non-import container — no import accessible above this
          break
        }
      }
    }
  }

  return dischargeable
}

/** Returns the world Y position of the top surface of a container sitting in `slot`. */
export function getContainerTopY(slot: Slot, preset: ShipPreset): number {
  const deckY = preset.deckOffsetY ?? preset.height * 0.3
  return slot.yOffset + deckY + CONTAINER.size.y / 2
}
