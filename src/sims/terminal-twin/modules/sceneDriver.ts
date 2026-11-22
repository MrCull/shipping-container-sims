/**
 * The one scene-construction and frame-update path (#331, spec #320), shared by the browser's render loop
 * (`composables/useTwinScene.ts`) and the headless scene in Node (`cli/headlessScene.ts`). The browser attaches a
 * WebGL renderer and draws after `frame`; Node attaches none and reads the posed scene instead.
 *
 * `sceneStateOf` builds the `SceneState` the dev API's `__tt.sceneState()` returns, from a model, a display time and
 * whatever the view drew, so the browser and Node report the same shape from the same code.
 */
import type * as THREE from 'three'
import { lightingFor } from './atmosphere'
import type { ColourBy, RobDisplay } from './colourBy'
import { EQUIPMENT_KINDS } from './equipmentKinds'
import type { OverlayState } from './overlays'
import type { HeroMarkStep } from './markStep'
import type { QualityProfile } from './quality'
import type { SceneModel, Vec3 } from './sceneModel'
import type { LabelScreen } from './overlayLayers'
import type { RenderedLivery, SceneRenderer } from './sceneRenderer'
import type { SceneState } from './sceneState'

/** The camera offset from the overview target a fresh scene opens with when the terminal names none. */
export const OPENING_OFFSET: Vec3 = { x: 95, y: 70, z: 115 }

/** Where a freshly built view puts the camera: the overview target and the terminal's opening offset. */
export function openingCamera(view: SceneRenderer): { target: Vec3; offset: Vec3 } {
  return { target: view.overviewTarget(), offset: view.defaultCameraOffset() ?? OPENING_OFFSET }
}

/** Everything one frame update needs besides the model: what the UI asks for and where the camera is. */
export interface SceneFrameInput {
  displayTime: number
  overlays: OverlayState
  colourBy: ColourBy
  robDisplay: RobDisplay
  /** Hour of day at the display time and the daylight lock (the sun follows the sim clock). */
  hour: number
  lockDaylight: boolean
  /** Playback is running (the view animates idle details only while live). */
  live: boolean
  selectedId: string | null
  cameraPosition: THREE.Vector3
  frustum: THREE.Frustum
  screen?: LabelScreen
}

/**
 * Owns the `SceneRenderer` for the current model: builds it when the model changes (`sync`), and applies one frame's
 * overlays, colour by, lighting and pose (`frame`). No WebGL here: the caller attaches a renderer and draws.
 */
export class SceneDriver {
  view: SceneRenderer | null = null
  private builtFor: SceneModel | null = null
  private overlaysApplied: object | null = null
  private lightingKey = ''

  constructor(private readonly create: (model: SceneModel) => SceneRenderer) {}

  /** The model the current view was built for (null before the first build). */
  get model(): SceneModel | null {
    return this.builtFor
  }

  /** Builds the view for `model` if it is not the one built for (drops the old one; none for a null model). */
  sync(model: SceneModel | null, quality: QualityProfile, markStep: HeroMarkStep): void {
    if (model === this.builtFor) return
    this.view?.dispose()
    this.view = null
    this.builtFor = model
    this.overlaysApplied = null
    this.lightingKey = ''
    if (!model) return
    this.view = this.create(model)
    this.view.setQuality(quality)
    this.view.setHeroMarkStep(markStep)
  }

  /** One frame update: overlays, colour by, lighting (re-applied when the clock moves a minute), then the pose. */
  frame(input: SceneFrameInput): void {
    const view = this.view
    if (!view) return
    if (this.overlaysApplied !== input.overlays) {
      this.overlaysApplied = input.overlays
      view.setOverlays(input.overlays)
    }
    view.setColourBy(input.colourBy, input.robDisplay)
    const key = `${Math.floor(input.hour * 60)}:${input.lockDaylight}`
    if (key !== this.lightingKey) {
      this.lightingKey = key
      view.setLighting(lightingFor(input.hour, input.lockDaylight))
    }
    view.live = input.live
    view.update(input.displayTime, input.selectedId, input.cameraPosition, input.frustum, input.screen)
  }

  dispose(): void {
    this.view?.dispose()
    this.view = null
    this.builtFor = null
  }
}

/** What a view reports as drawn (the browser's `TwinView`, or a `SceneRenderer` in Node); null without a view. */
export interface DrawnState {
  liveries(): Record<string, RenderedLivery> | null
  rigs(): Record<string, Record<string, unknown>> | null
}

/** The dev API's `SceneState` at display time `t`: engine-driven state from the model, drawn state from the view. */
export function sceneStateOf(model: SceneModel, t: number, colour: { mode: ColourBy; robDisplay: RobDisplay }, drawn: DrawnState | null): SceneState {
  const state: Record<string, unknown> = {
    displayTime: t,
    containers: Object.fromEntries(model.containerIds.map((id) => [id, model.custodyAt(id, t)])),
    reservations: model.activeReservations(t),
    liveries: drawn?.liveries() ?? {},
    colour: { mode: colour.mode, robDisplay: colour.robDisplay },
  }
  // Equipment kinds (modules/equipmentKinds/): status and pose per id, and the rig state as drawn.
  const rigs = drawn?.rigs()
  for (const def of EQUIPMENT_KINDS) {
    state[def.sceneKey] = Object.fromEntries(def.ids(model).map((id) => [id, def.sceneState(model, id, t)]))
    state[def.rigKey] = rigs?.[def.kind] ?? {}
  }
  return state as unknown as SceneState
}
