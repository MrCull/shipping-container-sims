import { Vector3 } from 'three'
import type { JengaContainer, LayerOrientation, TowerLayer } from '../types'
import { BLOCK, CONTAINER_COLORS, TOWER } from './config'

let idCounter = 0

function nextId(): string {
  return `c-${++idCounter}`
}

export function resetContainerIdCounter(): void {
  idCounter = 0
}

function randomColor(): string {
  const i = Math.floor(Math.random() * CONTAINER_COLORS.length)
  return CONTAINER_COLORS[i]!
}

function orientationForLayer(layerIndex: number): LayerOrientation {
  return layerIndex % 2 === 0 ? 'alongX' : 'alongZ'
}

export function buildInitialTower(layerCount: number = TOWER.startLayers): TowerLayer[] {
  const layers: TowerLayer[] = []
  for (let i = 0; i < layerCount; i++) {
    const orientation = orientationForLayer(i)
    const slots: (JengaContainer | null)[] = []
    for (let s = 0; s < TOWER.slotsPerLayer; s++) {
      slots.push({
        id: nextId(),
        color: randomColor(),
        layerIndex: i,
        slotIndex: s,
      })
    }
    layers.push({ index: i, orientation, slots })
  }
  return layers
}

/** World position of slot center (layer local Y = top of stack for that layer) */
export function slotWorldPosition(
  layerIndex: number,
  slotIndex: number,
  layers: TowerLayer[]
): Vector3 {
  const layer = layers[layerIndex]
  if (!layer) return new Vector3()

  const y = layerIndex * BLOCK.height + BLOCK.height * 0.5
  const { width, gap } = BLOCK
  const span = 3 * width + 2 * gap
  const offsets = [-span / 2 + width / 2, 0, span / 2 - width / 2]

  if (layer.orientation === 'alongX') {
    const x = offsets[slotIndex]!
    return new Vector3(x, y, 0)
  }
  const z = offsets[slotIndex]!
  return new Vector3(0, y, z)
}

export function getTopLayerIndex(layers: TowerLayer[]): number {
  return Math.max(0, layers.length - 1)
}

/** Index of highest layer that still has at least one container */
export function getHighestOccupiedLayerIndex(layers: TowerLayer[]): number {
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i]!
    if (L.slots.some(s => s !== null)) return i
  }
  return -1
}

export function isLayerComplete(layer: TowerLayer): boolean {
  return layer.slots.every(s => s !== null)
}

export function layerCompleteness(layer: TowerLayer): number {
  const filled = layer.slots.filter(s => s !== null).length
  return filled / layer.slots.length
}

export function countContainersInLayer(layer: TowerLayer): number {
  return layer.slots.filter(s => s !== null).length
}

export function getTowerTopY(layers: TowerLayer[]): number {
  if (layers.length === 0) return 0
  return layers.length * BLOCK.height
}

export interface PlacementCandidate {
  slotIndex: number
  position: Vector3
  orientation: LayerOrientation
}

/** World positions for choosing where to place the floating block (top gaps or next row). */
export function getPlacementCandidates(
  layers: TowerLayer[],
  slotIndices: number[]
): PlacementCandidate[] {
  if (layers.length === 0 || slotIndices.length === 0) return []

  const topIdx = getTopLayerIndex(layers)
  const topLayer = layers[topIdx]!
  const out: PlacementCandidate[] = []

  for (const slot of slotIndices) {
    if (topLayer.slots[slot] === null) {
      out.push({
        slotIndex: slot,
        position: slotWorldPosition(topIdx, slot, layers),
        orientation: topLayer.orientation,
      })
    }
  }

  if (out.length > 0) return out

  const newIdx = layers.length
  const orient = newIdx % 2 === 0 ? 'alongX' : 'alongZ'
  const tempLayers = [...layers]
  tempLayers.push({
    index: newIdx,
    orientation: orient,
    slots: [null, null, null],
  })

  for (const slot of slotIndices) {
    out.push({
      slotIndex: slot,
      position: slotWorldPosition(newIdx, slot, tempLayers),
      orientation: orient,
    })
  }
  return out
}
