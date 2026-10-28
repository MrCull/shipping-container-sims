/**
 * Minimal GLB reader for the asset budget check: parses the JSON chunk only.
 * Triangle counts come from accessor counts, which EXT_meshopt_compression
 * keeps in the JSON, so no decoder (and no Blender) is needed.
 */
import { readFileSync } from 'node:fs'

export interface GltfNode {
  name?: string
  children?: number[]
  mesh?: number
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}
export interface GltfPrimitive {
  attributes: Record<string, number>
  indices?: number
  mode?: number
  material?: number
}
export interface GltfJson {
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: GltfNode[]
  meshes?: { name?: string; primitives: GltfPrimitive[] }[]
  accessors?: { count: number; componentType?: number; normalized?: boolean; min?: number[]; max?: number[] }[]
  materials?: { name?: string }[]
  images?: { mimeType?: string; uri?: string }[]
  buffers?: { uri?: string }[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a

export function readGlbJson(file: string): GltfJson {
  const buf = readFileSync(file)
  if (buf.length < 20 || buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file}: not a GLB file`)
  const len = buf.readUInt32LE(12)
  if (buf.readUInt32LE(16) !== CHUNK_JSON) throw new Error(`${file}: first GLB chunk is not JSON`)
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as GltfJson
}

/** Triangles of one primitive (triangle lists, strips and fans; points/lines count 0). */
export function primitiveTriangles(json: GltfJson, p: GltfPrimitive): number {
  const accessor = p.indices ?? p.attributes.POSITION
  const count = accessor === undefined ? 0 : (json.accessors?.[accessor]?.count ?? 0)
  const mode = p.mode ?? 4
  if (mode === 4) return Math.floor(count / 3)
  if (mode === 5 || mode === 6) return Math.max(0, count - 2)
  return 0
}

/** Triangles and draw calls (primitives) under a node, following children. */
export function subtreeStats(json: GltfJson, nodeIndex: number): { triangles: number; drawCalls: number } {
  let triangles = 0
  let drawCalls = 0
  const visit = (i: number) => {
    const n = json.nodes?.[i]
    if (!n) return
    if (n.mesh !== undefined) {
      for (const p of json.meshes?.[n.mesh]?.primitives ?? []) {
        triangles += primitiveTriangles(json, p)
        drawCalls++
      }
    }
    for (const c of n.children ?? []) visit(c)
  }
  visit(nodeIndex)
  return { triangles, drawCalls }
}
