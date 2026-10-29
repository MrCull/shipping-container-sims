/**
 * Where the phase 2 infrastructure models go (TT-28): a pure function of the scenario, so it is testable without
 * WebGL. The renderer turns each placement into one instance of a shared InstancedMesh per geometry key.
 *
 * Scene axes: quay along +x, water towards -z, up +y. Gate modules face +Z (the direction a truck drives):
 * inbound and out-of-gauge lanes are yawed pi (trucks drive -Z), outbound lanes are not.
 */
import { GATE_ISLAND_W_M, GATE_LANE_W_M, GATE_OOG_LANE_W_M, railEndZ, railStartZ, transferStallLayout, type BlockSpec, type LandsideGraph } from '../engine'
import type { ScenarioConfig } from '../scenario/types'
import { ASC, STS } from './equipmentDims'
import type { InfraKey } from './infrastructureAssets'

export interface InfraPlacement {
  key: InfraKey
  x: number
  y: number
  z: number
  /** Rotation about +Y (rad). */
  yaw: number
  /** Stretch along the model's X (the last segment of a run). */
  scaleX: number
}

/** The slice of the scene model the layout needs. */
export interface InfraLayoutInput {
  config: ScenarioConfig
  landside: LandsideGraph | null
  pads: { x: number; z: number }[]
  blocks: BlockSpec[]
}

/** Sizes of the repeated modules (m). Mirrors the sidecars (the sidecars are checked against these in tests). */
export const SEGMENT_M = 10
export const FENCE_SEGMENT_M = 5
export const MAX_MASTS = 400
/** Spacing of bollards, fenders and masts along the quay (m). */
export const BOLLARD_PITCH_M = 25
export const FENDER_PITCH_M = 15
export const MAST_PITCH_M = 90

/** Z of the landside (second) STS rail. */
export const LAND_RAIL_Z = STS.waterRailZ + STS.gauge

const place = (key: InfraKey, x: number, z: number, yaw = 0, y = 0, scaleX = 1): InfraPlacement => ({ key, x, y, z, yaw, scaleX })

/** Segments of an instanced run along X from `x0` to `x1`; the last is stretched to end exactly at `x1`. */
function runAlongX(key: InfraKey, x0: number, x1: number, z: number, segment: number): InfraPlacement[] {
  const n = Math.max(1, Math.ceil((x1 - x0) / segment - 1e-9))
  const len = (x1 - x0) / n
  return Array.from({ length: n }, (_, i) => place(key, x0 + (i + 0.5) * len, z, 0, 0, len / segment))
}

/** Segments of an instanced run along Z (model X rotated onto +Z). */
function runAlongZ(key: InfraKey, z0: number, z1: number, x: number, segment: number): InfraPlacement[] {
  const n = Math.max(1, Math.ceil((z1 - z0) / segment - 1e-9))
  const len = (z1 - z0) / n
  return Array.from({ length: n }, (_, i) => place(key, x, z0 + (i + 0.5) * len, -Math.PI / 2, 0, len / segment))
}

/** High-mast positions (also used by the atmosphere's night glow): the quay row, then each block's length. */
export function mastSpots(input: Pick<InfraLayoutInput, 'config' | 'blocks'>, quayZ: number): [number, number][] {
  const spots: [number, number][] = []
  const quayLen = input.config.quay.lengthM
  for (let x = -40; x <= quayLen + 40; x += MAST_PITCH_M) spots.push([x, quayZ])
  for (const b of input.blocks) {
    const z0 = b.wtpZ + 7
    const endZ = b.firstBayZ + (b.bays - 0.5) * 6.7
    for (let z = z0 + 25; z <= endZ; z += 70) spots.push([b.x, z])
  }
  return spots.slice(0, MAX_MASTS)
}

/** One gate cluster lane as laid out: what the assembly is built from. */
export interface GateLaneSlot {
  kind: 'in' | 'out' | 'oog'
  x: number
  widthM: number
}

/** The lanes west to east (in lanes, the out-of-gauge lane, out lanes) with their widths. */
export function gateLaneSlots(g: LandsideGraph): GateLaneSlot[] {
  const slots: GateLaneSlot[] = [
    ...g.inLanes.map((l) => ({ kind: 'in' as const, x: l.x, widthM: GATE_LANE_W_M })),
    ...(g.oogX !== null ? [{ kind: 'oog' as const, x: g.oogX, widthM: GATE_OOG_LANE_W_M }] : []),
    ...g.outLanes.map((l) => ({ kind: 'out' as const, x: l.x, widthM: GATE_LANE_W_M })),
  ]
  return slots.sort((a, b) => a.x - b.x)
}

const laneYaw = (kind: GateLaneSlot['kind']): number => (kind === 'out' ? 0 : Math.PI)

/**
 * The gate assembly: a lane module per lane (3.5 m truck lanes, the 8 m out-of-gauge lane), an island between every
 * two neighbouring lanes and at both ends, and the control office west of the cluster. Modules tile the cluster
 * exactly: lane edge to island edge with no gap or overlap (tests check this for 1 to 6 lanes).
 */
export function gatePlacements(g: LandsideGraph): InfraPlacement[] {
  const slots = gateLaneSlots(g)
  const z = g.gate.kioskZ
  const out: InfraPlacement[] = slots.map((s) => place(s.kind === 'oog' ? 'gate-lane-oog' : 'gate-lane', s.x, z, laneYaw(s.kind)))
  const first = slots[0]
  const last = slots[slots.length - 1]
  out.push(place('gate-island', first.x - first.widthM / 2 - GATE_ISLAND_W_M / 2, z, laneYaw(first.kind)))
  for (let i = 0; i + 1 < slots.length; i++) {
    const a = slots[i]
    out.push(place('gate-island', a.x + a.widthM / 2 + GATE_ISLAND_W_M / 2, z, laneYaw(slots[i + 1].kind)))
  }
  out.push(place('gate-island', last.x + last.widthM / 2 + GATE_ISLAND_W_M / 2, z, laneYaw(last.kind)))
  // control office: west of the lanes, its window side facing east (the lanes)
  out.push(place('gate-office', g.gate.westX - 14, z, Math.PI / 2))
  return out
}

/** Office, workshop and substation in the landside area west of the gate (only when there is a landside). */
export function buildingPlacements(g: LandsideGraph): InfraPlacement[] {
  const x = g.gate.westX - 48
  const z = g.gate.kioskZ
  return [place('building-control', x, z + 4, Math.PI / 2), place('building-workshop', x, z + 52, Math.PI / 2), place('building-substation', x, z - 24, Math.PI / 2)]
}

export function quayPlacements(config: ScenarioConfig): InfraPlacement[] {
  const len = config.quay.lengthM
  const out: InfraPlacement[] = []
  out.push(...runAlongX('quay-edge', -40, len + 40, 0, SEGMENT_M))
  out.push(...runAlongX('quay-rail', -40, len + 40, STS.waterRailZ, SEGMENT_M))
  out.push(...runAlongX('quay-rail', -40, len + 40, LAND_RAIL_Z, SEGMENT_M))
  for (let x = BOLLARD_PITCH_M / 2; x < len; x += BOLLARD_PITCH_M) out.push(place('quay-bollard', x, 1.6))
  for (let x = FENDER_PITCH_M / 2; x < len; x += FENDER_PITCH_M) out.push(place('quay-fender', x, 0))
  return out
}

export function yardPlacements(input: InfraLayoutInput): InfraPlacement[] {
  const out: InfraPlacement[] = []
  const seenFence = new Set<number>()
  for (const b of input.blocks) {
    const z0 = railStartZ(b)
    const z1 = railEndZ(b)
    for (const dx of [-ASC.span / 2, ASC.span / 2]) out.push(...runAlongZ('yard-asc-rail', z0, z1, b.x + dx, SEGMENT_M))
    for (const dx of [-ASC.span / 2 - 2.4, ASC.span / 2 + 2.4]) {
      const x = Math.round((b.x + dx) * 10) / 10
      if (seenFence.has(x)) continue
      seenFence.add(x)
      out.push(...runAlongZ('yard-fence', z0, z1, x, FENCE_SEGMENT_M))
    }
    for (const st of transferStallLayout(b)) out.push(place('yard-markings:transfer_stall', st.x, st.z, 0, 0.03))
  }
  for (const p of input.pads) out.push(place('yard-markings:wtp_pad', p.x, p.z, 0, 0.03))
  for (const [x, z] of mastSpots(input, LAND_RAIL_Z + 6)) out.push(place('yard-mast', x, z))
  return out
}

/** Every placement of the scene, in a stable order. */
export function infrastructurePlacements(input: InfraLayoutInput): InfraPlacement[] {
  const out = [...quayPlacements(input.config), ...yardPlacements(input)]
  if (input.landside) out.push(...gatePlacements(input.landside), ...buildingPlacements(input.landside))
  return out
}

/** Placement counts per geometry key. */
export function countByKey(placements: InfraPlacement[]): Partial<Record<InfraKey, number>> {
  const counts: Partial<Record<InfraKey, number>> = {}
  for (const p of placements) counts[p.key] = (counts[p.key] ?? 0) + 1
  return counts
}
