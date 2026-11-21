/**
 * Headless scene (#331, spec #320): the browser's scene in Node, as a test level between engine unit tests and browser
 * smoke specs. It loads a fixture or preset the way `__tt.load` does, drives the engine through the browser's own
 * `TwinController` (the worker's host in-process), builds and poses the scene through the browser's own path
 * (`SceneDriver`, `modules/sceneDriver.ts`) and returns `sceneState()` in exactly the shape `__tt.sceneState()` returns.
 * The only difference from the browser: no WebGL renderer is attached and nothing is drawn.
 *
 * Not loaded here: the GLBs (no network in Node). Containers use stub LOD meshes and the other renderers keep their
 * procedural placeholders (`makeHeadlessRenderer`), so `vesselHulls[id].assets` reads 'placeholder' and rig state that
 * only exists once a GLB has loaded (`stsRendered`, `shcRigs`...) stays empty. Everything else (custody, poses, colour by
 * tints, ROB boxes and display, hatch panels and rigs) is the same code the browser runs.
 *
 *   const scene = await headlessScene('rob-bays')
 *   await scene.runUntil({ eventType: 'VesselBerthed' })
 *   scene.setColourBy('pod')
 *   scene.sceneState().liveries
 */
import * as THREE from 'three'
import { hourOfDay } from '../modules/atmosphere'
import type { CameraPose } from '../modules/cameraKeys'
import { DEFAULT_COLOUR_BY, DEFAULT_ROB_DISPLAY, type ColourBy, type RobDisplay } from '../modules/colourBy'
import type { EngineResponse } from '../modules/engineClient'
import { NO_OVERLAYS, type OverlayState } from '../modules/overlays'
import { profileFor, type QualityLevel } from '../modules/quality'
import { cameraAtPose } from '../modules/sceneCamera'
import { openingCamera, SceneDriver, sceneStateOf } from '../modules/sceneDriver'
import type { SceneStats } from '../modules/sceneRenderer'
import type { SceneState } from '../modules/sceneState'
import { TwinController, type EngineLink } from '../modules/twinController'
import { runConfigFor } from '../i18n/display'
import { composeScenario, type ScenarioEdits } from '../scenario/compose'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EngineInfo, EventSummary, WorkerRequest, WorkerRunCondition } from '../worker/protocol'
import type { RunResult } from '../engine'
import { makeHeadlessRenderer } from './headlessPose'

/** The browser's default viewport (the smoke config's 1280x720). */
const VIEWPORT = { width: 1280, height: 720 }
/** A fixed start date, so the lighting does not depend on when the test runs. */
const START = '2026-10-26T06:00:00.000Z'

export interface HeadlessSceneOptions extends ScenarioEdits {
  /** Engine seed (default: the scenario's own, as `__tt.load`). */
  seed?: number
  /** Quality level the scene is built at (default 'low', as the smoke specs boot). */
  quality?: QualityLevel
  /** Camera pose (default: the opening view the browser aims at when a scenario loads). */
  camera?: CameraPose
  /** Start date and time (only the lighting reads it). */
  startDateTime?: string
}

export interface HeadlessScene {
  readonly controller: TwinController
  /** Same as `__tt.runUntil` / `__tt.runTo` / `__tt.step`: run flat out, pause at the engine time. */
  runUntil(condition: WorkerRunCondition): Promise<RunResult>
  runTo(time: number): Promise<RunResult>
  step(): Promise<EventSummary | null>
  /** Same as the Colour by menu and the ROB display buttons. */
  setColourBy(mode: ColourBy, robDisplay?: RobDisplay): void
  setOverlays(overlays: OverlayState): void
  /** Same as `__tt.setCameraPose` and `__tt.cameraTo` (keeps the view direction). */
  setCameraPose(pose: CameraPose): void
  cameraTo(entityId: string, distanceM?: number): boolean
  /** Updates one frame at the display time and returns `__tt.sceneState()`'s shape. */
  sceneState(): SceneState
  /** The draw-independent counts `__tt.scene()` reports (containers, vessels, hatch panels...), after one frame update. */
  stats(): SceneStats
  dispose(): void
}

/** A fixture or preset by name, as `__tt.load` resolves it. */
function resolve(name: string): ScenarioConfig {
  const config = fixtures[name] ?? presets[name]
  if (!config) throw new Error(`Unknown fixture or preset: ${name}`)
  return config as ScenarioConfig
}

/** The worker's host answering in-process (structured-cloned like a worker reply). */
function inProcessLink(): EngineLink {
  const host = createEngineHost()
  let rid = 0
  return {
    async request<T>(req: WorkerRequest): Promise<EngineResponse<T>> {
      const reply = await host.handle({ ...req, rid: ++rid })
      if (!reply.ok) throw new Error(reply.error)
      return structuredClone({ result: reply.result as T, delta: reply.delta as Delta, info: reply.info as EngineInfo })
    },
    dispose() {},
  }
}

export async function headlessScene(name: string, options: HeadlessSceneOptions = {}): Promise<HeadlessScene> {
  // the run config `__tt.load` builds (start date and time, KPI clock), in en-GB metric display
  const config = runConfigFor(composeScenario(resolve(name), options), options.startDateTime ?? START, { locale: 'en-GB', units: 'metric' })
  const seed = options.seed ?? config.seed
  const controller = new TwinController(() => {}, inProcessLink(), { now: () => 0 })
  await controller.load(config, seed)
  const model = controller.model
  if (!model) throw new Error('Scenario did not load')

  const driver = new SceneDriver(makeHeadlessRenderer)
  driver.sync(model, profileFor(options.quality ?? 'low'), 'sharp')
  const view = driver.view!
  let target = new THREE.Vector3()
  let camera = options.camera ? atPose(options.camera) : openingPose()
  let colour: { mode: ColourBy; robDisplay: RobDisplay } = { mode: DEFAULT_COLOUR_BY, robDisplay: DEFAULT_ROB_DISPLAY }
  let overlays: OverlayState = NO_OVERLAYS

  function openingPose(): THREE.PerspectiveCamera {
    const { target, offset } = openingCamera(view)
    return placed(new THREE.Vector3(target.x, target.y, target.z), new THREE.Vector3(offset.x, offset.y, offset.z))
  }

  /** The camera at `at` plus `offset`, looking at `at` (the browser's `placeCamera`). */
  function placed(at: THREE.Vector3, offset: THREE.Vector3): THREE.PerspectiveCamera {
    target = at.clone()
    const cam = new THREE.PerspectiveCamera()
    cam.copy(cameraAtPose({ target: at, distance: 1, azimuth: 0, polar: 1 }, VIEWPORT.width, VIEWPORT.height))
    cam.position.copy(at).add(offset)
    cam.lookAt(at)
    return cam
  }

  function atPose(pose: CameraPose): THREE.PerspectiveCamera {
    target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z)
    return cameraAtPose(pose, VIEWPORT.width, VIEWPORT.height)
  }

  /** One frame of the browser's loop: the controller's tick (paused: applies waiting slices, prunes what left the scene), then the update. */
  function frame(): void {
    controller.tick(0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    driver.frame({
      displayTime: controller.displayTime,
      overlays,
      colourBy: colour.mode,
      robDisplay: colour.robDisplay,
      hour: hourOfDay(config.startDateTime ?? START, controller.displayTime),
      lockDaylight: true,
      live: false,
      selectedId: null,
      cameraPosition: camera.position,
      frustum,
      screen: { camera, width: VIEWPORT.width, height: VIEWPORT.height },
    })
  }

  return {
    controller,
    runUntil: (condition) => controller.runUntil(condition),
    runTo: (time) => controller.runTo(time),
    step: () => controller.step(),
    setColourBy(mode, robDisplay = colour.robDisplay) {
      colour = { mode, robDisplay }
    },
    setOverlays(next) {
      overlays = next
    },
    setCameraPose(pose) {
      camera = atPose(pose)
    },
    cameraTo(entityId, distanceM) {
      const centre = model.entityCentre(entityId, controller.displayTime)
      if (!centre) return false
      // the browser's aim(): keep the view direction, optionally at a new distance (never closer than the orbit minimum, 8 m)
      const offset = camera.position.clone().sub(target)
      if (distanceM !== undefined) offset.setLength(Math.max(8, distanceM))
      camera = placed(new THREE.Vector3(centre.x, centre.y, centre.z), offset)
      return true
    },
    sceneState() {
      frame()
      return sceneStateOf(model, controller.displayTime, colour, { liveries: () => view.renderedLiveries(), rigs: () => view.renderedRigs() })
    },
    stats() {
      frame()
      return view.stats()
    },
    dispose() {
      driver.dispose()
    },
  }
}
