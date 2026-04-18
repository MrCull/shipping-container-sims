import type { Position, Position3D } from '../../types'
import {
  CONTAINER_BAY_GAP,
  CONTAINER_LENGTH,
  CONTAINER_ROW_GAP,
  CONTAINER_WIDTH,
  TUTORIAL_YARD,
  YARD_BLOCK_POSITION,
} from '../config'

export interface Footprint {
  halfX: number
  halfZ: number
}

export interface YardStackInput {
  id: string
  bays: number
  rows: number
  position: Position
}

export interface YardStackGeometry extends Footprint {
  id: string
  x: number
  z: number
}

export interface YardServiceLanes {
  watersideZ: number
  landsideZ: number
  seaEdgeZ: number
  roadEdgeZ: number
  bypassX: number
}

export const REACH_STACKER_FOOTPRINT: Footprint = { halfX: 2.4, halfZ: 4.0 }
export const TRUCK_FOOTPRINT: Footprint = { halfX: 1.7, halfZ: 5.8 }

const ROUTE_CLEARANCE = 0.75

export function getConfiguredYardStackInput(): YardStackInput {
  return {
    id: TUTORIAL_YARD.id,
    bays: TUTORIAL_YARD.bays,
    rows: TUTORIAL_YARD.rows,
    position: YARD_BLOCK_POSITION,
  }
}

export function getYardStackGeometry(block: YardStackInput): YardStackGeometry {
  const spanX = CONTAINER_LENGTH + (block.bays - 1) * (CONTAINER_LENGTH + CONTAINER_BAY_GAP)
  const spanZ = CONTAINER_WIDTH + (block.rows - 1) * (CONTAINER_WIDTH + CONTAINER_ROW_GAP)
  return {
    id: block.id,
    x: block.position.x + (spanX - CONTAINER_LENGTH) / 2,
    z: block.position.z + (spanZ - CONTAINER_WIDTH) / 2,
    halfX: spanX / 2,
    halfZ: spanZ / 2,
  }
}

export function getYardServiceLanes(
  block: YardStackInput = getConfiguredYardStackInput(),
): YardServiceLanes {
  const stack = getYardStackGeometry(block)
  const seaEdgeZ = stack.z - stack.halfZ
  const roadEdgeZ = stack.z + stack.halfZ
  return {
    seaEdgeZ,
    roadEdgeZ,
    watersideZ: seaEdgeZ - REACH_STACKER_FOOTPRINT.halfZ - ROUTE_CLEARANCE,
    landsideZ: roadEdgeZ + REACH_STACKER_FOOTPRINT.halfZ + ROUTE_CLEARANCE,
    bypassX: stack.x - stack.halfX - REACH_STACKER_FOOTPRINT.halfX - ROUTE_CLEARANCE,
  }
}

export function getReachStackerHomePosition(): Position3D {
  const lanes = getYardServiceLanes()
  return {
    x: 10,
    y: 0,
    z: lanes.landsideZ,
  }
}
