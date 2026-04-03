// ---------------------------------------------------------------------------
// Box Empire — Terminal map / layout definition
// ---------------------------------------------------------------------------

import type { PathGraph, PathNode, PathEdge } from '../types'
import {
  GATE_POSITION,
  YARD_IO_POSITION,
  QUAY_BUFFER_POSITION,
  CRANE_POSITION,
} from './config'

const nodes: PathNode[] = [
  { id: 'gate', type: 'gate', position: { x: GATE_POSITION.x, z: GATE_POSITION.z } },
  { id: 'junction-1', type: 'junction', position: { x: -16, z: 32 } },
  { id: 'yard-io', type: 'yard_io', position: { x: YARD_IO_POSITION.x, z: YARD_IO_POSITION.z } },
  { id: 'junction-2', type: 'junction', position: { x: 0, z: 12 } },
  { id: 'quay-buffer', type: 'quay_buffer', position: { x: QUAY_BUFFER_POSITION.x, z: QUAY_BUFFER_POSITION.z } },
  { id: 'crane-base', type: 'crane_base', position: { x: CRANE_POSITION.x, z: CRANE_POSITION.z } },
]

function dist(a: PathNode, b: PathNode): number {
  const dx = a.position.x - b.position.x
  const dz = a.position.z - b.position.z
  return Math.sqrt(dx * dx + dz * dz)
}

function makeEdge(from: PathNode, to: PathNode, speedLimit: number): PathEdge {
  return { from: from.id, to: to.id, distance: dist(from, to), speedLimit }
}

const nodeMap = new Map<string, PathNode>()
nodes.forEach(n => nodeMap.set(n.id, n))

const n = (id: string) => nodeMap.get(id)!

const edges: PathEdge[] = [
  makeEdge(n('gate'), n('junction-1'), 8),
  makeEdge(n('junction-1'), n('gate'), 8),
  makeEdge(n('junction-1'), n('yard-io'), 6),
  makeEdge(n('yard-io'), n('junction-1'), 6),
  makeEdge(n('yard-io'), n('junction-2'), 5),
  makeEdge(n('junction-2'), n('yard-io'), 5),
  makeEdge(n('junction-2'), n('quay-buffer'), 5),
  makeEdge(n('quay-buffer'), n('junction-2'), 5),
  makeEdge(n('quay-buffer'), n('crane-base'), 3),
  makeEdge(n('crane-base'), n('quay-buffer'), 3),
]

export function getTerminalGraph(): PathGraph {
  return { nodes: new Map(nodeMap), edges: [...edges] }
}

export function getNodePosition(nodeId: string): { x: number; z: number } | null {
  const node = nodeMap.get(nodeId)
  return node ? { ...node.position } : null
}
