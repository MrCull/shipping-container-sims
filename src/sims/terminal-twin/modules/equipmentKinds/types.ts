/**
 * The equipment-kind registry's contract (V11-01). One module per kind (`sts.ts`, `shc.ts`, `asc.ts`, `truck.ts`,
 * `vessel.ts`) exports an `EquipmentKindDef`; `index.ts` lists them. The scene renderer, dev API, picking, labels
 * and inspector iterate the list, so adding a kind is a new module plus one entry there.
 */
import type * as THREE from 'three'
import type { EntityExtras, EntityView } from '../entityInspector'
import type { EntityBounds } from '../picking'
import type { SceneModel } from '../sceneModel'
import type { SceneStats } from '../sceneRenderer'

/** What a kind's renderer gets from the scene renderer when it is built. */
export interface KindRendererHost {
  readonly scene: THREE.Scene
  readonly model: SceneModel
  /** Dispose the thing when the scene is disposed. */
  track<T extends { dispose(): void }>(thing: T): T
  /** True once the scene has been disposed (async asset loads must not touch it then). */
  isDisposed(): boolean
}

/** Per-frame inputs, computed once by the scene renderer. */
export interface KindFrame {
  t: number
  cameraPosition: THREE.Vector3
  /** The quality profile's LOD distance scale. */
  lodScale: number
  /** Box height carried by each piece of equipment (by carrier id) this frame. */
  carried: ReadonlyMap<string, number>
  /** Boxes held per custody owner (`<ownerKind>:<ownerId>`), filled only when a renderer sets `wantsContainerOwners`. */
  loads: ReadonlyMap<string, { count: number; size: string }>
}

/** One kind's part of the 3D scene. Nothing here is reactive. */
export interface KindRenderer {
  /** Set when `KindFrame.loads` is needed (it costs a custody lookup per box per frame). */
  readonly wantsContainerOwners?: boolean
  update(frame: KindFrame): void
  /** Called once the phase 2 infrastructure models have loaded. */
  onInfrastructureLoaded?(): void
  /** Rig state per entity as last drawn (dev API `sceneState()[def.rigKey]`); empty until the GLB has loaded. */
  rigState(): Record<string, unknown>
  /** This kind's fields of `SceneStats`. */
  stats(): Partial<SceneStats>
  dispose(): void
}

export interface EquipmentKindDef<K extends string = string> {
  /** Entity kind: the inspector's `EntityKind`, the engine query kind and the `statusAt` kind. */
  kind: K
  /** Dev API `sceneState()` key for this kind's `{ status, ...pose }` per id (for example `shcs`). */
  sceneKey: string
  /** Dev API `sceneState()` key for this kind's rig state (for example `shcRigs`). */
  rigKey: string
  /** Gets a text label in the Labels overlay. */
  labelled: boolean
  /** Ids of this kind's entities in the scene model. */
  ids(model: SceneModel): string[]
  /** Oriented bounding box (picking, selection outline, labels); null when not in the scene at `time`. */
  bounds(model: SceneModel, id: string, time: number): EntityBounds | null
  /** Status and pose for the dev API. */
  sceneState(model: SceneModel, id: string, time: number): { status: string }
  /** Inspector view from the engine's query result. */
  describe(state: unknown, extras: EntityExtras): EntityView
  /** Extra engine query the inspector needs besides the entity's state (SHC: its job). */
  loadExtras?(state: unknown, query: <T>(kind: 'shcJobs') => Promise<T>): Promise<EntityExtras>
  createRenderer(host: KindRendererHost): KindRenderer
}
