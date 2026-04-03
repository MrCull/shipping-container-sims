import type {
  Container,
  Slot,
  ShipPreset,
  ImportPlacementMode,
  TransitGroupingMode,
} from '../types'
import { CONTAINER, PORTS } from './config'
import { generateContainerId, generateWeight, getWeightCategory } from './containerFactory'

/**
 * The "local port" — Import containers discharged here.
 * Gold colour makes them visually distinct from transit/export cargo.
 */
const LOCAL_PORT = { name: 'Local', color: 0xffd700, hex: '#ffd700', order: 0 } as const

/** Future ports used for transit containers. Skip index 0 (Local). */
const TRANSIT_PORTS = PORTS.slice(1)

function rollHazmat(hazmatRate: number): boolean {
  return Math.random() < hazmatRate
}

function makeImportContainer(hazmatRate: number): Container {
  const weight = Math.round(generateWeight() * 10) / 10
  return {
    id: generateContainerId(),
    weight,
    weightCategory: getWeightCategory(weight),
    port: LOCAL_PORT.name,
    portColor: LOCAL_PORT.color,
    portHex: LOCAL_PORT.hex,
    portOrder: LOCAL_PORT.order,
    isHazmat: rollHazmat(hazmatRate),
    isImport: true,
    isTransit: false,
  }
}

function makeTransitContainer(hazmatRate: number): Container {
  const port = TRANSIT_PORTS[Math.floor(Math.random() * TRANSIT_PORTS.length)]
  return makeTransitContainerForPort(port, hazmatRate)
}

function makeTransitContainerForPort(port: typeof TRANSIT_PORTS[number], hazmatRate: number): Container {
  const weight = Math.round(generateWeight() * 10) / 10
  return {
    id: generateContainerId(),
    weight,
    weightCategory: getWeightCategory(weight),
    port: port.name,
    portColor: port.color,
    portHex: port.hex,
    portOrder: port.order,
    isHazmat: rollHazmat(hazmatRate),
    isImport: false,
    isTransit: true,
  }
}

/** Fisher-Yates shuffle (in-place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Builds a list of all valid slot IDs ordered for pre-placement.
 *
 * spreadFactor 0 = deterministic (lower tiers first, centre rows first — original behaviour).
 * spreadFactor 1 = fully shuffled across every tier and row.
 * Values in between partially shuffle within each tier group before merging.
 */
function buildOrderedSlotIds(
  preset: ShipPreset,
  grid: Record<string, Slot>,
  spreadFactor = 0,
): string[] {
  const activeBays = preset.bays - preset.sternBlockedBays
  const centreRow = Math.floor(preset.rows / 2)

  const rowPriority: number[] = []
  for (let offset = 0; offset <= Math.floor(preset.rows / 2); offset++) {
    if (centreRow - offset >= 0) rowPriority.push(centreRow - offset)
    if (offset > 0 && centreRow + offset < preset.rows) rowPriority.push(centreRow + offset)
  }

  // Build per-tier buckets so we can shuffle within / across tiers
  const tierBuckets: string[][] = []
  for (let t = 0; t < preset.tiers; t++) {
    const tierNum = (t + 1) * 2
    const bucket: string[] = []
    for (const r of rowPriority) {
      const rowNum = r + 1
      for (let b = 0; b < activeBays; b++) {
        const bayNum = b * 2 + 1
        const id = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(tierNum).padStart(2, '0')}`
        if (grid[id]) bucket.push(id)
      }
    }
    tierBuckets.push(bucket)
  }

  if (spreadFactor <= 0) {
    // Original deterministic order: tier 1 → tier 2 → … (centre rows first within each)
    return tierBuckets.flat()
  }

  if (spreadFactor >= 1) {
    // Fully flatten then shuffle — every slot equally likely regardless of tier/row
    return shuffle(tierBuckets.flat())
  }

  // Partial: shuffle within each tier bucket, then interleave tiers randomly
  const shuffledBuckets = tierBuckets.map(b => shuffle([...b]))
  // Interleave by drawing from a randomly weighted bucket each step
  const result: string[] = []
  const remaining = shuffledBuckets.map(b => [...b])
  while (remaining.some(b => b.length > 0)) {
    // Weight lower tiers slightly higher so ground-floor slots still tend to fill first,
    // but upper-tier slots have a real chance of appearing early
    const weights = remaining.map((b, i) => b.length > 0 ? Math.max(1, (preset.tiers - i) * (1 - spreadFactor) + 1) : 0)
    const total = weights.reduce((s, w) => s + w, 0)
    let pick = Math.random() * total
    let chosen = 0
    for (let i = 0; i < weights.length; i++) {
      pick -= weights[i]
      if (pick <= 0) { chosen = i; break }
    }
    result.push(remaining[chosen].shift()!)
  }
  return result
}

function canPlace(slotId: string, grid: Record<string, Slot>): boolean {
  const slot = grid[slotId]
  if (!slot || slot.container) return false
  if (slot.tierIndex === 0) return true
  const belowTierNum = slot.tier - 2
  const belowId = `${String(slot.bay).padStart(2, '0')}-${String(slot.row).padStart(2, '0')}-${String(belowTierNum).padStart(2, '0')}`
  return !!(grid[belowId]?.container)
}

function buildUpperTierSlotIds(
  preset: ShipPreset,
  grid: Record<string, Slot>,
): string[] {
  const activeBays = preset.bays - preset.sternBlockedBays
  const centreRow = Math.floor(preset.rows / 2)

  const rowPriority: number[] = []
  for (let offset = 0; offset <= Math.floor(preset.rows / 2); offset++) {
    if (centreRow - offset >= 0) rowPriority.push(centreRow - offset)
    if (offset > 0 && centreRow + offset < preset.rows) rowPriority.push(centreRow + offset)
  }

  const ordered: string[] = []
  for (let t = preset.tiers - 1; t >= 0; t--) {
    const tierNum = (t + 1) * 2
    for (const r of rowPriority) {
      const rowNum = r + 1
      for (let b = 0; b < activeBays; b++) {
        const bayNum = b * 2 + 1
        const id = `${String(bayNum).padStart(2, '0')}-${String(rowNum).padStart(2, '0')}-${String(tierNum).padStart(2, '0')}`
        if (grid[id]) ordered.push(id)
      }
    }
  }

  return ordered
}

function placeImportContainers(
  count: number,
  grid: Record<string, Slot>,
  slotIds: string[],
  placed: Container[],
  hazmatRate: number,
): number {
  let importPlaced = 0
  for (const id of slotIds) {
    if (importPlaced >= count) break
    if (!canPlace(id, grid)) continue
    const container = makeImportContainer(hazmatRate)
    grid[id].container = container
    placed.push(container)
    importPlaced++
  }
  return importPlaced
}

function buildGroupedTransitContainers(count: number, hazmatRate: number): Container[] {
  const ports = shuffle([...TRANSIT_PORTS])
  const grouped: Container[] = []

  while (grouped.length < count) {
    for (const port of ports) {
      if (grouped.length >= count) break
      grouped.push(makeTransitContainerForPort(port, hazmatRate))
    }
  }

  return grouped
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
  transitCount: number = 0,
  hazmatRate: number = 0,
  spreadFactor: number = 0,
  importPlacement: ImportPlacementMode = 'default',
  transitGrouping: TransitGroupingMode = 'random',
): Container[] {
  const placed: Container[] = []
  const orderedIds = buildOrderedSlotIds(preset, grid, spreadFactor)

  const importSlotIds = importPlacement === 'upper-tiers'
    ? buildUpperTierSlotIds(preset, grid)
    : orderedIds

  if (importPlacement === 'upper-tiers' && transitCount > 0) {
    const transitBaseTarget = Math.min(transitCount, preset.bays - preset.sternBlockedBays)
    const transitBaseIds = orderedIds.filter(id => grid[id]?.tierIndex === 0).slice(0, transitBaseTarget)
    const groupedTransit = transitGrouping === 'grouped-by-pod'
      ? buildGroupedTransitContainers(transitBaseIds.length, hazmatRate)
      : transitBaseIds.map(() => makeTransitContainer(hazmatRate))

    for (let i = 0; i < transitBaseIds.length; i++) {
      const id = transitBaseIds[i]
      const container = groupedTransit[i]
      grid[id].container = container
      placed.push(container)
    }

    placeImportContainers(count, grid, importSlotIds, placed, hazmatRate)

    const remainingTransit = transitCount - transitBaseIds.length
    if (remainingTransit <= 0) return placed

    const transitSlots = orderedIds.filter(id => !grid[id]?.container)
    const extraTransit = transitGrouping === 'grouped-by-pod'
      ? buildGroupedTransitContainers(remainingTransit, hazmatRate)
      : transitSlots.slice(0, remainingTransit).map(() => makeTransitContainer(hazmatRate))

    let transitPlaced = 0
    for (const id of transitSlots) {
      if (transitPlaced >= remainingTransit) break
      if (!canPlace(id, grid)) continue
      const container = extraTransit[transitPlaced]
      grid[id].container = container
      placed.push(container)
      transitPlaced++
    }

    return placed
  }

  // 1 — Place import containers.
  placeImportContainers(count, grid, importSlotIds, placed, hazmatRate)

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

  const groupedTransit = transitGrouping === 'grouped-by-pod'
    ? buildGroupedTransitContainers(transitCount, hazmatRate)
    : transitSlots.slice(0, transitCount).map(() => makeTransitContainer(hazmatRate))

  let transitPlaced = 0
  for (const id of transitSlots) {
    if (transitPlaced >= transitCount) break
    if (!canPlace(id, grid)) continue
    const container = groupedTransit[transitPlaced]
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
          // Any transit container at the top of its stack can be restowed
          actionable.push(id)
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
