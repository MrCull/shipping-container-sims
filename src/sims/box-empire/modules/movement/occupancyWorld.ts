import {
  getYardStackGeometry,
  REACH_STACKER_FOOTPRINT,
  TRUCK_FOOTPRINT,
  type Footprint,
} from './terminalGeometry'
import type { BoxEmpireState, Equipment, Position3D, YardBlock } from '../../types'

export interface OccupancyRect extends Footprint {
  entityId: string
  x: number
  z: number
  kind?: 'truck' | 'reach_stacker' | 'mobile_harbor_crane' | 'yard_stack'
  static?: boolean
}

export interface MoveAttempt {
  allowed: boolean
  position: Position3D
  blockedBy?: string
  blockedByStatic?: boolean
}

export interface OccupancyOptions {
  ignoreDynamic?: boolean
}

function overlaps(a: OccupancyRect, b: OccupancyRect): boolean {
  return Math.abs(a.x - b.x) < a.halfX + b.halfX &&
    Math.abs(a.z - b.z) < a.halfZ + b.halfZ
}

function occupancyKindForEntityId(entityId: string): OccupancyRect['kind'] {
  if (entityId.startsWith('rs-')) return 'reach_stacker'
  return undefined
}

function canOverlap(a: OccupancyRect, b: OccupancyRect): boolean {
  return a.kind === 'reach_stacker' && b.kind === 'reach_stacker'
}

function overlapDepth(a: OccupancyRect, b: OccupancyRect): number {
  const xDepth = a.halfX + b.halfX - Math.abs(a.x - b.x)
  const zDepth = a.halfZ + b.halfZ - Math.abs(a.z - b.z)
  return xDepth > 0 && zDepth > 0 ? Math.min(xDepth, zDepth) : 0
}

function isMovingOutOfOverlap(
  current: OccupancyRect | undefined,
  proposed: OccupancyRect,
  blocker: OccupancyRect,
): boolean {
  if (!current) return false
  const currentDepth = overlapDepth(current, blocker)
  if (currentDepth <= 0) return false
  return overlapDepth(proposed, blocker) < currentDepth
}

function equipmentFootprint(eq: Equipment): Footprint {
  if (eq.type === 'reach_stacker') return REACH_STACKER_FOOTPRINT
  return { halfX: 1.4, halfZ: 1.4 }
}

function yardStackZone(block: YardBlock): OccupancyRect {
  const stack = getYardStackGeometry(block)
  return {
    entityId: `yard-stack-zone:${block.id}`,
    x: stack.x,
    z: stack.z,
    halfX: stack.halfX,
    halfZ: stack.halfZ,
    kind: 'yard_stack',
    static: true,
  }
}

export class OccupancyWorld {
  private readonly rects = new Map<string, OccupancyRect>()

  constructor(rects: OccupancyRect[]) {
    for (const rect of rects) {
      this.rects.set(rect.entityId, { ...rect })
    }
  }

  canOccupy(
    entityId: string,
    position: Position3D,
    footprint?: Footprint,
    options: OccupancyOptions = {},
  ): MoveAttempt {
    const current = this.rects.get(entityId)
    const fp = footprint ?? current
    if (!fp) return { allowed: true, position }

    const proposed: OccupancyRect = {
      entityId,
      x: position.x,
      z: position.z,
      halfX: fp.halfX,
      halfZ: fp.halfZ,
      kind: current?.kind ?? occupancyKindForEntityId(entityId),
    }

    for (const rect of this.rects.values()) {
      if (rect.entityId === entityId) continue
      if (options.ignoreDynamic && !rect.static) continue
      if (canOverlap(proposed, rect)) continue
      if (overlaps(proposed, rect)) {
        if (isMovingOutOfOverlap(current, proposed, rect)) continue
        return {
          allowed: false,
          position: current ? { x: current.x, y: position.y, z: current.z } : position,
          blockedBy: rect.entityId,
          blockedByStatic: rect.static === true,
        }
      }
    }

    return { allowed: true, position }
  }

  tryMoveEntity(
    entityId: string,
    position: Position3D,
    footprint?: Footprint,
    options: OccupancyOptions = {},
  ): MoveAttempt {
    const attempt = this.canOccupy(entityId, position, footprint, options)
    if (!attempt.allowed) return attempt

    const current = this.rects.get(entityId)
    const fp = footprint ?? current
    if (fp) {
      this.rects.set(entityId, {
        entityId,
        x: position.x,
        z: position.z,
        halfX: fp.halfX,
        halfZ: fp.halfZ,
        kind: current?.kind ?? occupancyKindForEntityId(entityId),
      })
    }
    return attempt
  }

  remove(entityId: string): void {
    this.rects.delete(entityId)
  }
}

export function createOccupancyWorld(state: BoxEmpireState): OccupancyWorld {
  const rects: OccupancyRect[] = []

  for (const truck of state.truckVisits) {
    if (truck.state === 'departed') continue
    rects.push({
      entityId: truck.id,
      x: truck.position.x,
      z: truck.position.z,
      kind: 'truck',
      ...TRUCK_FOOTPRINT,
    })
  }

  for (const eq of state.equipment) {
    const fp = equipmentFootprint(eq)
    rects.push({
      entityId: eq.id,
      x: eq.position.x,
      z: eq.position.z,
      kind: eq.type,
      ...fp,
    })
  }

  for (const yard of state.yardBlocks) {
    rects.push(yardStackZone(yard))
  }

  return new OccupancyWorld(rects)
}
