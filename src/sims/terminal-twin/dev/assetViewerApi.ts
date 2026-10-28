/**
 * Dev-only asset viewer API: `window.__ttAssets`, installed by dev/AssetViewer.vue
 * (open `/sim/terminal-twin?viewer=<asset>` or `?viewer=yard` in a dev build).
 *
 *   __ttAssets.list()                                   // asset names (GLB basenames)
 *   await __ttAssets.show('container-40', { lod: 'LOD0', livery: 2 })
 *   __ttAssets.setLod('LOD1' | 'auto'); __ttAssets.setLivery(4); __ttAssets.setRig('door_left', 180)
 *   __ttAssets.setLoad('40' | '20front' | '20rear' | '20twin' | 'none')  // trucks: reference boxes on the chassis; stats().load reports the pin fit
 *   __ttAssets.setStack(5)                              // ASC: reference stack height in tiers; stats().stack reports the fit
 *   __ttAssets.pose()                                   // world positions of the rig nodes + the reference container
 *   await __ttAssets.yard(18000)                        // instanced TTI-size yard: LOD split, draw calls, triangles, fps
 */
export type ViewerLod = 'LOD0' | 'LOD1' | 'LOD2' | 'auto'
/** Truck / chassis viewers: the reference boxes on the chassis (`20front`/`20rear` = a single 20 ft box on those pins, `20twin` = two end to end). */
export type ViewerLoad = 'none' | '40' | '40HC' | '20front' | '20rear' | '20twin'

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
  /** SHC assets: the 40 ft HC reference box inside the tunnel against the sidecar's clear width and height; null for other assets. */
  reference: {
    size: string
    lengthM: number
    widthM: number
    heightM: number
    /** Top of the box (the twist-lock plane while it hangs from the spreader). */
    topM: number
    clearWidthM: number
    clearHeightM: number
    fitsTunnel: boolean
  } | null
  /** Truck and chassis assets: reference boxes on the chassis against the sidecar's twist-lock pins; null for other assets. */
  load: {
    mode: ViewerLoad
    boxes: { size: string; centre: Vec3Tuple; bottomY: number }[]
    /** Casting centres of the boxes (ISO 1161). */
    castings: number
    /** Largest distance from a casting centre to the nearest chassis pin. */
    maxPinErrorM: number
    /** Every casting centre is on a pin and every box bottom is on the deck. */
    onPins: boolean
  } | null
  /** ASC assets: 8 rows of 40 ft high-cube reference boxes under the span; null for other assets. */
  stack: {
    rows: number
    tiers: number
    stackTopM: number
    /** Clear width between the leg inner faces. */
    clearSpanM: number
    /** Width of the 8 rows of boxes. */
    rowsWidthM: number
    /** Gap between the outer row and a leg, each side. */
    sideClearanceM: number
    underBridgeM: number
    /** With the hoist raised: carried box bottom minus stack top (positive = it passes over the stack). */
    carryClearanceM: number
    /** Carried box bottom at the current hoist slider value. */
    carriedBottomM: number
    /** Rows fit between the legs, a raised carried box clears the stack, and the stack is below the bridge. */
    fits: boolean
  } | null
}

export type Vec3Tuple = [number, number, number]

/** Where things are in the viewer (world metres, glTF axes). */
export interface AssetPose {
  shownLod: string
  /** World position of every rig node (sidecar `travelLimits` keys) in the shown LOD. */
  nodes: Record<string, Vec3Tuple>
  /** Current length (m) of each stretch node, e.g. STS hoist ropes. */
  stretch: Record<string, number>
  /** The reference container: hanging from the asset's `container` attach point (cranes), or standing beside it. */
  reference: { hangingFrom: string | null; size: Vec3Tuple; topCentre: Vec3Tuple }
  /** Highest point of the shown LOD (e.g. the STS boom tip when raised). */
  topY: number
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
  setStack(tiers: number): AssetViewStats
  /** Trucks and chassis: puts reference boxes on the chassis twist-locks. */
  setLoad(mode: ViewerLoad): AssetViewStats
  stats(): AssetViewStats | null
  pose(): AssetPose | null
  yard(count?: number): Promise<YardStats>
}

declare global {
  interface Window {
    __ttAssets?: AssetViewerApi
  }
}
