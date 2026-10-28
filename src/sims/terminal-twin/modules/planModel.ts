/**
 * 2D plan of a scenario (TT-15): the setup dialog's live preview. Pure; built from
 * the same engine geometry the 3D scene uses (`blockSpecs`, the lane and landside
 * graphs), so positions match the 3D layout by construction (and a test checks
 * them against `SceneModel`). Plan coordinates are scene metres: X along the quay,
 * Z from the quay edge (0) towards the yard, the sea at negative Z.
 */
import { BAY_PITCH_M, blockSpecs, BLOCK_ROWS, ROW_PITCH_M, hasLandside, landsideGraphOf, transferStallLayout, wtpPadLayout } from '../engine'
import { apronLayout } from '../engine/laneGraph'
import type { ScenarioConfig } from '../scenario/types'

export interface PlanRect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface PlanModel {
  quay: PlanRect
  /** Gantry centres on the STS rail. */
  sts: { id: string; x: number; z: number }[]
  /** Yard blocks: the stacks and the WTP pad row. */
  blocks: { id: string; x: number; stacks: PlanRect; pads: PlanRect }[]
  /** Transfer stalls (landside end of each block). */
  stalls: { id: string; x: number; z: number }[]
  /** Gate cluster (lanes) and the landside road span; null without a landside. */
  gate: { lanes: PlanRect; roads: PlanRect } | null
  /** Everything drawn, for scaling. */
  bounds: PlanRect
}

/** Z of the STS rail: the quay edge plus the crane's waterside gauge. */
const STS_RAIL_Z = 0
const SEA_M = 40

const union = (rects: PlanRect[]): PlanRect => ({
  x0: Math.min(...rects.map((r) => r.x0)),
  x1: Math.max(...rects.map((r) => r.x1)),
  z0: Math.min(...rects.map((r) => r.z0)),
  z1: Math.max(...rects.map((r) => r.z1)),
})

export function planOf(config: ScenarioConfig): PlanModel {
  const quay: PlanRect = { x0: 0, x1: config.quay.lengthM, z0: -SEA_M, z1: 0 }
  const wtpZ = apronLayout(config).wtpZ
  const specs = blockSpecs(config)
  const pads = wtpPadLayout(config)
  const blocks = specs.map((b) => {
    const halfW = (BLOCK_ROWS * ROW_PITCH_M) / 2
    const padXs = pads.filter((p) => p.blockId === b.id).map((p) => p.x)
    return {
      id: b.id,
      x: b.x,
      stacks: { x0: b.x - halfW, x1: b.x + halfW, z0: b.firstBayZ - BAY_PITCH_M / 2, z1: b.firstBayZ + (b.bays - 0.5) * BAY_PITCH_M },
      pads: { x0: Math.min(b.x - halfW, ...padXs), x1: Math.max(b.x + halfW, ...padXs), z0: wtpZ - 3, z1: wtpZ + 3 },
    }
  })
  const stalls = specs.flatMap(transferStallLayout).map((s) => ({ id: s.id, x: s.x, z: s.z }))
  let gate: PlanModel['gate'] = null
  if (hasLandside(config)) {
    const g = landsideGraphOf(config)
    const laneXs = [...g.inLanes, ...g.outLanes].map((l) => l.x).concat(g.oogX === null ? [] : [g.oogX])
    gate = {
      lanes: { x0: Math.min(...laneXs) - 1.8, x1: Math.max(...laneXs) + 1.8, z0: g.gate.kioskZ - 6, z1: g.gate.kioskZ + 6 },
      roads: { x0: g.gate.westX, x1: g.gate.eastX, z0: g.gate.roadInZ, z1: g.gate.roadOutZ },
    }
  }
  const sts = config.sts.map((s) => ({ id: s.id, x: s.gantryX, z: STS_RAIL_Z }))
  const all: PlanRect[] = [quay, ...blocks.flatMap((b) => [b.stacks, b.pads])]
  if (gate) all.push(gate.lanes, gate.roads)
  return { quay, sts, blocks, stalls, gate, bounds: union(all) }
}
