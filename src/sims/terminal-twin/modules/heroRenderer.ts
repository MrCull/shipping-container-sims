/**
 * The hero level (#258): within about 15 m of the camera, the faces of boxes the camera can see are drawn from the
 * hero face models (true corrugation, door furniture, physically based paint) over the plain box and the close-up
 * markings, which stay the fallback for every face without hero detail. `ContainerCloseups` forwards its offers here.
 *
 * Selection is `heroFaceSelection.ts` (exposed, facing, nearest first, capped by the quality level, with hysteresis).
 * Drawing is instanced per (size, face kind, part): a part is one InstancedMesh of every chosen face of that kind,
 * so draw calls are bounded by the kinds in use, not by faces. The paint is white and takes the box's colour (livery
 * body or colour-by tint) from the instance colour; wear (rust, scuffs) is driven in the shader from the box's wear
 * seed (`wearFor`), so a box looks the same at every zoom and after a rewind. Models load on the first face that needs
 * them; until a model has arrived its faces simply show the close-up level.
 *
 * Arrival is smooth (#259, `heroPrep.ts`): a chosen face is drawn only once it is prepared (model built, paint and wear
 * set up), preparation runs nearest first within a per-frame allowance and only while the camera is calm, a prepared
 * face fades in (screen-door dither over the close-up level, so no sorting and no pop), and a prepared face that stays
 * chosen keeps its detail through a camera move.
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import type { FaceCandidate } from './closeupFaceBudget'
import type { CloseupSource } from './containerCloseups'
import type { ExposedFaces } from './exposedFaces'
import { patchContactShadow } from './contactShadow'
import { loadHeroFace, type HeroFaceLoader, type HeroPart } from './heroAssets'
import { CameraGate, fadeAlpha, runPrep, type PrepItem } from './heroPrep'
import { facingCandidates, HERO_DISTANCE_M, HERO_HYSTERESIS, heroFaceOf, heroKindOf, selectHeroFaces, type HeroKind, type HeroLimits } from './heroFaceSelection'

/** Instances per mesh: the largest cap (High, 32 boxes x 3 faces) with headroom. */
export const HERO_CAPACITY = 128
const Y_AXIS = new THREE.Vector3(0, 1, 0)
/** Detail map repeats per world metre (the model's detail maps are authored for 0.5 m). */
const DETAIL_PER_M = 2

interface Offer {
  key: number
  size: ContainerSize
  x: number
  y: number
  z: number
  yaw: number
  source: () => CloseupSource
  tint: number
}

interface Look {
  tint: number
  colour: THREE.Color
  wear: [number, number, number]
}

interface Part {
  mesh: THREE.InstancedMesh
  wear: THREE.InstancedBufferAttribute | null
  fade: THREE.InstancedBufferAttribute
  triangles: number
}

type Entry = { state: 'loading' } | { state: 'failed' } | { state: 'loaded'; raw: HeroPart[] } | { state: 'ready'; parts: Part[] }

/** Fade-in: a per-instance 0 to 1 opacity drawn as an ordered screen-door dither (discard), so there is no blending or sorting. */
const FADE_VERTEX_DECL = 'attribute float heroFade;\nvarying float vHeroFade;'
const FADE_FRAGMENT_DECL = 'varying float vHeroFade;'
const FADE_DISCARD = `if (vHeroFade < 0.999) {
  float heroDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (heroDither >= vHeroFade) discard;
}`

/** Patches the paint for per-instance wear and the shared contact darkening (detail maps repeat in world metres). */
function patchPaint(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 heroWear;\nvarying float vHeroWear;\n' + FADE_VERTEX_DECL)
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vHeroFade = heroFade;
vec2 heroUv = vec2(position.x + position.z, position.y + 0.37 * (position.x - position.z)) * ${DETAIL_PER_M.toFixed(1)} + heroWear.xy;
#ifdef USE_NORMALMAP
  vNormalMapUv = heroUv;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = heroUv;
#endif
#ifdef USE_METALNESSMAP
  vMetalnessMapUv = heroUv;
#endif
vHeroWear = heroWear.z;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeroWear;\n' + FADE_FRAGMENT_DECL)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${FADE_DISCARD}
#ifdef USE_ROUGHNESSMAP
  float heroMask = texture2D(roughnessMap, vRoughnessMapUv).r;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.15, 0.08), smoothstep(0.62, 0.95, heroMask) * vHeroWear);
  diffuseColor.rgb *= 1.0 - 0.3 * vHeroWear * heroMask;
#endif`,
      )
    patchContactShadow(shader)
  }
  material.customProgramCacheKey = () => 'tt-hero-paint'
}

function patchFixed(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + FADE_VERTEX_DECL).replace('#include <uv_vertex>', '#include <uv_vertex>\nvHeroFade = heroFade;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FADE_FRAGMENT_DECL).replace('#include <color_fragment>', '#include <color_fragment>\n' + FADE_DISCARD)
    patchContactShadow(shader)
  }
  material.customProgramCacheKey = () => 'tt-hero-fixed'
}

export class HeroLevel {
  readonly group = new THREE.Group()
  private limits: HeroLimits = { boxes: 0, distanceM: HERO_DISTANCE_M, hysteresis: HERO_HYSTERESIS }
  private entries = new Map<string, Entry>()
  private previous = new Set<number>()
  private looks = new Map<number, Look>()
  private offers: Offer[] = []
  private offerOf = new Map<number, number>()
  /** Faces prepared (model built, look made), with the time they became ready: only these are drawn. */
  private readyAt = new Map<number, number>()
  private readonly gate = new CameraGate()
  private pending = 0
  private fading = false
  private preparedTotal = 0
  private candidates: FaceCandidate[] = []
  private cam = new THREE.Vector3()
  private open = false
  private faceCount = 0
  private boxCount = 0
  private readonly q = new THREE.Quaternion()
  private readonly turn = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI)
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly one = new THREE.Vector3(1, 1, 1)
  /** Model requests made (none before the first close zoom). */
  requests = 0
  /** Called when a model arrives, so the host redraws a still frame with the new faces. */
  onReady: (() => void) | null = null

  constructor(
    private readonly loader: HeroFaceLoader = loadHeroFace,
    /** Milliseconds clock for the camera gate, the allowance and the fade (a test passes a fake one). */
    private readonly now: () => number = () => performance.now(),
  ) {
    this.group.name = 'containers-hero'
  }

  setLimits(next: Partial<HeroLimits>): void {
    Object.assign(this.limits, next)
  }

  begin(camera: THREE.Vector3): void {
    this.cam.copy(camera)
    this.open = this.gate.update(camera.x, camera.y, camera.z, this.now())
    this.offers.length = 0
    this.offerOf.clear()
    this.candidates.length = 0
  }

  /** Offers box `key` with its exposed faces (the same call the close-up level gets). */
  offer(key: number, size: ContainerSize, x: number, y: number, z: number, yaw: number, faces: ExposedFaces, source: () => CloseupSource, tint = -1): void {
    if (this.limits.boxes <= 0) return
    const before = this.candidates.length
    facingCandidates(key, { size, x, y, z, yaw }, faces, this.cam, this.candidates)
    if (this.candidates.length === before) return
    const idx = this.offers.length
    this.offers.push({ key, size, x, y, z, yaw, source, tint })
    for (let i = before; i < this.candidates.length; i++) this.offerOf.set(this.candidates[i].id, idx)
  }

  end(): void {
    for (const e of this.entries.values()) if (e.state === 'ready') for (const part of e.parts) part.mesh.count = 0
    this.faceCount = 0
    this.boxCount = 0
    this.pending = 0
    this.fading = false
    if (this.limits.boxes <= 0) {
      this.previous.clear()
      this.looks.clear()
      this.readyAt.clear()
      return
    }
    const boxes = Math.min(this.limits.boxes, Math.floor(HERO_CAPACITY / 3))
    const chosen = selectHeroFaces(this.candidates, { ...this.limits, boxes }, this.previous)
    this.previous = new Set(chosen)
    for (const id of this.looks.keys()) if (!this.previous.has(id)) this.looks.delete(id)
    for (const id of this.readyAt.keys()) if (!this.previous.has(id)) this.readyAt.delete(id)
    this.prepare(chosen)
    const now = this.now()
    const drawnBoxes = new Set<number>()
    const written = new Map<Part, number>()
    for (const id of chosen) {
      const oi = this.offerOf.get(id)
      if (oi === undefined) continue
      const o = this.offers[oi]
      const info = heroKindOf(heroFaceOf(id).face)
      if (!info) continue
      const readyAt = this.readyAt.get(id)
      if (readyAt === undefined) continue // not prepared yet: the close-up level shows
      const entry = this.entry(o.size, info.kind)
      if (entry.state !== 'ready') continue
      const look = this.lookOf(id, o)
      const alpha = fadeAlpha(readyAt, now)
      if (alpha < 1) this.fading = true
      drawnBoxes.add(o.key)
      this.faceCount++
      // the box's pose; the -Z side is the side model turned 180 degrees about the vertical
      this.q.setFromAxisAngle(Y_AXIS, o.yaw)
      if (info.turn) this.q.multiply(this.turn)
      this.m.compose(this.p.set(o.x, o.y, o.z), this.q, this.one)
      for (const part of entry.parts) {
        const n = written.get(part) ?? 0
        written.set(part, n + 1)
        part.mesh.setMatrixAt(n, this.m)
        part.fade.setX(n, alpha)
        if (part.wear) {
          part.mesh.setColorAt(n, look.colour)
          part.wear.setXYZ(n, look.wear[0], look.wear[1], look.wear[2])
        }
      }
    }
    for (const [part, n] of written) {
      part.mesh.count = n
      part.mesh.instanceMatrix.needsUpdate = true
      part.fade.needsUpdate = true
      if (part.wear && part.mesh.instanceColor) {
        part.mesh.instanceColor.needsUpdate = true
        part.wear.needsUpdate = true
      }
    }
    this.boxCount = drawnBoxes.size
  }

  /**
   * Prepares chosen faces that are not ready: models that have arrived get built, the face's look is made. Nearest first,
   * within the per-frame allowance, and only while the camera is calm. Faces already ready are never touched here.
   */
  private prepare(chosen: readonly number[]): void {
    const d2 = new Map<number, number>()
    for (const c of this.candidates) d2.set(c.id, c.d2)
    const items: PrepItem[] = []
    for (const id of chosen) {
      if (this.readyAt.has(id)) continue
      const oi = this.offerOf.get(id)
      const info = heroKindOf(heroFaceOf(id).face)
      if (oi === undefined || !info) continue
      const o = this.offers[oi]
      const entry = this.entry(o.size, info.kind)
      if (entry.state !== 'loaded' && entry.state !== 'ready') continue
      items.push({
        d2: d2.get(id) ?? 0,
        run: () => {
          this.build(o.size, info.kind)
          this.lookOf(id, o)
          this.readyAt.set(id, this.now())
          this.preparedTotal++
        },
      })
    }
    if (!this.open) {
      this.pending = items.length
      return
    }
    const ran = runPrep(items, this.now)
    this.pending = items.length - ran
  }

  private lookOf(id: number, o: Offer): Look {
    const have = this.looks.get(id)
    if (have && have.tint === o.tint) return have
    const src = o.source()
    const seed = src.markings.wear.seed
    const look: Look = {
      tint: o.tint,
      colour: new THREE.Color(src.bodyColour),
      // a per-box offset into the detail maps (metres), and how worn the paint is: all from the wear seed
      wear: [((seed & 0xffff) / 0xffff) * 31, (((seed >>> 16) & 0xffff) / 0xffff) * 31, 0.35 + 0.65 * src.markings.wear.fade],
    }
    this.looks.set(id, look)
    return look
  }

  private entry(size: ContainerSize, kind: HeroKind): Entry {
    const k = `${size}-${kind}`
    const have = this.entries.get(k)
    if (have) return have
    const loading: Entry = { state: 'loading' }
    this.entries.set(k, loading)
    this.requests++
    this.loader(size, kind).then(
      (parts) => {
        this.entries.set(k, { state: 'loaded', raw: parts })
        this.onReady?.()
      },
      (err: unknown) => {
        console.warn(`Terminal Twin: hero face ${k} failed to load; keeping the close-up level`, err)
        this.entries.set(k, { state: 'failed' })
      },
    )
    return loading
  }

  /** Turns a loaded model into its instanced meshes (once; part of a face's preparation, so inside the allowance). */
  private build(size: ContainerSize, kind: HeroKind): void {
    const k = `${size}-${kind}`
    const e = this.entries.get(k)
    if (e?.state === 'loaded') this.entries.set(k, { state: 'ready', parts: e.raw.map((p) => this.buildPart(k, p)) })
  }

  private buildPart(name: string, part: HeroPart): Part {
    const material = part.material.clone()
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = -1
    if (part.tinted) patchPaint(material)
    else patchFixed(material)
    let wear: THREE.InstancedBufferAttribute | null = null
    if (part.tinted) {
      wear = new THREE.InstancedBufferAttribute(new Float32Array(HERO_CAPACITY * 3), 3)
      wear.setUsage(THREE.DynamicDrawUsage)
      part.geometry.setAttribute('heroWear', wear)
    }
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(HERO_CAPACITY).fill(1), 1)
    fade.setUsage(THREE.DynamicDrawUsage)
    part.geometry.setAttribute('heroFade', fade)
    const mesh = new THREE.InstancedMesh(part.geometry, material, HERO_CAPACITY)
    mesh.name = `containers-hero-${name}${part.tinted ? '-paint' : ''}`
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    if (part.tinted) mesh.setColorAt(0, new THREE.Color('#ffffff')) // the colour exists from the first frame: no recompile
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = true
    this.group.add(mesh)
    return { mesh, wear, fade, triangles: part.triangles }
  }

  /** Hero faces drawn in the last frame (never above `boxes x 3`). */
  get faces(): number {
    return this.faceCount
  }

  /** Faces prepared since the start (cumulative; none while the camera moves fast). */
  get prepared(): number {
    return this.preparedTotal
  }

  /** True while faces wait for preparation or are fading in: the host keeps redrawing a still camera. */
  get busy(): boolean {
    return this.pending > 0 || this.fading
  }

  /** Boxes with at least one hero face drawn in the last frame. */
  get count(): number {
    return this.boxCount
  }

  cost(): { drawCalls: number; triangles: number } {
    let drawCalls = 0
    let triangles = 0
    for (const e of this.entries.values()) {
      if (e.state !== 'ready') continue
      for (const part of e.parts) {
        if (part.mesh.count === 0) continue
        drawCalls++
        triangles += part.triangles * part.mesh.count
      }
    }
    return { drawCalls, triangles }
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      if (e.state !== 'ready') continue
      for (const part of e.parts) {
        this.group.remove(part.mesh)
        part.mesh.geometry.dispose()
        ;(part.mesh.material as THREE.Material).dispose()
        part.mesh.dispose()
      }
    }
    this.entries.clear()
  }
}
