/**
 * Headless posing harness (#246): the browser's per-frame posing loop (`SceneRenderer.update`) run in Node, with no
 * canvas, GLBs or WebGL. Shared by the baseline script (`baseline.ts`) and the drawn-box reference test.
 *
 * What is real: the engine, the `SceneModel`, `containerPose`, colour by, the instancer's cull, LOD choice and instance
 * writes. What is stubbed: the GLB meshes (unit boxes stand in, so the LOD layers and their names exist), the close-up
 * atlas painting (no canvas), and the render submit (no GPU), so the time measured is posing only.
 */
import * as THREE from 'three'
import type { ScenarioConfig } from '../scenario/types'
import type { ContainerAssets } from '../modules/containerAssets'
import { ContainerCloseups, type AtlasBackend } from '../modules/containerCloseups'
import { CAMERA_FOV_DEG, viewPresetPose } from '../modules/viewPresets'
import { SceneModel } from '../modules/sceneModel'
import { SceneRenderer } from '../modules/sceneRenderer'
import { createEngineHost } from '../worker/engineHost'
import type { WorkerRequest } from '../worker/protocol'

/** Sim seconds per `advance` request: the look-ahead the controller asks for at x600 to x1200. */
const ADVANCE_STEP_S = 900

export interface HeadlessRun {
  model: SceneModel
  /** Advance the engine to sim time `t` the way playback does (look-ahead sized `advance` steps, whose deltas keep every motion segment; a flat-out `run` compacts them) and feed the scene model. */
  runTo(t: number): Promise<void>
}

/** The engine in-process (the worker's host) feeding a scene model, as the browser's controller does. */
export async function startHeadlessRun(config: ScenarioConfig, seed: number = config.seed): Promise<HeadlessRun> {
  const host = createEngineHost()
  const model = new SceneModel(config, seed)
  let rid = 0
  const call = async (req: WorkerRequest): Promise<void> => {
    const reply = await host.handle({ ...req, rid: ++rid })
    if (!reply.ok) throw new Error(reply.error)
    model.apply(reply.delta)
  }
  await call({ op: 'load', config, seed })
  let now = 0
  return {
    model,
    async runTo(t) {
      while (now < t) {
        now = Math.min(t, now + ADVANCE_STEP_S)
        await call({ op: 'advance', to: now })
      }
    },
  }
}

function stubAssets(): ContainerAssets {
  const box = () => new THREE.BoxGeometry(1, 1, 1)
  const sizes = { '20': { lod0: box(), lod1: box() }, '40': { lod0: box(), lod1: box() }, '40HC': { lod0: box(), lod1: box() } }
  return { sizes, lod0Material: new THREE.MeshStandardMaterial(), lod1Material: new THREE.MeshStandardMaterial() }
}

/** Vessel countdown labels and a few other renderers draw into a canvas: a stub that swallows every call (nothing is rendered here). */
function installCanvasStub(): void {
  // no network here: the renderers' GLB loads fail and warn, and keep their procedural stand-ins, which is what is wanted
  const warn = console.warn
  console.warn = (...args: unknown[]) => {
    if (!(typeof args[0] === 'string' && args[0].includes('GLB'))) warn(...args)
  }
  const g = globalThis as unknown as { document?: unknown }
  if (g.document) return
  const noop: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 0 }) : noop), apply: () => noop, set: () => true })
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) }
}

/** A scene renderer with the container LOD layers (stub meshes) and a close-up level that paints nothing. */
export function makeHeadlessRenderer(model: SceneModel): SceneRenderer {
  const backend: AtlasBackend = { createPage: () => ({ texture: new THREE.Texture(), ctx: null }), paint: () => {} }
  installCanvasStub()
  const renderer = new SceneRenderer(model, { closeups: new ContainerCloseups(backend, () => null) })
  renderer.useContainerAssets(stubAssets())
  return renderer
}

export interface CameraView {
  position: THREE.Vector3
  frustum: THREE.Frustum
}

function viewOf(camera: THREE.PerspectiveCamera): CameraView {
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
  return { position: camera.position.clone(), frustum }
}

/** The Overview view preset at a 16:9 window, as the browser frames it (the whole terminal in view). */
export function overviewView(model: SceneModel, aspect = 16 / 9): CameraView {
  const pose = viewPresetPose(model, 'overview', aspect)
  if (!pose) throw new Error('no overview pose')
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, 1, 14000)
  const target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z)
  camera.position.copy(target).add(new THREE.Vector3(pose.direction.x, pose.direction.y, pose.direction.z).multiplyScalar(pose.distanceM))
  camera.lookAt(target)
  return viewOf(camera)
}

/** A camera `distanceM` from a point, looking at it from the landward side and above (a close view for LOD0 and close-ups). */
export function closeView(target: THREE.Vector3, distanceM: number, aspect = 16 / 9): CameraView {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, 1, 14000)
  camera.position.copy(target).add(new THREE.Vector3(0.3, 0.75, 0.6).normalize().multiplyScalar(distanceM))
  camera.lookAt(target)
  return viewOf(camera)
}

export interface PosingTiming {
  meanMs: number
  minMs: number
  maxMs: number
  counters: { boxesPosed: number; instanceBytes: number }
}

/** Wall ms per `update` over `frames` frames at display time `t`, after `warmup` frames that fill the caches. */
export function timePosing(renderer: SceneRenderer, view: CameraView, t: number, frames: number, warmup = 5, now: () => number = () => performance.now()): PosingTiming {
  for (let i = 0; i < warmup; i++) renderer.update(t, null, view.position, view.frustum)
  let sum = 0
  let min = Infinity
  let max = 0
  for (let i = 0; i < frames; i++) {
    const t0 = now()
    renderer.update(t, null, view.position, view.frustum)
    const ms = now() - t0
    sum += ms
    min = Math.min(min, ms)
    max = Math.max(max, ms)
  }
  return { meanMs: sum / frames, minMs: min, maxMs: max, counters: renderer.poseCounters() }
}
