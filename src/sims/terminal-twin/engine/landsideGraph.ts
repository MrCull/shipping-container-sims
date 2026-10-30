/**
 * Landside road graph (TT-13): the one-way roads external trucks drive, the
 * gate lanes and the transfer stalls. Pure and deterministic, generated from
 * the yard blocks and the gate configuration. Every edge runs along X or Z.
 *
 * It is a separate graph from the waterside lane graph (`laneGraph.ts`): trucks
 * never enter the waterside network and SHCs never use the gate (invariant
 * `landside.segregation`). Every node and zone id here starts with `ls:`
 * (except the transfer stalls, which are `<block>-TS<n>`).
 *
 * Plan view, Z grows landside (west on the left):
 *
 *   gate                              blocks (stalls at their landside end)
 *   ┌───────────────┐
 *   │ in … OOG out … │  kiosks at zK, queue behind the in lanes (+Z)
 *   └───────────────┘
 *   RO westbound ◄────────────────────────────────────────┐  z = roadOutZ
 *   RI eastbound ─────┬───────┬───────┬──────────────────►┘  z = roadInZ
 *                     │ spur  │ spur  │      (one spur per transfer stall)
 *                    stall   stall   stall                   z = stall Z
 *
 * An inbound truck leaves its in lane onto the eastbound road, turns into the
 * spur of its stall (drives in cab first), and reverses out after the
 * interchange. It continues east to the end connector, returns on the westbound
 * road and leaves through an out lane. The out-of-gauge (OOG) lane between the
 * in and out lanes is drawn but never used.
 */
import { shortestPath, type PathGraph } from './laneGraph'
import { blockSpecs, transferStallLayout, type TransferStallLayout } from './yardLayout'
import type { GateConfig, ScenarioConfig } from '../scenario/types'

export const DEFAULT_GATE_LAYOUT: GateConfig = { inLanes: 4, outLanes: 4, inProcessingS: 40, outProcessingS: 20, processingVariationPct: 0, oogLane: true }

/** Width of a gate truck lane (m): 3.5 m [V] (TT-28 gate modules use the same). */
export const GATE_LANE_W_M = 3.5
/** Width of the out-of-gauge lane (m): 8 m [V]. */
export const GATE_OOG_LANE_W_M = 8
/** [A] Width of the concrete island (kiosk pedestal) between two neighbouring gate lanes (m). */
export const GATE_ISLAND_W_M = 1.2
/** [A] Distance kept between consecutive trucks of the gate queue (head to head, m). */
export const QUEUE_PITCH_M = 19
/** [A] Distance a vehicle reserves before and after a conflict point (m): roughly a truck length. */
export const TRUCK_ZONE_CLEARANCE_M = 10
/** Gap between the road and the stalls' spur junctions, and between the two roads (m). */
const ROAD_GAP_M = 10
const ROAD_PITCH_M = 8
/** Gate kiosks sit this far landside of the outbound road, lane entries / exits this far (m). */
const KIOSK_DZ = 14
const ENTRY_DZ = 26
const DESPAWN_DZ = 60
/** Distance west of the first block that the gate cluster ends (m). */
const GATE_WEST_GAP_M = 40
/** [A] Pitch of the holding positions along the inbound road (m): the stall pitch. */
export const HOLDING_PITCH_M = 5.5
/** First holding spur this far west of the westmost stall spur, and the gate cluster keeps this clear of the last one (m). */
const HOLDING_EAST_GAP_M = 8
const HOLDING_WEST_CLEAR_M = 12
/** The roads extend this far east of the last block (m). */
const ROAD_EAST_GAP_M = 20

export type LandsideNodeKind = 'road' | 'queue' | 'inEntry' | 'inKiosk' | 'outKiosk' | 'outExit' | 'despawn' | 'stall' | 'holding'

export interface LandsideNode {
  id: string
  x: number
  z: number
  kind: LandsideNodeKind
  zone: string | null
}

export interface LandsideEdge {
  from: string
  to: string
  lengthM: number
  axis: 'x' | 'z'
  zone: string | null
}

export interface LandsideZone {
  id: string
  kind: 'intersection' | 'road' | 'stall' | 'gateLane' | 'holding'
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface GateLaneLayout {
  id: string
  index: number
  direction: 'in' | 'out'
  x: number
  /** Where the truck waits for processing (in: before the kiosk node is reached; out: at the kiosk). */
  kioskNode: string
  /** In lanes: first node of the lane (queue side); out lanes: where the truck leaves the lane. */
  endNode: string
  /** In lanes: the queue-side waypoint above the lane (QL); out lanes: the road node the lane starts at. */
  approachNode: string
  kioskZ: number
}

/** A holding position (TT-R16): a dead-end spur off the inbound road, west of every stall spur. */
export interface HoldingLayout {
  /** `H<n>`; its node is `ls:H<n>`. */
  id: string
  x: number
  z: number
  nodeId: string
  /** The road node its spur starts at. */
  junction: string
}

export interface LandsideGraph {
  layout: { zoneClearanceM: number }
  nodes: Record<string, LandsideNode>
  edges: LandsideEdge[]
  out: Record<string, LandsideEdge[]>
  zones: Record<string, LandsideZone>
  stalls: TransferStallLayout[]
  /** Stall id → its node (the truck centre when parked). */
  stallNode: Record<string, string>
  /** Stall id → the road node its spur starts at. */
  stallJunction: Record<string, string>
  /** Holding positions (empty without `config.landside.holding`). */
  holding: HoldingLayout[]
  inLanes: GateLaneLayout[]
  outLanes: GateLaneLayout[]
  /** Out-of-gauge lane centre X (rendered, never routed); null when disabled. */
  oogX: number | null
  gate: {
    /** Centre of the in-lane cluster: the queue lies along Z at this X. */
    queueX: number
    /** Z of the first queue slot (the head of the queue, nearest the lanes). */
    queueHeadZ: number
    /** Z where trucks join the queue from (beyond the last slot they are not drawn). */
    spawnZ: number
    kioskZ: number
    entryZ: number
    roadInZ: number
    roadOutZ: number
    westX: number
    eastX: number
    /** The single node trucks start the trip to a lane from. */
    queueHeadNode: string
  }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const roadId = (dir: 'I' | 'O', x: number) => `ls:R${dir}@${r3(x)}`

/** Z of queue slot `index` (0 = the head). */
export const queueSlotZ = (g: LandsideGraph, index: number): number => r3(g.gate.queueHeadZ + index * QUEUE_PITCH_M)

export function gateOf(config: ScenarioConfig): GateConfig {
  return { ...DEFAULT_GATE_LAYOUT, ...config.landside?.gate }
}

/** True when the scenario can have a landside: it is configured and some block has transfer stalls. */
export function hasLandside(config: ScenarioConfig): boolean {
  return !!config.landside && blockSpecs(config).some((b) => b.transferStalls > 0)
}

export function buildLandsideGraph(config: ScenarioConfig): LandsideGraph {
  const gate = gateOf(config)
  const blocks = blockSpecs(config)
  const stalls = blocks.flatMap(transferStallLayout)
  const nodes: Record<string, LandsideNode> = {}
  const edges: LandsideEdge[] = []
  const zones: Record<string, LandsideZone> = {}
  const node = (id: string, x: number, z: number, kind: LandsideNodeKind, zone: string | null) => {
    nodes[id] = { id, x: r3(x), z: r3(z), kind, zone }
  }
  const edge = (from: string, to: string, zone: string | null = null) => {
    const a = nodes[from]
    const b = nodes[to]
    if (a.x !== b.x && a.z !== b.z) throw new Error(`Landside edge ${from} → ${to} is not axis-aligned`)
    edges.push({ from, to, lengthM: r3(Math.abs(b.x - a.x) + Math.abs(b.z - a.z)), axis: a.z === b.z ? 'x' : 'z', zone })
  }
  const zone = (id: string, kind: LandsideZone['kind'], x0: number, x1: number, z0: number, z1: number) => {
    zones[id] = { id, kind, x0: r3(x0), x1: r3(x1), z0: r3(z0), z1: r3(z1) }
  }

  const stallZmax = Math.max(...stalls.map((s) => s.z))
  const roadInZ = r3(stallZmax + ROAD_GAP_M)
  const roadOutZ = r3(roadInZ + ROAD_PITCH_M)
  const kioskZ = r3(roadOutZ + KIOSK_DZ)
  const entryZ = r3(roadOutZ + ENTRY_DZ)
  const despawnZ = r3(roadOutZ + DESPAWN_DZ)
  const queueHeadZ = r3(entryZ + 8)
  const minX = Math.min(...stalls.map((s) => s.x)) - 3
  const maxX = Math.max(...stalls.map((s) => s.x)) + 3
  const holdingCount = Math.max(0, Math.floor(config.landside?.holding?.positions ?? 0))
  // holding spurs lie between the gate and the first stall spur: widen that gap only when holding is configured
  const westGap = holdingCount > 0 ? Math.max(GATE_WEST_GAP_M, HOLDING_EAST_GAP_M + HOLDING_WEST_CLEAR_M + holdingCount * HOLDING_PITCH_M) : GATE_WEST_GAP_M
  const clusterRight = minX - westGap
  // lane centres west to east: in lanes, the out-of-gauge lane, out lanes, an island between neighbours; the last lane ends the cluster
  const widths = [
    ...Array<number>(gate.inLanes).fill(GATE_LANE_W_M),
    ...(gate.oogLane === false ? [] : [GATE_OOG_LANE_W_M]),
    ...Array<number>(gate.outLanes).fill(GATE_LANE_W_M),
  ]
  const centres: number[] = []
  {
    let x = clusterRight
    for (let i = widths.length - 1; i >= 0; i--) {
      centres[i] = x
      if (i > 0) x -= widths[i] / 2 + GATE_ISLAND_W_M + widths[i - 1] / 2
    }
  }
  const laneX = (i: number) => r3(centres[i])
  const inX = (k: number) => laneX(k)
  const oogX = gate.oogLane === false ? null : laneX(gate.inLanes)
  const outX = (j: number) => laneX(gate.inLanes + (oogX === null ? 0 : 1) + j)
  const eastX = r3(maxX + ROAD_EAST_GAP_M)
  const queueX = r3((inX(0) + inX(gate.inLanes - 1)) / 2)

  // road X positions
  const riXs = new Set<number>()
  for (let k = 0; k < gate.inLanes; k++) riXs.add(inX(k))
  for (const s of stalls) riXs.add(s.x)
  riXs.add(eastX)
  const firstStallX = Math.min(...stalls.map((s) => s.x))
  const holdingXs = Array.from({ length: holdingCount }, (_, k) => r3(firstStallX - HOLDING_EAST_GAP_M - k * HOLDING_PITCH_M))
  for (const x of holdingXs) riXs.add(x)
  const roIds = new Set<number>()
  for (let j = 0; j < gate.outLanes; j++) roIds.add(outX(j))
  roIds.add(eastX)
  const riSorted = [...riXs].sort((a, b) => a - b)
  const roSorted = [...roIds].sort((a, b) => a - b)

  for (const x of riSorted) node(roadId('I', x), x, roadInZ, 'road', roadId('I', x))
  for (const x of roSorted) node(roadId('O', x), x, roadOutZ, 'road', roadId('O', x))
  for (const x of riSorted) zone(roadId('I', x), 'intersection', x - 2, x + 2, roadInZ - 2, roadInZ + 2)
  for (const x of roSorted) zone(roadId('O', x), 'intersection', x - 2, x + 2, roadOutZ - 2, roadOutZ + 2)
  // eastbound inbound road; each section is a conflict zone
  for (let i = 0; i + 1 < riSorted.length; i++) {
    const id = `ls:SI@${riSorted[i]}`
    zone(id, 'road', riSorted[i] + 2, riSorted[i + 1] - 2, roadInZ - 2, roadInZ + 2)
    edge(roadId('I', riSorted[i]), roadId('I', riSorted[i + 1]), id)
  }
  // end connector
  node('ls:end', eastX, r3((roadInZ + roadOutZ) / 2), 'road', null)
  zone('ls:end', 'road', eastX - 2, eastX + 2, roadInZ + 2, roadOutZ - 2)
  edge(roadId('I', eastX), 'ls:end', 'ls:end')
  edge('ls:end', roadId('O', eastX), 'ls:end')
  // westbound outbound road
  for (let i = roSorted.length - 1; i > 0; i--) {
    const id = `ls:SO@${roSorted[i - 1]}`
    zone(id, 'road', roSorted[i - 1] + 2, roSorted[i] - 2, roadOutZ - 2, roadOutZ + 2)
    edge(roadId('O', roSorted[i]), roadId('O', roSorted[i - 1]), id)
  }

  // transfer stalls: a spur off the inbound road, in and out (the truck reverses out)
  const stallNode: Record<string, string> = {}
  const stallJunction: Record<string, string> = {}
  for (const s of stalls) {
    node(`ls:${s.id}`, s.x, s.z, 'stall', s.id)
    stallNode[s.id] = `ls:${s.id}`
    stallJunction[s.id] = roadId('I', s.x)
    zone(s.id, 'stall', s.x - 1.8, s.x + 1.8, s.z - 8.5, roadInZ + 2)
    edge(roadId('I', s.x), `ls:${s.id}`, s.id)
    edge(`ls:${s.id}`, roadId('I', s.x), s.id)
  }

  // holding positions: a spur off the inbound road west of every stall spur (so a truck can reach every stall from
  // any of them), in and out (the truck reverses out); they never lie on a road, a junction or a gate exit
  const holding: HoldingLayout[] = holdingXs.map((x, k) => {
    const id = `H${k + 1}`
    const z = r3(stallZmax)
    node(`ls:${id}`, x, z, 'holding', id)
    zone(id, 'holding', x - 1.8, x + 1.8, z - 8.5, roadInZ + 2)
    edge(roadId('I', x), `ls:${id}`, id)
    edge(`ls:${id}`, roadId('I', x), id)
    return { id, x, z, nodeId: `ls:${id}`, junction: roadId('I', x) }
  })

  // gate: in lanes (queue → entry → kiosk → inbound road), out lanes (outbound road → kiosk → exit → despawn)
  node('ls:QH', queueX, queueHeadZ, 'queue', null)
  const inLanes: GateLaneLayout[] = []
  for (let k = 0; k < gate.inLanes; k++) {
    const x = inX(k)
    const lane = `ls:GI${k + 1}`
    node(`ls:QL${k + 1}`, x, queueHeadZ, 'queue', null)
    node(`ls:IE${k + 1}`, x, entryZ, 'inEntry', lane)
    node(`ls:IK${k + 1}`, x, kioskZ, 'inKiosk', lane)
    zone(lane, 'gateLane', x - GATE_LANE_W_M / 2 + 0.3, x + GATE_LANE_W_M / 2 - 0.3, roadInZ, entryZ)
    edge('ls:QH', `ls:QL${k + 1}`)
    edge(`ls:QL${k + 1}`, `ls:IE${k + 1}`)
    edge(`ls:IE${k + 1}`, `ls:IK${k + 1}`, lane)
    edge(`ls:IK${k + 1}`, roadId('I', x), lane)
    inLanes.push({ id: lane, index: k, direction: 'in', x, kioskNode: `ls:IK${k + 1}`, endNode: roadId('I', x), approachNode: `ls:QL${k + 1}`, kioskZ })
  }
  const outLanes: GateLaneLayout[] = []
  for (let j = 0; j < gate.outLanes; j++) {
    const x = outX(j)
    const lane = `ls:GO${j + 1}`
    node(`ls:OK${j + 1}`, x, kioskZ, 'outKiosk', lane)
    node(`ls:OX${j + 1}`, x, entryZ, 'outExit', lane)
    node(`ls:OD${j + 1}`, x, despawnZ, 'despawn', null)
    zone(lane, 'gateLane', x - GATE_LANE_W_M / 2 + 0.3, x + GATE_LANE_W_M / 2 - 0.3, roadOutZ, entryZ)
    edge(roadId('O', x), `ls:OK${j + 1}`, lane)
    edge(`ls:OK${j + 1}`, `ls:OX${j + 1}`, lane)
    edge(`ls:OX${j + 1}`, `ls:OD${j + 1}`)
    outLanes.push({ id: lane, index: j, direction: 'out', x, kioskNode: `ls:OK${j + 1}`, endNode: `ls:OD${j + 1}`, approachNode: roadId('O', x), kioskZ })
  }

  const out: Record<string, LandsideEdge[]> = {}
  for (const id of Object.keys(nodes)) out[id] = []
  for (const e of edges) out[e.from].push(e)
  return {
    layout: { zoneClearanceM: TRUCK_ZONE_CLEARANCE_M },
    nodes,
    edges,
    out,
    zones,
    stalls,
    stallNode,
    stallJunction,
    holding,
    inLanes,
    outLanes,
    oogX,
    gate: {
      queueX,
      queueHeadZ,
      spawnZ: r3(queueHeadZ + 12 * QUEUE_PITCH_M),
      kioskZ,
      entryZ,
      roadInZ,
      roadOutZ,
      westX: laneX(0),
      eastX,
      queueHeadNode: 'ls:QH',
    },
  }
}

const cache = new WeakMap<ScenarioConfig, LandsideGraph>()

/** The (cached) landside graph of a config object. Do not mutate a config after creating a simulation from it. */
export function landsideGraphOf(config: ScenarioConfig): LandsideGraph {
  let g = cache.get(config)
  if (!g) {
    g = buildLandsideGraph(config)
    cache.set(config, g)
  }
  return g
}

/** Route over the landside roads; throws if there is none. */
export function landsideRoute(graph: LandsideGraph, from: string, to: string): string[] {
  const path = shortestPath(graph as PathGraph, from, to)
  if (!path) throw new Error(`No landside route ${from} → ${to}`)
  return path
}
