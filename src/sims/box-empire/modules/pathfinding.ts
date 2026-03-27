// ---------------------------------------------------------------------------
// Box Empire — Pathfinding (Dijkstra on the terminal road graph)
// ---------------------------------------------------------------------------

import type { PathGraph, Position } from '../types'

interface DijkstraResult {
  path: string[]
  totalDistance: number
  totalTime: number
}

export function findShortestPath(
  graph: PathGraph,
  fromId: string,
  toId: string,
): DijkstraResult | null {
  if (fromId === toId) return { path: [fromId], totalDistance: 0, totalTime: 0 }

  const dist = new Map<string, number>()
  const prev = new Map<string, string | null>()
  const visited = new Set<string>()

  for (const id of graph.nodes.keys()) {
    dist.set(id, Infinity)
    prev.set(id, null)
  }
  dist.set(fromId, 0)

  while (true) {
    let current: string | null = null
    let currentDist = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        current = id
        currentDist = d
      }
    }
    if (current === null) break
    if (current === toId) break
    visited.add(current)

    for (const edge of graph.edges) {
      if (edge.from !== current) continue
      if (visited.has(edge.to)) continue
      const alt = currentDist + edge.distance
      if (alt < dist.get(edge.to)!) {
        dist.set(edge.to, alt)
        prev.set(edge.to, current)
      }
    }
  }

  if (dist.get(toId) === Infinity) return null

  const path: string[] = []
  let cur: string | null = toId
  while (cur) {
    path.unshift(cur)
    cur = prev.get(cur) ?? null
  }

  let totalTime = 0
  for (let i = 0; i < path.length - 1; i++) {
    const edge = graph.edges.find(e => e.from === path[i] && e.to === path[i + 1])
    if (edge) totalTime += edge.distance / edge.speedLimit
  }

  return { path, totalDistance: dist.get(toId)!, totalTime }
}

export function interpolateAlongPath(
  graph: PathGraph,
  pathNodeIds: string[],
  progress: number,
): Position {
  if (pathNodeIds.length === 0) return { x: 0, z: 0 }
  if (pathNodeIds.length === 1) {
    const node = graph.nodes.get(pathNodeIds[0])!
    return { ...node.position }
  }

  let totalDist = 0
  const segments: { from: Position; to: Position; dist: number }[] = []
  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    const from = graph.nodes.get(pathNodeIds[i])!.position
    const to = graph.nodes.get(pathNodeIds[i + 1])!.position
    const d = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2)
    segments.push({ from, to, dist: d })
    totalDist += d
  }

  const targetDist = progress * totalDist
  let accumulated = 0

  for (const seg of segments) {
    if (accumulated + seg.dist >= targetDist) {
      const t = seg.dist > 0 ? (targetDist - accumulated) / seg.dist : 0
      return {
        x: seg.from.x + (seg.to.x - seg.from.x) * t,
        z: seg.from.z + (seg.to.z - seg.from.z) * t,
      }
    }
    accumulated += seg.dist
  }

  const last = graph.nodes.get(pathNodeIds[pathNodeIds.length - 1])!
  return { ...last.position }
}
