/**
 * Dev-only asset viewer API: `window.__ttAssets`, installed by dev/AssetViewer.vue
 * (open `/sim/terminal-twin?viewer=<asset>` or `?viewer=yard` in a dev build).
 *
 *   __ttAssets.list()                                   // asset names (GLB basenames)
 *   await __ttAssets.show('container-40', { lod: 'LOD0', livery: 2 })
 *   __ttAssets.setLod('LOD1' | 'auto'); __ttAssets.setLivery(4); __ttAssets.setRig('door_left', 180)
 *   await __ttAssets.yard(18000)                        // instanced TTI-size yard: LOD split, draw calls, triangles, fps
 */
export type ViewerLod = 'LOD0' | 'LOD1' | 'LOD2' | 'auto'

export interface RigControl {
  node: string
  type: 'rotation' | 'translation'
  axis: string
  min: number
  max: number
  unit: 'deg' | 'm'
}

export interface AssetViewStats {
  asset: string
  kind: string
  /** Selected LOD ('auto' resolves by camera distance). */
  lod: ViewerLod
  /** LOD currently drawn. */
  shownLod: string
  /** Triangles and draw calls of the meshes drawn (the asset only, not the reference box). */
  triangles: number
  drawCalls: number
  lods: Record<string, { triangles: number; drawCalls: number }>
  rig: RigControl[]
  rigValues: Record<string, number>
  livery: number
  /** A procedural 20 ft reference container is shown beside the asset for scale. */
  referenceContainer: boolean
}

export interface YardStats {
  instances: number
  lod0: number
  lod1: number
  lod0Cap: number
  /** Container layers drawn (one InstancedMesh per size × LOD). */
  containerDrawCalls: number
  containerTriangles: number
  /** Whole frame, from renderer.info (main pass + shadow pass). */
  drawCalls: number
  triangles: number
  /** Frames per second measured over ~1.5 s (headless SwiftShader is far slower than a GPU). */
  fps: number
}

export interface AssetViewerApi {
  list(): string[]
  show(name: string, options?: { lod?: ViewerLod; livery?: number }): Promise<AssetViewStats>
  setLod(lod: ViewerLod): AssetViewStats
  setLivery(index: number): AssetViewStats
  setRig(node: string, value: number): AssetViewStats
  stats(): AssetViewStats | null
  yard(count?: number): Promise<YardStats>
}

declare global {
  interface Window {
    __ttAssets?: AssetViewerApi
  }
}
