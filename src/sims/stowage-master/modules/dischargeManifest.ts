import type {
  Container,
  PortDefinition,
  Slot,
  ShipPreset,
  ImportPlacementMode,
  TransitGroupingMode,
} from '../types'
import { CONTAINER, getPortsForPreset } from './config'
import { generateContainerId, generateWeight, getWeightCategory } from './containerFactory'

/**
 * The "local port" — Import containers discharged here.
 * Gold colour makes them visually distinct from transit/export cargo.
 */
const LOCAL_PORT = { name: 'Local', color: 0xffd700, hex: '#ffd700', order: 0 } as const
const BAY_GROUPING_PRIMARY_CHANCE = 0.95

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

function makeTransitContainer(hazmatRate: number, transitPorts: PortDefinition[]): Container {
  const port = transitPorts[Math.floor(Math.random() * transitPorts.length)]
  return makeTransitContainerForPort(port, hazmatRate)
}

function makeTransitContainerForPort(port: PortDefinition, hazmatRate: number): Container {
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

function sortTransitSlotsForBayGrouping(slotIds: string[], grid: Record<string, Slot>, preset: ShipPreset): string[] {
  const centreRow = (preset.rows - 1) / 2
  return [...slotIds].sort((a, b) => {
    const slotA = grid[a]
    const slotB = grid[b]
    if (!slotA || !slotB) return 0

    if (slotA.bayIndex !== slotB.bayIndex) return slotA.bayIndex - slotB.bayIndex
    if (slotA.tierIndex !== slotB.tierIndex) return slotA.tierIndex - slotB.tierIndex

    const rowDeltaA = Math.abs(slotA.rowIndex - centreRow)
    const rowDeltaB = Math.abs(slotB.rowIndex - centreRow)
    if (rowDeltaA !== rowDeltaB) return rowDeltaA - rowDeltaB

    return slotA.rowIndex - slotB.rowIndex
  })
}

interface BayPortGroup {
  port: PortDefinition | typeof LOCAL_PORT
  remaining: number
  isImport: boolean
  assignedBayIndexes: number[]
}

function buildTransitPortCounts(
  transitCount: number,
  transitPorts: PortDefinition[],
): Array<{ port: PortDefinition; count: number }> {
  if (transitCount <= 0 || transitPorts.length === 0) return []

  const baseCount = Math.floor(transitCount / transitPorts.length)
  const remainder = transitCount % transitPorts.length

  return transitPorts.map((port, index) => ({
    port,
    count: baseCount + (index < remainder ? 1 : 0),
  })).filter(entry => entry.count > 0)
}

function allocateBayCounts(weights: number[], bayCount: number): number[] {
  if (weights.length === 0) return []

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const counts = weights.map(weight => Math.max(1, Math.floor((weight / totalWeight) * bayCount)))

  let allocated = counts.reduce((sum, count) => sum + count, 0)
  while (allocated > bayCount) {
    let removeIndex = -1
    let largestCount = 1
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > largestCount) {
        largestCount = counts[i]
        removeIndex = i
      }
    }
    if (removeIndex === -1) break
    counts[removeIndex]--
    allocated--
  }

  while (allocated < bayCount) {
    let addIndex = 0
    let smallestCount = Number.POSITIVE_INFINITY
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] < smallestCount) {
        smallestCount = counts[i]
        addIndex = i
      }
    }
    counts[addIndex]++
    allocated++
  }

  return counts
}

function buildPrimaryBayIndexes(activeBayCount: number, groupCount: number): number[] {
  if (activeBayCount <= 0 || groupCount <= 0) return []
  if (groupCount === 1) return [Math.floor((activeBayCount - 1) / 2)]

  const indexes: number[] = []
  const used = new Set<number>()

  for (let i = 0; i < groupCount; i++) {
    const ratio = i / (groupCount - 1)
    let bayIndex = Math.round(ratio * (activeBayCount - 1))

    while (used.has(bayIndex) && bayIndex < activeBayCount - 1) bayIndex++
    while (used.has(bayIndex) && bayIndex > 0) bayIndex--

    if (!used.has(bayIndex)) {
      indexes.push(bayIndex)
      used.add(bayIndex)
    }
  }

  return indexes
}

function buildBayPortGroups(
  importCount: number,
  transitCount: number,
  transitPorts: PortDefinition[],
  preset: ShipPreset,
): BayPortGroup[] {
  const activeBayCount = preset.bays - preset.sternBlockedBays
  const transitPortCounts = buildTransitPortCounts(transitCount, transitPorts)
  const entries: BayPortGroup[] = []

  if (importCount > 0) {
    entries.push({
      port: LOCAL_PORT,
      remaining: importCount,
      isImport: true,
      assignedBayIndexes: [],
    })
  }

  for (const entry of transitPortCounts) {
    entries.push({
      port: entry.port,
      remaining: entry.count,
      isImport: false,
      assignedBayIndexes: [],
    })
  }

  if (entries.length === 0) return []

  const bayCounts = allocateBayCounts(entries.map(entry => entry.remaining), activeBayCount)
  const remainingBayCounts = [...bayCounts]
  const primaryBayIndexes = buildPrimaryBayIndexes(activeBayCount, entries.length)
  const usedBayIndexes = new Set<number>()

  for (let groupIndex = 0; groupIndex < entries.length; groupIndex++) {
    if ((remainingBayCounts[groupIndex] ?? 0) <= 0) continue
    const primaryBayIndex = primaryBayIndexes[groupIndex]
    if (primaryBayIndex == null) break
    entries[groupIndex].assignedBayIndexes.push(primaryBayIndex)
    usedBayIndexes.add(primaryBayIndex)
    remainingBayCounts[groupIndex]--
  }

  while (remainingBayCounts.some(count => count > 0)) {
    let assignedAny = false

    for (let groupIndex = 0; groupIndex < entries.length; groupIndex++) {
      if ((remainingBayCounts[groupIndex] ?? 0) <= 0) continue
      const nextBay = Array.from({ length: activeBayCount }, (_, bayIndex) => bayIndex)
        .find(bayIndex => !usedBayIndexes.has(bayIndex))
      if (nextBay == null) break
      entries[groupIndex].assignedBayIndexes.push(nextBay)
      usedBayIndexes.add(nextBay)
      remainingBayCounts[groupIndex]--
      assignedAny = true
    }

    if (!assignedAny) break
  }

  return entries
}

function placeBayGroupedContainers(
  groups: BayPortGroup[],
  grid: Record<string, Slot>,
  slotIds: string[],
  placed: Container[],
  hazmatRate: number,
  includeImports: boolean,
): void {
  const eligibleGroups = groups.filter(group => includeImports || !group.isImport)
  const spillSlots = [...slotIds]

  for (const group of eligibleGroups) {
    const preferredSlots = slotIds.filter(slotId =>
      group.assignedBayIndexes.includes(grid[slotId]?.bayIndex ?? -1),
    )
    const preferredTarget = Math.min(group.remaining, Math.round(group.remaining * BAY_GROUPING_PRIMARY_CHANCE))
    let placedPreferred = 0

    for (const slotId of preferredSlots) {
      if (placedPreferred >= preferredTarget || group.remaining <= 0) break
      if (!canPlace(slotId, grid)) continue

      const container = group.isImport
        ? makeImportContainer(hazmatRate)
        : makeTransitContainerForPort(group.port, hazmatRate)

      grid[slotId].container = container
      placed.push(container)
      group.remaining--
      placedPreferred++

      const spillIndex = spillSlots.indexOf(slotId)
      if (spillIndex >= 0) spillSlots.splice(spillIndex, 1)
    }
  }

  for (const group of eligibleGroups) {
    for (const slotId of spillSlots) {
      if (group.remaining <= 0) break
      if (!canPlace(slotId, grid)) continue

      const container = group.isImport
        ? makeImportContainer(hazmatRate)
        : makeTransitContainerForPort(group.port, hazmatRate)

      grid[slotId].container = container
      placed.push(container)
      group.remaining--
    }
  }
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
  ports: PortDefinition[] = getPortsForPreset(preset.name),
): Container[] {
  const placed: Container[] = []
  const orderedIds = buildOrderedSlotIds(preset, grid, spreadFactor)
  const transitPorts = ports.slice(1)
  const bayPortGroups = transitGrouping === 'grouped-by-pod'
    ? buildBayPortGroups(count, transitCount, transitPorts, preset)
    : []

  const importSlotIds = importPlacement === 'upper-tiers'
    ? buildUpperTierSlotIds(preset, grid)
    : orderedIds

  if (importPlacement === 'upper-tiers' && transitCount > 0) {
    const transitBaseTarget = Math.min(transitCount, preset.bays - preset.sternBlockedBays)
    const transitBaseIds = orderedIds.filter(id => grid[id]?.tierIndex === 0).slice(0, transitBaseTarget)
    const groupedTransitBaseIds = transitGrouping === 'grouped-by-pod'
      ? sortTransitSlotsForBayGrouping(transitBaseIds, grid, preset)
      : transitBaseIds
    if (transitGrouping === 'grouped-by-pod') {
      placeBayGroupedContainers(bayPortGroups, grid, groupedTransitBaseIds, placed, hazmatRate, false)
    } else {
      for (const id of groupedTransitBaseIds) {
        const container = makeTransitContainer(hazmatRate, transitPorts)
        grid[id].container = container
        placed.push(container)
      }
    }

    if (transitGrouping === 'grouped-by-pod') {
      placeBayGroupedContainers(bayPortGroups, grid, importSlotIds, placed, hazmatRate, true)
    } else {
      placeImportContainers(count, grid, importSlotIds, placed, hazmatRate)
    }

    const remainingTransit = transitCount - transitBaseIds.length
    if (remainingTransit <= 0) return placed

    const transitSlots = orderedIds.filter(id => !grid[id]?.container)
    const orderedTransitSlots = transitGrouping === 'grouped-by-pod'
      ? sortTransitSlotsForBayGrouping(transitSlots, grid, preset)
      : transitSlots
    if (transitGrouping === 'grouped-by-pod') {
      placeBayGroupedContainers(bayPortGroups, grid, orderedTransitSlots, placed, hazmatRate, false)
    } else {
      let transitPlaced = 0
      for (const id of orderedTransitSlots) {
        if (transitPlaced >= remainingTransit) break
        if (!canPlace(id, grid)) continue
        const container = makeTransitContainer(hazmatRate, transitPorts)
        grid[id].container = container
        placed.push(container)
        transitPlaced++
      }
    }

    return placed
  }

  // 1 — Place import containers.
  if (transitGrouping === 'grouped-by-pod') {
    placeBayGroupedContainers(bayPortGroups, grid, importSlotIds, placed, hazmatRate, true)
  } else {
    placeImportContainers(count, grid, importSlotIds, placed, hazmatRate)
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

  const orderedTransitSlots = transitGrouping === 'grouped-by-pod'
    ? sortTransitSlotsForBayGrouping(transitSlots, grid, preset)
    : transitSlots

  if (transitGrouping === 'grouped-by-pod') {
    placeBayGroupedContainers(bayPortGroups, grid, orderedTransitSlots, placed, hazmatRate, false)
  } else {
    let transitPlaced = 0
    for (const id of orderedTransitSlots) {
      if (transitPlaced >= transitCount) break
      if (!canPlace(id, grid)) continue
      const container = makeTransitContainer(hazmatRate, transitPorts)
      grid[id].container = container
      placed.push(container)
      transitPlaced++
    }
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
