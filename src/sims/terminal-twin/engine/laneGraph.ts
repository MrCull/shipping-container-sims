/**
 * Waterside lane graph (TT-05): a one-way graph generated from the scenario
 * config, used by SHC routing, conflict-zone reservations and the 3D lane
 * overlay. Pure and deterministic; every edge runs along X or Z.
 *
 * STS cranes travel the whole quay (TT-09), so the STS ground lanes are
 * continuous along it. Layout from water to land (Z grows landside):
 *
 *   STS lanes   one per ground-position lane j, Z = stsGroundLaneZ0M + j × spacing,
 *               one-way +X from before the quay start to past its end. A box
 *               grounded at X lies on lane j at X; an SHC picks it up there.
 *   stations    every `stationSpacingM` along the quay: a down spine at x_k
 *               (westbound apron → lane J … lane 1, nodes `D<k>:<j>`) and an up
 *               spine at x_k + 5 (lane 1 … lane J → westbound apron, `U<k>:<j>`).
 *               SHCs enter a lane at a down spine and leave at an up spine.
 *   westbound apron lane (-X) Z = westboundZ; eastbound (+X) Z = eastboundZ;
 *               crossovers both ways at every apron X (they make the loop).
 *   WTP spurs   eastbound node → pad clear position C → WTP pad P and back.
 *   parking     spurs off the eastbound lane, west of everything, one per SHC.
 *
 * Conflict zones: every apron and spine node (intersections), every STS lane
 * section between two lane nodes (`L<j>@<x>`; the STS reserves the sections it
 * sets a box down in), and each WTP pad with its spur.
 */
import type { ApronLayout, ScenarioConfig } from '../scenario/types'

export const DEFAULT_APRON_LAYOUT: ApronLayout = {
  westboundZ: 40,
  eastboundZ: 46,
  padClearZ: 52,
  parkingZ: 54,
  wtpZ: 64,
  padPitchM: 5.5,
  stationSpacingM: 25,
  parkingPitchM: 6,
  zoneClearanceM: 4,
}

/** Offset of a station's up spine from its down spine (m). */
const UP_SPINE_OFFSET_M = 5
/** STS lanes start this far before the quay and end this far past it (m). */
const LANE_MARGIN_M = 15

export type LaneNodeKind = 'apron' | 'laneDown' | 'laneUp' | 'padClear' | 'wtpPad' | 'parking'

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

export type ConflictZoneKind = 'intersection' | 'stsLane' | 'wtpPad'

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
  /** Z of each STS lane (index = ground-position lane). */
  laneZ: number[]
  /** Nodes of each STS lane in driving order (+X): D0, U0, D1, U1, … */
  laneNodes: string[][]
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

/** Throws if the STS lanes would run into the apron lanes (too many ground positions for SHCs). */
export function validateLaneLayout(config: ScenarioConfig): void {
  const layout = apronLayout(config)
  const lanes = Math.max(0, ...config.sts.map((s) => s.groundPositions))
  const lastZ = config.layout.stsGroundLaneZ0M + (lanes - 1) * config.layout.stsGroundLaneSpacingM
  if (lanes > 0 && lastZ + 3 > layout.westboundZ)
    throw new Error(
      `With SHCs, STS ground lanes must stay clear of the apron: ${lanes} lanes reach Z ${lastZ} m, ` +
        `the westbound apron lane is at Z ${layout.westboundZ} m (use fewer ground positions per STS)`,
    )
}

export function buildLaneGraph(config: ScenarioConfig): LaneGraph {
  const layout = apronLayout(config)
  const nodes: Record<string, LaneNode> = {}
  const edges: LaneEdge[] = []
  const zones: Record<string, ConflictZone> = {}
  const { stsGroundLaneZ0M: z0, stsGroundLaneSpacingM: dz } = config.layout
  const lanes = Math.max(0, ...config.sts.map((s) => s.groundPositions))
  const graph: LaneGraph = {
    layout,
    nodes,
    edges,
    out: {},
    zones,
    pads: wtpPadLayout(config),
    laneZ: Array.from({ length: lanes }, (_, j) => z0 + j * dz),
    laneNodes: Array.from({ length: lanes }, () => []),
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
    if (a.x !== b.x && a.z !== b.z) throw new Error(`Lane edge ${from} → ${to} is not axis-aligned`)
    edges.push({ from, to, lengthM: r3(Math.abs(b.x - a.x) + Math.abs(b.z - a.z)), axis: a.z === b.z ? 'x' : 'z', kind, zone })
  }

  // Stations along the quay.
  const stations: number[] = []
  if (lanes > 0)
    for (let x = -LANE_MARGIN_M; ; x += layout.stationSpacingM) {
      stations.push(r3(x))
      if (x >= config.quay.lengthM + LANE_MARGIN_M) break
    }

  // Apron X positions: spines, pads, parking spots.
  const xs = new Set<number>()
  for (const x of stations) {
    xs.add(x)
    xs.add(r3(x + UP_SPINE_OFFSET_M))
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

  // STS lanes and spines.
  stations.forEach((x, k) => {
    for (let j = 0; j < lanes; j++) {
      node(`D${k}:${j + 1}`, x, graph.laneZ[j], 'laneDown', `D${k}:${j + 1}`)
      node(`U${k}:${j + 1}`, x + UP_SPINE_OFFSET_M, graph.laneZ[j], 'laneUp', `U${k}:${j + 1}`)
      graph.laneNodes[j].push(`D${k}:${j + 1}`, `U${k}:${j + 1}`)
    }
    edge(apronId('W', x), `D${k}:${lanes}`, 'spine')
    for (let j = lanes; j > 1; j--) edge(`D${k}:${j}`, `D${k}:${j - 1}`, 'spine')
    for (let j = 1; j < lanes; j++) edge(`U${k}:${j}`, `U${k}:${j + 1}`, 'spine')
    edge(`U${k}:${lanes}`, apronId('W', r3(x + UP_SPINE_OFFSET_M)), 'spine')
  })
  graph.laneNodes.forEach((list, j) => {
    for (let i = 0; i + 1 < list.length; i++) {
      const a = nodes[list[i]]
      const b = nodes[list[i + 1]]
      const zone = `L${j + 1}@${a.x}`
      zones[zone] = { id: zone, kind: 'stsLane', x0: a.x + half, x1: b.x - half, z0: a.z - 1.5, z1: a.z + 1.5 }
      edge(a.id, b.id, 'stsLane', zone)
    }
  })

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

/**
 * How an SHC reaches a box at `x` on STS lane `lane` (0-based): enter at the
 * last down spine before it, drive +X, leave at the first up spine after it.
 * `walk` = lane nodes from entry to exit; the box lies between `walk[before]`
 * and `walk[before + 1]`.
 */
export function laneAccess(graph: LaneGraph, lane: number, x: number): { walk: string[]; before: number } {
  const list = graph.laneNodes[lane]
  if (!list || list.length === 0) throw new Error(`No STS lane ${lane + 1} in the lane graph`)
  const at = (id: string) => graph.nodes[id].x
  let entry = 0
  for (let i = 0; i < list.length; i += 2) if (at(list[i]) <= x - 1) entry = i
  let exit = list.length - 1
  for (let i = list.length - 1; i >= 1; i -= 2) if (at(list[i]) >= x + 1) exit = i
  const walk = list.slice(entry, exit + 1)
  let before = 0
  for (let i = 0; i < walk.length - 1; i++) if (at(walk[i]) <= x) before = i
  return { walk, before }
}

/** Conflict zones (lane sections and lane nodes) of STS lane `lane` within `halfLength` of `x`. */
export function laneZonesAt(graph: LaneGraph, lane: number, x: number, halfLength: number): string[] {
  const list = graph.laneNodes[lane] ?? []
  const lo = x - halfLength
  const hi = x + halfLength
  const out: string[] = []
  for (let i = 0; i < list.length; i++) {
    const a = graph.nodes[list[i]]
    if (a.x >= lo && a.x <= hi && a.zone) out.push(a.zone)
    const b = list[i + 1] ? graph.nodes[list[i + 1]] : null
    if (b && a.x < hi && b.x > lo) out.push(`L${lane + 1}@${a.x}`)
  }
  return out
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
  // Dijkstra with a binary heap of [distance, node id].
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, string>()
  const heap: [number, string][] = [[0, from]]
  const less = (a: [number, string], b: [number, string]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
  const push = (item: [number, string]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!less(heap[i], heap[p])) break
      ;[heap[i], heap[p]] = [heap[p], heap[i]]
      i = p
    }
  }
  const pop = (): [number, string] | undefined => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length > 0 && last) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && less(heap[l], heap[m])) m = l
        if (r < heap.length && less(heap[r], heap[m])) m = r
        if (m === i) break
        ;[heap[i], heap[m]] = [heap[m], heap[i]]
        i = m
      }
    }
    return top
  }
  const done = new Set<string>()
  for (let item = pop(); item; item = pop()) {
    const [d, id] = item
    if (done.has(id)) continue
    done.add(id)
    if (id === to) break
    for (const e of graph.out[id]) {
      const nd = d + e.lengthM
      const cur = dist.get(e.to)
      if (cur === undefined || nd < cur - 1e-9) {
        dist.set(e.to, nd)
        prev.set(e.to, id)
        push([nd, e.to])
      }
    }
  }
  let path: string[] | null = null
  if (done.has(to)) {
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
