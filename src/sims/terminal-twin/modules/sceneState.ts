/**
 * The scene state the dev API's `__tt.sceneState()` returns in the browser and the headless scene returns in Node
 * (`cli/headlessScene.ts`); both build it with `sceneStateOf` (`modules/sceneDriver.ts`).
 */
import type { CustodyRef } from '../engine'
import type { ColourBy, RobDisplay } from './colourBy'
import type { RenderedLivery } from './sceneRenderer'
import type { ShcRigState } from './shcAssets'
import type { TruckRigState } from './truckAssets'
import type { AscRigState } from './ascAssets'
import type { StsRenderState } from './stsAssets'
import type { VesselHullState } from './vesselRenderer'
import type { HatchRigState } from './equipmentKinds/hatch'
import type { AscPose, ShcPose, StsPose, TruckPose } from './sceneModel'

/**
 * What the dev API reports about the scene. The equipment-kind entries (`sts`, `shcs`, `ascs`, `trucks`, `vessels` and their
 * rig keys) are filled from the registry (`modules/equipmentKinds/`); a new kind appears under its own keys, typed here only if wanted.
 */
export interface SceneState {
  [kind: string]: unknown
  displayTime: number
  containers: Record<string, CustodyRef | null>
  sts: Record<string, { status: string; gantrying: boolean } & StsPose>
  shcs: Record<string, { status: string } & ShcPose>
  /** The ASCs of every yard block (1 or 2 each): status and spreader pose (gantry Z, trolley X, hoist height). */
  ascs: Record<string, { status: string; gantrying: boolean } & AscPose>
  /** Trucks in the scene (TT-13): status and pose; `visible` false once they have left. */
  trucks: Record<string, { status: string } & TruckPose>
  vessels: Record<string, { status: string }>
  /** Conflict zones reserved at the displayed time (zone → holder). */
  reservations: Record<string, string>
  /** Per container: livery atlas index, model size, LOD and centre actually drawn (phase 2 assets). */
  liveries: Record<string, RenderedLivery>
  /** Per SHC, the phase 2 rig as last drawn: LOD, steering, wheel roll, hoist travel, carrying (empty until the GLB loads). */
  shcRigs: Record<string, ShcRigState>
  /** Truck GLB rig state (LOD, cab shape, livery, steering, articulation, wheel roll, load offset) per visible truck. */
  truckRigs: Record<string, TruckRigState>
  /** Per ASC, the phase 2 rig as last drawn: LOD, gantry Z, trolley X, hoist travel, rope scale, vertical stretch, carrying (empty until the GLB loads). */
  ascRigs: Record<string, AscRigState>
  /** Per STS as drawn by the GLB model: LOD, spreader configuration (20 / 40 / twin-20), boxes carried, spreader and trolley world positions. */
  stsRendered: Record<string, StsRenderState>
  /** Per vessel: hull class, line, livery tile, name, hull LOD and the rendered bay grid (TT-27). */
  vesselHulls: Record<string, VesselHullState>
  /** Per hatch panel (TT-R10): engine-driven state and the centre (top face minus half the thickness) it should be drawn at, null while its vessel is not in the scene. */
  hatchPanels: Record<string, { status: string; x: number | null; y: number | null; z: number | null; lengthM: number | null; widthM: number | null; stsId: string | null }>
  /** Per hatch panel the renderer drew at the last frame: status and centre (absent while not drawn). */
  hatchRigs: Record<string, HatchRigState>
  /** Colour by mode and ROB display (#168, show, grey or hide) the 3D view and the bay viewer draw with. */
  colour: { mode: ColourBy; robDisplay: RobDisplay }
}
