import type { Slot, ShipPreset } from '../types'
import { CONTAINER } from './config'

const slotCache = new Map<string, Record<string, Slot>>()

export function slotId(bay: number, row: number, tier: number): string {
  return `${String(bay).padStart(2, '0')}-${String(row).padStart(2, '0')}-${String(tier).padStart(2, '0')}`
}

export function parseSlotId(id: string): { bay: number; row: number; tier: number } {
  const parts = id.split('-')
  return {
    bay: parseInt(parts[0]),
    row: parseInt(parts[1]),
    tier: parseInt(parts[2]),
  }
}

export function generateSlots(shipConfig: ShipPreset): Record<string, Slot> {
  slotCache.clear()
  const cacheKey = `${shipConfig.name}-${shipConfig.bays}-${shipConfig.rows}-${shipConfig.tiers}`

  const slots: Record<string, Slot> = {}
  const { bays, rows, tiers } = shipConfig

  // Derive cell sizes from the actual cargo area so slots stay within the hull
  const cargoLength = shipConfig.length * shipConfig.cargoLengthFraction
  const cargoWidth = shipConfig.width * shipConfig.cargoWidthFraction
  const cargoXCenter = shipConfig.length * shipConfig.cargoXOffsetFraction

  // Evenly distribute bays and rows across the cargo area
  const cellX = bays > 1 ? cargoLength / bays : CONTAINER.size.z + CONTAINER.gap
  const cellZ = rows > 1 ? cargoWidth / rows : CONTAINER.size.x + CONTAINER.gap
  const cellY = CONTAINER.size.y + CONTAINER.gap

  const activeBays = bays - shipConfig.sternBlockedBays

  for (let b = 0; b < activeBays; b++) {
    const bayNum = b * 2 + 1
    for (let r = 0; r < rows; r++) {
      const rowNum = r + 1
      for (let t = 0; t < tiers; t++) {
        const tierNum = (t + 1) * 2
        const id = slotId(bayNum, rowNum, tierNum)

        // Use per-bay X override if provided, otherwise uniform spacing
        const xOffset = shipConfig.bayXOffsets
          ? shipConfig.bayXOffsets[b]
          : cargoXCenter + (b - (activeBays - 1) / 2) * cellX

        // Per-bay Y base (e.g. raised forecastle bays) + tier stacking
        const yBase = shipConfig.bayYBaseOffsets ? shipConfig.bayYBaseOffsets[b] : 0
        const yOffset = yBase + t * cellY

        const zOffset = (r - (rows - 1) / 2) * cellZ

        slots[id] = {
          id,
          bay: bayNum,
          row: rowNum,
          tier: tierNum,
          bayIndex: b,
          rowIndex: r,
          tierIndex: t,
          xOffset,
          yOffset,
          zOffset,
          container: null,
        }
      }
    }
  }

  slotCache.set(cacheKey, slots)
  return slots
}

export function getAvailableSlots(grid: Record<string, Slot>, shipConfig: ShipPreset): string[] {
  const available: string[] = []
  const { rows, tiers } = shipConfig
  const activeBays = shipConfig.bays - shipConfig.sternBlockedBays

  for (let b = 0; b < activeBays; b++) {
    const bayNum = b * 2 + 1
    for (let r = 0; r < rows; r++) {
      const rowNum = r + 1
      for (let t = 0; t < tiers; t++) {
        const tierNum = (t + 1) * 2
        const id = slotId(bayNum, rowNum, tierNum)

        if (grid[id] && grid[id].container) continue

        if (t === 0) {
          available.push(id)
        } else {
          const belowTier = t * 2
          const belowId = slotId(bayNum, rowNum, belowTier)
          if (grid[belowId] && grid[belowId].container) {
            available.push(id)
          }
        }
      }
    }
  }

  return available
}

export function getStackWeight(grid: Record<string, Slot>, shipConfig: ShipPreset, bayNum: number, rowNum: number): number {
  let totalWeight = 0
  for (let t = 0; t < shipConfig.tiers; t++) {
    const tierNum = (t + 1) * 2
    const id = slotId(bayNum, rowNum, tierNum)
    if (grid[id] && grid[id].container) {
      totalWeight += grid[id].container!.weight
    }
  }
  return totalWeight
}

export function isOutermostRow(rowIndex: number, totalRows: number): boolean {
  return rowIndex === 0 || rowIndex === totalRows - 1
}

export function isTopThird(tierIndex: number, totalTiers: number): boolean {
  return tierIndex >= Math.floor(totalTiers * 2 / 3)
}

export function clearSlotCache(): void {
  slotCache.clear()
}
