import type { Slot, ShipPreset, Container, PhysicsState, DisasterType } from '../types'
import { PHYSICS } from './config'

export function calculateList(grid: Record<string, Slot>, shipConfig: ShipPreset): number {
  let listMoment = 0
  let totalWeight = shipConfig.emptyWeight

  for (const slot of Object.values(grid)) {
    if (slot.container) {
      listMoment += slot.container.weight * slot.zOffset
      totalWeight += slot.container.weight
    }
  }

  if (totalWeight === 0) return 0
  const beamFactor = shipConfig.width / 2
  const multiplier = (shipConfig.physicsMultiplier ?? 1.0) * PHYSICS.listMultiplier
  return (listMoment / (totalWeight * beamFactor)) * multiplier * 100
}

export function calculateTrim(grid: Record<string, Slot>, shipConfig: ShipPreset): number {
  let trimMoment = 0
  let totalWeight = shipConfig.emptyWeight

  for (const slot of Object.values(grid)) {
    if (slot.container) {
      trimMoment += slot.container.weight * slot.xOffset
      totalWeight += slot.container.weight
    }
  }

  if (totalWeight === 0) return 0
  const lengthFactor = shipConfig.length / 2
  const multiplier = (shipConfig.physicsMultiplier ?? 1.0) * PHYSICS.trimMultiplier
  return (trimMoment / (totalWeight * lengthFactor)) * multiplier * 100
}

export function calculateVCG(grid: Record<string, Slot>, shipConfig: ShipPreset): number {
  let weightedHeight = shipConfig.emptyWeight * shipConfig.emptyVCG
  let totalWeight = shipConfig.emptyWeight

  for (const slot of Object.values(grid)) {
    if (slot.container) {
      weightedHeight += slot.container.weight * slot.yOffset
      totalWeight += slot.container.weight
    }
  }

  if (totalWeight === 0) return 0
  return weightedHeight / totalWeight
}

export function updatePhysics(grid: Record<string, Slot>, shipConfig: ShipPreset): PhysicsState {
  const list = calculateList(grid, shipConfig)
  const trim = calculateTrim(grid, shipConfig)
  const vcg = calculateVCG(grid, shipConfig)
  return { list, trim, vcg }
}

export function checkDisasters(
  list: number,
  trim: number,
  _vcg: number,
  grid: Record<string, Slot>,
  shipConfig: ShipPreset,
  placedSlot: Slot | null,
  container: Container | null
): DisasterType | null {
  if (Math.abs(list) >= PHYSICS.listDisaster) return 'capsize'
  if (Math.abs(trim) >= PHYSICS.trimDisaster) return 'founder'

  if (placedSlot) {
    let stackWeight = 0
    for (const slot of Object.values(grid)) {
      if (slot.container && slot.bay === placedSlot.bay && slot.row === placedSlot.row) {
        stackWeight += slot.container.weight
      }
    }
    if (stackWeight > shipConfig.maxStackWeight) return 'collapse'
  }

  if (container && container.isHazmat && placedSlot) {
    for (const slot of Object.values(grid)) {
      if (slot.container && slot.container.isHazmat && slot.id !== placedSlot.id) {
        const bayDiff = Math.abs(slot.bay - placedSlot.bay) / 2
        const rowDiff = Math.abs(slot.row - placedSlot.row)
        const tierDiff = Math.abs(slot.tier - placedSlot.tier) / 2
        if (bayDiff < 2 && rowDiff < 1.5 && tierDiff < 2) return 'explosion'
      }
    }
  }

  return null
}

export function getListLevel(list: number): 'normal' | 'warning' | 'critical' {
  const abs = Math.abs(list)
  if (abs >= PHYSICS.listCritical) return 'critical'
  if (abs >= PHYSICS.listWarning) return 'warning'
  return 'normal'
}

export function getTrimLevel(trim: number): 'normal' | 'warning' | 'critical' {
  const abs = Math.abs(trim)
  if (abs >= PHYSICS.trimCritical) return 'critical'
  if (abs >= PHYSICS.trimWarning) return 'warning'
  return 'normal'
}
