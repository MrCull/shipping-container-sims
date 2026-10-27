/**
 * Waterside lane graph (TT-05): a one-way graph generated from the scenario
 * config, used by SHC routing, conflict-zone reservations and the 3D lane
 * overlay. Pure and deterministic; every edge runs along X or Z.
 *
 * Layout from water to land (Z grows landside):
 *
 *   STS lanes   Z = stsGroundLaneZ0M + lane × spacing, one-way +X under each
 *               crane: entry E → ground position G → exit X.
 *               Entry spine runs down (-Z) from the westbound apron lane,
 *               exit spine runs up (+Z) to it.
 *   westbound apron lane (-X)   Z = westboundZ
 *   eastbound apron lane (+X)   Z = eastboundZ
 *               crossovers both ways at every apron X (they make the loop)
 *   WTP spurs   eastbound node → pad clear position C → WTP pad P and back
 *               (the SHC drives in, sets down, and reverses clear to C)
 *   parking     spurs off the eastbound lane, west of everything, one per SHC
 *
 * Conflict zones: every apron node and spine node (intersections), each
 * ground position's lane section E→X, and each WTP pad with its spur.
 */
import type { ApronLayout, ScenarioConfig } from '../scenario/types'

export const DEFAULT_APRON_LAYOUT: ApronLayout = {
  westboundZ: 40,
  eastboundZ: 46,
  padClearZ: 52,
  parkingZ: 54,
  wtpZ: 64,
  padPitchM: 5.5,
  stsLaneHalfSpanM: 30,
  parkingPitchM: 6,
  zoneClearanceM: 4,
}

export type LaneNodeKind =
  | 'apron'
  | 'stsLaneEntry'
  | 'groundPosition'
  | 'stsLaneExit'
  | 'padClear'
  | 'wtpPad'
  | 'parking'

export interface LaneNode {
  id: string
  x: number
  z: number
  kind: LaneNodeKind
  /** Conflict zone this node belongs to (null = free). */
  zone: string | null
}

export type LaneEdgeKind = 'apron' | 'crossover' | 'spine' | 'stsLane' | 'wtpSpur' | 'parkingSpur'

export interface LaneEdge {
  from: string
  to: string
  lengthM: number
  axis: 'x' | 'z'
  kind: LaneEdgeKind
  zone: string | null
}

export type ConflictZoneKind = 'intersection' | 'groundPosition' | 'wtpPad'

export interface ConflictZone {
  id: string
  kind: ConflictZoneKind
  /** Plan rectangle (for overlays). */
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface WtpPadLayout {
  id: string
  blockId: string
  index: number
  x: number
  z: number
}

export interface LaneGraph {
  layout: ApronLayout
  nodes: Record<string, LaneNode>
  edges: LaneEdge[]
  /** Outgoing edges per node id, in a deterministic order. */
  out: Record<string, LaneEdge[]>
  zones: Record<string, ConflictZone>
  pads: WtpPadLayout[]
  /** Ground position id → its pickup node. */
  groundPositionNode: Record<string, string>
  /** Ground position id → [lane entry X, lane exit X] (an SHC positions within it). */
  groundPositionSpan: Record<string, [number, number]>
  padNode: Record<string, string>
  padClearNode: Record<string, string>
  /** SHC id → its parking spot node. */
  parkingNode: Record<string, string>
}

export function apronLayout(config: ScenarioConfig): ApronLayout {
  return { ...DEFAULT_APRON_LAYOUT, ...config.apron }
}

export function wtpPadId(blockId: string, index: number): string {
  return `${blockId}-WTP${index + 1}`
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const apronId = (dir: 'W' | 'E', x: number) => `A${dir}@${r3(x)}`

/** WTP pads of every block, centred on the block across X. */
export function wtpPadLayout(config: ScenarioConfig): WtpPadLayout[] {
  const layout = apronLayout(config)
  const pads: WtpPadLayout[] = []
  for (const b of config.yard?.blocks ?? []) {
    for (let k = 0; k < b.wtpPads; k++) {
      pads.push({
        id: wtpPadId(b.id, k),
        blockId: b.id,
        index: k,
        x: r3(b.x + (k - (b.wtpPads - 1) / 2) * layout.padPitchM),
        z: layout.wtpZ,
      })
    }
  }
  return pads
}

export function buildLaneGraph(config: ScenarioConfig): LaneGraph {
  const layout = apronLayout(config)
  const nodes: Record<string, LaneNode> = {}
  const edges: LaneEdge[] = []
  const zones: Record<string, ConflictZone> = {}
  const graph: LaneGraph = {
    layout,
    nodes,
    edges,
    out: {},
    zones,
    pads: wtpPadLayout(config),
    groundPositionNode: {},
    groundPositionSpan: {},
    padNode: {},
    padClearNode: {},
    parkingNode: {},
  }
  const half = 2
  const node = (id: string, x: number, z: number, kind: LaneNodeKind, zone: string | null) => {
    nodes[id] = { id, x: r3(x), z: r3(z), kind, zone }
    if (zone === id) zones[id] = { id, kind: 'intersection', x0: x - half, x1: x + half, z0: z - half, z1: z + half }
  }
  const edge = (from: string, to: string, kind: LaneEdgeKind, zone: string | null = null) => {
    const a = nodes[from]
    const b = nodes[to]
    const axis = a.z === b.z ? 'x' : 'z'
    if (a.x !== b.x && a.z !== b.z) throw new Error(`Lane edge ${from} → ${to} is not axis-aligned`)
    edges.push({ from, to, lengthM: r3(Math.abs(b.x - a.x) + Math.abs(b.z - a.z)), axis, kind, zone })
  }

  // Apron X positions: STS lane ends, pads, parking spots.
  const xs = new Set<number>()
  const { stsGroundLaneZ0M: z0, stsGroundLaneSpacingM: dz } = config.layout
  for (const s of config.sts) {
    xs.add(r3(s.gantryX - layout.stsLaneHalfSpanM))
    xs.add(r3(s.gantryX + layout.stsLaneHalfSpanM))
  }
  for (const p of graph.pads) xs.add(p.x)
  const shcs = config.shcs ?? []
  const westmost = Math.min(...xs, Infinity)
  const parkingX = (i: number) => r3((Number.isFinite(westmost) ? westmost : 0) - 20 - i * layout.parkingPitchM)
  shcs.forEach((_, i) => xs.add(parkingX(i)))
  const sorted = [...xs].sort((a, b) => a - b)

  for (const x of sorted) {
    node(apronId('W', x), x, layout.westboundZ, 'apron', apronId('W', x))
    node(apronId('E', x), x, layout.eastboundZ, 'apron', apronId('E', x))
  }
  for (let i = 0; i + 1 < sorted.length; i++) {
    edge(apronId('E', sorted[i]), apronId('E', sorted[i + 1]), 'apron')
    edge(apronId('W', sorted[i + 1]), apronId('W', sorted[i]), 'apron')
  }
  for (const x of sorted) {
    edge(apronId('W', x), apronId('E', x), 'crossover')
    edge(apronId('E', x), apronId('W', x), 'crossover')
  }

  // STS lanes with entry and exit spines.
  for (const s of config.sts) {
    const ex = r3(s.gantryX - layout.stsLaneHalfSpanM)
    const xx = r3(s.gantryX + layout.stsLaneHalfSpanM)
    const lanes = s.groundPositions
    for (let j = 0; j < lanes; j++) {
      const z = z0 + j * dz
      const gpId = `${s.id}-GP${j + 1}`
      node(`E:${s.id}:${j + 1}`, ex, z, 'stsLaneEntry', `E:${s.id}:${j + 1}`)
      node(`G:${gpId}`, s.gantryX, z, 'groundPosition', gpId)
      node(`X:${s.id}:${j + 1}`, xx, z, 'stsLaneExit', `X:${s.id}:${j + 1}`)
      zones[gpId] = { id: gpId, kind: 'groundPosition', x0: ex + half, x1: xx - half, z0: z - 1.5, z1: z + 1.5 }
      graph.groundPositionNode[gpId] = `G:${gpId}`
      graph.groundPositionSpan[gpId] = [ex, xx]
      edge(`E:${s.id}:${j + 1}`, `G:${gpId}`, 'stsLane', gpId)
      edge(`G:${gpId}`, `X:${s.id}:${j + 1}`, 'stsLane', gpId)
    }
    if (lanes === 0) continue
    // Entry spine: westbound apron → highest lane → … → lane 1.
    edge(apronId('W', ex), `E:${s.id}:${lanes}`, 'spine')
    for (let j = lanes; j > 1; j--) edge(`E:${s.id}:${j}`, `E:${s.id}:${j - 1}`, 'spine')
    // Exit spine: lane 1 → … → highest lane → westbound apron.
    for (let j = 1; j < lanes; j++) edge(`X:${s.id}:${j}`, `X:${s.id}:${j + 1}`, 'spine')
    edge(`X:${s.id}:${lanes}`, apronId('W', xx), 'spine')
  }

  // WTP spurs.
  for (const p of graph.pads) {
    const c = `C:${p.id}`
    const pad = `P:${p.id}`
    node(c, p.x, layout.padClearZ, 'padClear', null)
    node(pad, p.x, p.z, 'wtpPad', p.id)
    zones[p.id] = { id: p.id, kind: 'wtpPad', x0: p.x - 1.6, x1: p.x + 1.6, z0: layout.padClearZ, z1: p.z + 6.5 }
    graph.padNode[p.id] = pad
    graph.padClearNode[p.id] = c
    edge(apronId('E', p.x), c, 'wtpSpur')
    edge(c, pad, 'wtpSpur', p.id)
    edge(pad, c, 'wtpSpur', p.id)
    edge(c, apronId('E', p.x), 'wtpSpur')
  }

  // Parking spurs.
  shcs.forEach((shc, i) => {
    const x = parkingX(i)
    const id = `S:${shc.id}`
    node(id, x, layout.parkingZ, 'parking', null)
    graph.parkingNode[shc.id] = id
    edge(apronId('E', x), id, 'parkingSpur')
    edge(id, apronId('E', x), 'parkingSpur')
  })

  for (const id of Object.keys(nodes)) graph.out[id] = []
  for (const e of edges) graph.out[e.from].push(e)
  return graph
}

const graphCache = new WeakMap<ScenarioConfig, LaneGraph>()
const pathCache = new WeakMap<LaneGraph, Map<string, string[] | null>>()

/** The (cached) lane graph of a config object. */
export function laneGraphOf(config: ScenarioConfig): LaneGraph {
  let g = graphCache.get(config)
  if (!g) {
    g = buildLaneGraph(config)
    graphCache.set(config, g)
  }
  return g
}

/** Shortest path (node ids, inclusive) by length; ties broken by node id. Null if unreachable. */
export function shortestPath(graph: LaneGraph, from: string, to: string): string[] | null {
  let cache = pathCache.get(graph)
  if (!cache) {
    cache = new Map()
    pathCache.set(graph, cache)
  }
  const key = `${from}>${to}`
  if (cache.has(key)) return cache.get(key) ?? null
  if (!graph.nodes[from] || !graph.nodes[to]) throw new Error(`shortestPath: unknown node ${graph.nodes[from] ? to : from}`)
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, string>()
  const done = new Set<string>()
  for (;;) {
    let best: string | null = null
    for (const [id, d] of dist) {
      if (done.has(id)) continue
      if (best === null || d < dist.get(best)! || (d === dist.get(best)! && id < best)) best = id
    }
    if (best === null) break
    if (best === to) break
    done.add(best)
    for (const e of graph.out[best]) {
      const nd = dist.get(best)! + e.lengthM
      const cur = dist.get(e.to)
      if (cur === undefined || nd < cur - 1e-9) {
        dist.set(e.to, nd)
        prev.set(e.to, best)
      }
    }
  }
  let path: string[] | null = null
  if (dist.has(to)) {
    path = [to]
    while (path[0] !== from) path.unshift(prev.get(path[0])!)
  }
  cache.set(key, path)
  return path
}

export function pathLength(graph: LaneGraph, path: string[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const a = graph.nodes[path[i - 1]]
    const b = graph.nodes[path[i]]
    total += Math.abs(b.x - a.x) + Math.abs(b.z - a.z)
  }
  return r3(total)
}

/** The edge from → to (throws if absent). */
export function edgeBetween(graph: LaneGraph, from: string, to: string): LaneEdge {
  const e = graph.out[from]?.find((x) => x.to === to)
  if (!e) throw new Error(`No lane edge ${from} → ${to}`)
  return e
}
