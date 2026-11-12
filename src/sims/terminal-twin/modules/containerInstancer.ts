/**
 * Instanced container renderer with LODs and per-instance liveries.
 *
 * Until the GLBs have loaded it draws procedural placeholder boxes (one
 * InstancedMesh per size, coloured by livery). Once `setAssets` is called it
 * draws one InstancedMesh per size × LOD:
 *   - LOD0 (~300-440 triangles) for at most `lod0Cap` boxes nearest the camera
 *     and within `lod0DistanceM` (with hysteresis so boxes do not flicker
 *     between LODs at the threshold);
 *   - Close-up markings (#119, #143) on top of either LOD: the visible faces of boxes within `closeupDistanceM`
 *     (`exposedFaces.ts`: a stacked yard box hides what its neighbours touch) are drawn as decals from a texture
 *     atlas, nearest first up to `closeupFaceBudget` faces (`containerCloseups.ts`). The plain instanced box is
 *     the fallback for every face without one;
 *   - LOD1 (12 triangles, normal-mapped corrugation at the same pitch) for the rest.
 * Each instance carries a `liveryIndex` attribute (atlas tile = shipping line). A box pushed with a `tint` (colour
 * by, #130) takes the generic tile and an instance colour that turns its grey body into the tint, flat in the close-up
 * and the placeholder; no tint (-1) keeps the livery.
 *
 * Per frame: `begin()`, `push(...)` for every visible box, then `end(camera)`.
 * Nothing here is reactive.
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import { liveryBodyColour, LIVERY_ATLAS, type ContainerAssets } from './containerAssets'
import { CONTAINER_DIMS } from './sceneModel'
import { patchContactShadow } from './contactShadow'
import { ContainerCloseups, type CloseupSource } from './containerCloseups'
import type { HeroLevel } from './heroRenderer'
import { exposedFaces, neighboursOf, type ExposedFaces, type PlacedBox } from './exposedFaces'

/** Cell of the grid that finds a yard box's neighbours (a 40 ft box and its gap fit in one). */
const GRID_CELL_M = 14

/** A 40 ft box fits in a sphere of this radius (m). */
const BOX_SPHERE_M = 7.5

const SIZES: ContainerSize[] = ['20', '40', '40HC']

export interface ContainerLodOptions {
  /** Max boxes drawn at LOD0. */
  lod0Cap: number
  /** Boxes beyond this camera distance always use LOD1. */
  lod0DistanceM: number
  /** A box already at LOD0 keeps it out to lod0DistanceM × this factor. */
  hysteresis: number
  /** Max close-up marking faces drawn (0 = off). */
  closeupFaceBudget: number
  /** Faces beyond this camera distance are never drawn with markings (a drawn face keeps it out to this x `hysteresis`). */
  closeupDistanceM: number
}

export const DEFAULT_LOD_OPTIONS: ContainerLodOptions = { lod0Cap: 300, lod0DistanceM: 140, hysteresis: 1.15, closeupFaceBudget: 400, closeupDistanceM: 35 }

export interface ContainerRenderStats {
  /** Boxes present in the instancer (visible or not). */
  drawn: number
  /** Boxes handed to the instancer this frame (#250). */
  posed: number
  lod0: number
  /** Everything not at LOD0, culled boxes included, so lod0 + lod1 = drawn. */
  lod1: number
  /** Boxes with at least one close-up marking face drawn (#119, #143); they keep their LOD. */
  closeup: number
  /** Close-up marking faces drawn (never above the face budget). */
  closeupFaces: number
  /** Hero faces drawn (#258; never above the quality level's hero cap). */
  heroFaces: number
  /** Hero faces prepared since the start (#259; none while the camera moves fast). */
  heroPrepared: number
  /** Hero marking atlas (#260): step, pages, tiles, draw calls, page memory. */
  heroMarks: { step: 'sharp' | 'standard'; pages: number; tiles: number; drawCalls: number; texelBytes: number }
  /** Draw calls and triangles of the hero faces drawn last frame (#259 measurement). */
  heroCost: { drawCalls: number; triangles: number }
  /** Boxes outside the camera frustum, not written to the GPU (0 without a frustum). */
  culled: number
  /** Bytes the container instance buffers (matrix, livery index, colour) hand to the GPU upload this frame (#246): each buffer flagged for upload counts in full, or only its update ranges once a buffer uses them. Close-up faces are not included. */
  instanceBytes: number
  assets: 'placeholder' | 'loaded'
}

/** One box the instancer wrote this frame (recorded only on request, for the drawn-box reference test #246). */
export interface DrawnBox {
  key: number
  /** The instanced mesh it went into (size and LOD, or the placeholder). */
  layer: string
  /** Column-major instance matrix, as uploaded. */
  matrix: number[]
  /** Atlas tile drawn (-1 for the placeholder, which has no livery attribute). */
  livery: number
  /** Instance colour, 0xRRGGBB. */
  colour: number
}

interface Layer {
  mesh: THREE.InstancedMesh
  livery: THREE.InstancedBufferAttribute | null
}

/** What was drawn for a key (dev API / tests): livery index and size. */
export interface RenderedContainer {
  size: ContainerSize
  livery: number
  lod: 0 | 1
  /** Colour-by tint (0xRRGGBB) the box was drawn in, -1 for its livery. */
  tint: number
}

/** What three.js copies to the GPU for a buffer flagged `needsUpdate`: its update ranges if it has any (count in elements), else all of it. */
function uploadBytes(attribute: THREE.BufferAttribute): number {
  const ranges = attribute.updateRanges
  if (ranges.length === 0) return attribute.array.byteLength
  let elements = 0
  for (const r of ranges) elements += r.count
  return elements * attribute.array.BYTES_PER_ELEMENT
}

export class ContainerInstancer {
  readonly group = new THREE.Group()
  private readonly options: ContainerLodOptions
  private readonly capacity: Record<ContainerSize, number>
  private placeholders: Record<ContainerSize, Layer> | null = null
  private lods: Record<ContainerSize, [Layer, Layer]> | null = null
  private disposables: { dispose(): void }[] = []
  // Retained per-box data, by key (#250): a box keeps its instance slot until it changes layer (size, LOD, culled).
  private n = 0
  private count = 0
  private has: boolean[] = []
  private sizes: ContainerSize[] = []
  private xs: number[] = []
  private ys: number[] = []
  private zs: number[] = []
  private liveries: number[] = []
  private tints: number[] = []
  private yards: boolean[] = []
  private yaws: number[] = []
  private dist2: Float64Array = new Float64Array(0)
  /** LOD per key from the previous pass (hysteresis); -1 = none. */
  private lastLod: number[] = []
  /** LOD level the box was drawn (or culled) at in the last pass. */
  private levelOf: number[] = []
  /** Index into `layerList` the box occupies, -1 = culled or absent; and its slot there. */
  private layerIdx: number[] = []
  private slotOf: number[] = []
  private needWrite: boolean[] = []
  private dirtyList: number[] = []
  private layerList: Layer[] = []
  private layerKeys: number[][] = []
  private layerLo: number[] = []
  private layerHi: number[] = []
  /** Boxes `set` this frame (the posing counter). */
  private posed = 0
  /** Something a pass must see: box data changed, assets or options changed, first frame. */
  private passNeeded = true
  private camKey: number[] | null = null
  // Close-up reach (#257): the keys within reach of the camera the close-up level was last offered from, kept current as boxes change, so a frame where nothing near the camera changed offers nothing and the O(boxes) scan runs only when the camera moves.
  private reachKeys = new Set<number>()
  private readonly reachCam = new THREE.Vector3()
  private reachFresh = false
  private closeupDirty = true
  private hero: HeroLevel | null = null
  private lastLod0 = 0
  private lastCulled = 0
  // Immediate mode (begin / push / end): boxes not pushed since `begin` are removed at `end`.
  private immediate = false
  private stamp = 0
  private stampOf: number[] = []
  private lastStats: ContainerRenderStats = { drawn: 0, posed: 0, lod0: 0, lod1: 0, closeup: 0, closeupFaces: 0, heroFaces: 0, heroPrepared: 0, heroMarks: { step: 'sharp', pages: 0, tiles: 0, drawCalls: 0, texelBytes: 0 }, heroCost: { drawCalls: 0, triangles: 0 }, culled: 0, instanceBytes: 0, assets: 'placeholder' }
  private readonly matrix = new THREE.Matrix4()
  private readonly colour = new THREE.Color()
  /** Linear colour of the generic livery's body: a tint is divided by it, so the grey tile multiplied by the instance colour comes out as the tint. */
  private readonly genericBody = new THREE.Color(liveryBodyColour(LIVERY_ATLAS.genericIndex))
  private readonly closeups: ContainerCloseups
  private markingsSource: ((key: number) => CloseupSource) | null = null
  private recording = false
  private drawn: DrawnBox[] = []

  constructor(
    capacity: Partial<Record<ContainerSize, number>>,
    options: Partial<ContainerLodOptions> = {},
    closeups: ContainerCloseups = new ContainerCloseups(),
  ) {
    this.closeups = closeups
    this.group.add(closeups.group)
    this.options = { ...DEFAULT_LOD_OPTIONS, ...options }
    this.capacity = { '20': capacity['20'] ?? 0, '40': capacity['40'] ?? 0, '40HC': capacity['40HC'] ?? 0 }
    this.group.name = 'containers'
    const mat = this.track(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }))
    mat.onBeforeCompile = (shader) => patchContactShadow(shader)
    mat.customProgramCacheKey = () => 'tt-box-contact'
    this.placeholders = {} as Record<ContainerSize, Layer>
    for (const size of SIZES) {
      const d = CONTAINER_DIMS[size]
      const geo = this.track(new THREE.BoxGeometry(d.length, d.height, d.width).translate(0, d.height / 2, 0))
      this.placeholders[size] = { mesh: this.instanced(geo, mat, size, 'placeholder'), livery: null }
    }
    this.setLayers(SIZES.map((s) => this.placeholders![s]))
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing)
    return thing
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, size: ContainerSize, tag: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.capacity[size]))
    mesh.name = `containers-${size}-${tag}`
    mesh.count = 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    this.group.add(mesh)
    this.disposables.push(mesh)
    return mesh
  }

  /** The layers boxes are slotted into (placeholders: one per size; GLBs: size x LOD, size-major). */
  private setLayers(layers: Layer[]): void {
    this.layerList = layers
    this.layerKeys = layers.map(() => [])
    this.layerLo = layers.map(() => Infinity)
    this.layerHi = layers.map(() => -1)
    // every present box is slotted afresh and written
    for (let k = 0; k < this.n; k++) {
      this.layerIdx[k] = -1
      if (this.has[k]) this.markWrite(k)
    }
    this.passNeeded = true
    this.reachFresh = false
    this.closeupDirty = true
  }

  /** Switches from the procedural placeholders to the GLB LODs. */
  setAssets(assets: ContainerAssets): void {
    if (this.lods) return
    this.lods = {} as Record<ContainerSize, [Layer, Layer]>
    for (const size of SIZES) {
      const make = (src: THREE.BufferGeometry, mat: THREE.Material, tag: string): Layer => {
        const geo = this.track(src.clone())
        const livery = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, this.capacity[size])), 1)
        livery.setUsage(THREE.DynamicDrawUsage)
        geo.setAttribute('liveryIndex', livery)
        const mesh = this.instanced(geo, mat, size, tag)
        mesh.setColorAt(0, this.colour.set('#ffffff')) // the instance colour exists from the first frame, so the shader never recompiles when a tint first appears
        return { mesh, livery }
      }
      const m = assets.sizes[size]
      this.lods[size] = [make(m.lod0, assets.lod0Material, 'lod0'), make(m.lod1, assets.lod1Material, 'lod1')]
    }
    for (const layer of Object.values(this.placeholders ?? {})) {
      this.group.remove(layer.mesh)
    }
    this.placeholders = null
    this.setLayers(SIZES.flatMap((s) => this.lods![s]))
  }

  get assetsLoaded(): boolean {
    return this.lods !== null
  }

  /** Immediate mode: every box not pushed before `end` is removed. */
  begin(): void {
    this.immediate = true
    this.stamp++
  }

  /** Record every box written, for `drawnBoxes()` (off by default: it allocates per box). */
  setDrawnRecording(on: boolean): void {
    this.recording = on
    if (!on) this.drawn = []
  }

  /** The boxes drawn at the last `end()` (written then or earlier, slots are retained), in slot order; empty unless recording is on. */
  drawnBoxes(): readonly DrawnBox[] {
    return this.drawn
  }

  private markWrite(key: number): void {
    if (this.needWrite[key]) return
    this.needWrite[key] = true
    this.dirtyList.push(key)
  }

  /**
   * One box (retained, #250): `key` is a stable id (e.g. container index), centre position in metres, yaw about Y (0 = length along X); `yard` marks a stacked yard box (the close-up level hides the faces its neighbours touch).
   * A box whose data equals what it already holds costs nothing; a changed one is written to its slot at the next `end`.
   */
  set(key: number, size: ContainerSize, cx: number, cy: number, cz: number, livery: number, yaw = 0, tint = -1, yard = false): void {
    this.posed++
    const y = cy - CONTAINER_DIMS[size].height / 2 // models have their origin at the bottom centre
    if (this.has[key] && this.sizes[key] === size && this.xs[key] === cx && this.ys[key] === y && this.zs[key] === cz && this.liveries[key] === livery && this.yaws[key] === yaw && this.tints[key] === tint && this.yards[key] === yard) return
    if (this.reachFresh) {
      const was = this.reachKeys.has(key)
      const now = this.withinReach(cx, y, cz)
      if (now) this.reachKeys.add(key)
      else this.reachKeys.delete(key)
      if (was || now) this.closeupDirty = true
    }
    if (!this.has[key]) {
      this.has[key] = true
      this.count++
      if (key >= this.n) {
        for (let k = this.n; k <= key; k++) {
          this.has[k] ??= false
          this.layerIdx[k] = -1
          this.lastLod[k] = -1
        }
        this.n = key + 1
      }
    }
    this.sizes[key] = size
    this.xs[key] = cx
    this.ys[key] = y
    this.zs[key] = cz
    this.liveries[key] = livery
    this.yaws[key] = yaw
    this.tints[key] = tint
    this.yards[key] = yard
    this.markWrite(key)
    this.passNeeded = true
  }

  /** Immediate mode: the same as `set`. */
  push(key: number, size: ContainerSize, cx: number, cy: number, cz: number, livery: number, yaw = 0, tint = -1, yard = false): void {
    this.stampOf[key] = this.stamp
    this.set(key, size, cx, cy, cz, livery, yaw, tint, yard)
  }

  /** The box is not in the scene any more (no custody to pose it from). */
  remove(key: number): void {
    if (!this.has[key]) return
    this.has[key] = false
    this.count--
    this.passNeeded = true
    if (this.reachKeys.delete(key)) this.closeupDirty = true
  }

  /** Whether the cached box `key` is inside the frustum when widened by `slackM` metres; true for a box without a cached position (#257). */
  nearFrustum(key: number, frustum: THREE.Frustum, slackM: number): boolean {
    if (!this.has[key]) return true
    this.sphere.radius = BOX_SPHERE_M + slackM
    this.sphere.center.set(this.xs[key], this.ys[key] + 1.3, this.zs[key])
    return frustum.intersectsSphere(this.sphere)
  }

  private reach2(): number {
    const reach = this.options.closeupDistanceM * this.options.hysteresis + 8
    return reach * reach
  }

  private withinReach(x: number, y: number, z: number): boolean {
    const dx = x - this.reachCam.x
    const dy = y - this.reachCam.y
    const dz = z - this.reachCam.z
    return dx * dx + dy * dy + dz * dz <= this.reach2()
  }

  /** Attaches the hero level (#258) to the close-up level's offers. */
  setHero(hero: HeroLevel | null): void {
    this.closeups.setHero(hero)
    this.hero = hero
    if (hero) hero.onReady = () => (this.closeupDirty = true)
  }

  /** What a close-up box is painted from, by the key given to `push` (without one there are no close-ups). */
  setMarkingsSource(source: (key: number) => CloseupSource): void {
    this.markingsSource = source
    this.reachFresh = false
    this.closeupDirty = true
  }

  /** Retune the LOD0 range and cap (quality settings). */
  setLodOptions(next: Partial<ContainerLodOptions>): void {
    for (const k of Object.keys(next) as (keyof ContainerLodOptions)[]) {
      if (this.options[k] === next[k]) continue
      this.passNeeded = true
      this.reachFresh = false
      this.closeupDirty = true
    }
    Object.assign(this.options, next)
  }

  /** Frees the box's layer slot: the layer's last box takes it (and is rewritten there). */
  private detach(key: number): void {
    const li = this.layerIdx[key]
    const keys = this.layerKeys[li]
    const slot = this.slotOf[key]
    const last = keys.pop() as number
    if (last !== key) {
      keys[slot] = last
      this.slotOf[last] = slot
      this.markWrite(last)
    }
    this.layerIdx[key] = -1
  }

  private attach(key: number, li: number): void {
    const keys = this.layerKeys[li]
    this.slotOf[key] = keys.length
    keys.push(key)
    this.layerIdx[key] = li
    this.markWrite(key)
  }

  private writeBox(layer: Layer, slot: number, i: number): void {
    this.matrix.makeRotationY(this.yaws[i]).setPosition(this.xs[i], this.ys[i], this.zs[i])
    layer.mesh.setMatrixAt(slot, this.matrix)
    const tint = this.tints[i]
    if (layer.livery) {
      if (tint >= 0) {
        layer.livery.setX(slot, LIVERY_ATLAS.genericIndex)
        this.colour.setHex(tint)
        layer.mesh.setColorAt(slot, this.colour.set(this.colour.r / this.genericBody.r, this.colour.g / this.genericBody.g, this.colour.b / this.genericBody.b))
      } else {
        layer.livery.setX(slot, this.liveries[i])
        layer.mesh.setColorAt(slot, this.colour.setRGB(1, 1, 1))
      }
    } else layer.mesh.setColorAt(slot, tint >= 0 ? this.colour.setHex(tint) : this.colour.set(liveryBodyColour(this.liveries[i])))
  }

  /**
   * Brings the instanced meshes up to date. Boxes outside the `frustum` get no slot (per-instance culling: the
   * InstancedMesh itself is never culled). A box keeps its slot while it stays in the same size, LOD and view; only
   * boxes whose data changed, or that changed layer, are written, and each buffer is uploaded by the range written.
   * With nothing changed and the camera still, the cull and LOD pass is skipped and no byte is uploaded.
   */
  end(cameraPosition: THREE.Vector3, frustum?: THREE.Frustum): ContainerRenderStats {
    if (this.immediate) {
      for (let k = 0; k < this.n; k++) if (this.has[k] && this.stampOf[k] !== this.stamp) this.remove(k)
    }
    const camKey = [cameraPosition.x, cameraPosition.y, cameraPosition.z]
    if (frustum) for (const p of frustum.planes) camKey.push(p.normal.x, p.normal.y, p.normal.z, p.constant)
    const prev = this.camKey
    if (!prev || prev.length !== camKey.length || camKey.some((v, i) => v !== prev[i])) {
      this.camKey = camKey
      this.passNeeded = true
      this.closeupDirty = true // the cull result, the facing of faces and the reach all depend on the camera
      if (!prev || prev[0] !== camKey[0] || prev[1] !== camKey[1] || prev[2] !== camKey[2]) this.reachFresh = false
    }
    if (this.passNeeded) this.pass(cameraPosition, frustum)
    this.passNeeded = false
    if (this.closeupDirty) {
      this.closeupDirty = false
      this.closeups.begin(cameraPosition)
      if (this.lods && this.markingsSource && this.options.closeupFaceBudget > 0) this.offerCloseups(cameraPosition)
      this.closeups.end()
    }
    // hero faces waiting for the camera to settle, for their allowance turn, or fading in: keep redrawing a still camera
    if (this.hero?.busy) this.closeupDirty = true

    // write the boxes whose data or slot changed
    for (const key of this.dirtyList) {
      this.needWrite[key] = false
      const li = this.layerIdx[key]
      if (li < 0 || !this.has[key]) continue
      const slot = this.slotOf[key]
      this.writeBox(this.layerList[li], slot, key)
      if (slot < this.layerLo[li]) this.layerLo[li] = slot
      if (slot > this.layerHi[li]) this.layerHi[li] = slot
    }
    this.dirtyList.length = 0

    let instanceBytes = 0
    this.layerList.forEach((layer, li) => {
      const slots = this.layerKeys[li].length
      layer.mesh.count = slots
      const lo = this.layerLo[li]
      const hi = this.layerHi[li]
      this.layerLo[li] = Infinity
      this.layerHi[li] = -1
      if (hi < lo) return // nothing written: no upload
      const attrs: THREE.BufferAttribute[] = [layer.mesh.instanceMatrix]
      if (layer.livery) attrs.push(layer.livery)
      if (layer.mesh.instanceColor) attrs.push(layer.mesh.instanceColor)
      const whole = hi - lo + 1 > slots / 2
      for (const a of attrs) {
        a.clearUpdateRanges()
        if (!whole) a.addUpdateRange(lo * a.itemSize, (hi - lo + 1) * a.itemSize)
        a.needsUpdate = true
        instanceBytes += uploadBytes(a)
      }
    })
    if (this.recording) this.recordAll()
    this.lastStats = { drawn: this.count, posed: this.posed, lod0: this.lastLod0, lod1: this.count - this.lastLod0, closeup: this.closeups.count, closeupFaces: this.closeups.faces, heroFaces: this.closeups.heroFaces, heroPrepared: this.closeups.heroPrepared, heroMarks: this.closeups.heroMarkStats(), heroCost: this.closeups.heroCost(), culled: this.lastCulled, instanceBytes, assets: this.lods ? 'loaded' : 'placeholder' }
    this.posed = 0
    return this.lastStats
  }

  /** Cull, choose LODs and (re)slot every present box. */
  private pass(cam: THREE.Vector3, frustum?: THREE.Frustum): void {
    const seen = this.cull(frustum)
    const lod = this.lods ? this.chooseLods(cam, seen) : null
    let lod0 = 0
    let culled = 0
    for (let k = 0; k < this.n; k++) {
      if (!this.has[k]) {
        if (this.layerIdx[k] >= 0) this.detach(k)
        continue
      }
      const level = lod ? lod[k] : 1
      this.levelOf[k] = level
      let target: number
      if (seen && !seen[k]) {
        culled++
        target = -1
      } else {
        if (lod) {
          if (level !== 1) lod0++
          this.lastLod[k] = level
        }
        const s = SIZES.indexOf(this.sizes[k])
        target = lod ? s * 2 + level : s
      }
      if (target !== this.layerIdx[k]) {
        if (this.layerIdx[k] >= 0) this.detach(k)
        if (target >= 0) this.attach(k, target)
      }
    }
    this.lastLod0 = lod0
    this.lastCulled = culled
  }

  /** Records every drawn box (after a pass, from the slots: a box not rewritten this frame is still drawn). */
  private recordAll(): void {
    this.drawn = []
    this.layerList.forEach((layer, li) => {
      const colour = layer.mesh.instanceColor
      this.layerKeys[li].forEach((key, slot) => {
        this.drawn.push({
          key,
          layer: layer.mesh.name,
          matrix: Array.from(layer.mesh.instanceMatrix.array.subarray(slot * 16, slot * 16 + 16)),
          livery: layer.livery ? layer.livery.getX(slot) : -1,
          colour: colour ? this.colour.setRGB(colour.getX(slot), colour.getY(slot), colour.getZ(slot)).getHex() : -1,
        })
      })
    })
  }

  private readonly sphere = new THREE.Sphere()

  /** 1 per box key that is inside the frustum (a 40 ft box fits in a 7 m radius sphere); null = no culling. */
  private cull(frustum?: THREE.Frustum): Uint8Array | null {
    if (!frustum) {
      this.seenCache = null
      return null
    }
    if (this.visible.length < this.n) this.visible = new Uint8Array(Math.max(this.n, this.visible.length * 2))
    this.sphere.radius = BOX_SPHERE_M
    for (let i = 0; i < this.n; i++) {
      if (!this.has[i]) continue
      this.sphere.center.set(this.xs[i], this.ys[i] + 1.3, this.zs[i])
      this.visible[i] = frustum.intersectsSphere(this.sphere) ? 1 : 0
    }
    this.seenCache = this.visible
    return this.visible
  }

  private visible: Uint8Array = new Uint8Array(0)
  /** The cull result of the last pass (kept while passes are skipped, for the close-up offer). */
  private seenCache: Uint8Array | null = null

  /**
   * Offers the close-up level the boxes within range, each with its exposed faces: stacked yard boxes lose the faces their
   * neighbours touch (a coarse grid of the yard boxes in range finds them), every other box shows all six.
   */
  private offerCloseups(cam: THREE.Vector3): void {
    const seen = this.seenCache
    const { hysteresis, closeupDistanceM, closeupFaceBudget } = this.options
    this.closeups.setLimits({ budget: closeupFaceBudget, distanceM: closeupDistanceM, hysteresis })
    // boxes whose faces can be drawn: within the distance (plus the hysteresis band and half a box), kept in `reachKeys`
    if (!this.reachFresh) {
      this.reachCam.copy(cam)
      this.reachKeys.clear()
      for (let i = 0; i < this.n; i++) if (this.has[i] && this.withinReach(this.xs[i], this.ys[i], this.zs[i])) this.reachKeys.add(i)
      this.reachFresh = true
    }
    const grid = new Map<number, PlacedBox[]>()
    const near: number[] = []
    const placed: PlacedBox[] = []
    const cell = (x: number, z: number) => (Math.floor(x / GRID_CELL_M) * 73856093) ^ (Math.floor(z / GRID_CELL_M) * 19349663)
    for (const i of Array.from(this.reachKeys).sort((a, b) => a - b)) {
      if (seen && !seen[i]) {
        // out of view, but a yard box still hides its neighbours' faces
        if (!this.yards[i]) continue
      } else near.push(i)
      if (!this.yards[i]) continue
      const d = CONTAINER_DIMS[this.sizes[i]]
      const box: PlacedBox = { x: this.xs[i], y: this.ys[i] + d.height / 2, z: this.zs[i], yaw: this.yaws[i], length: d.length, width: d.width, height: d.height }
      placed[i] = box
      const k = cell(box.x, box.z)
      const list = grid.get(k)
      if (list) list.push(box)
      else grid.set(k, [box])
    }
    const nearby: PlacedBox[] = []
    for (const i of near) {
      let faces: ExposedFaces
      if (this.yards[i]) {
        const box = placed[i]
        nearby.length = 0
        for (let gx = -1; gx <= 1; gx++) {
          for (let gz = -1; gz <= 1; gz++) {
            const list = grid.get(cell(box.x + gx * GRID_CELL_M, box.z + gz * GRID_CELL_M))
            if (list) for (const o of list) nearby.push(o)
          }
        }
        faces = exposedFaces('yard', neighboursOf(box, nearby))
      } else faces = exposedFaces('free')
      const key = i
      this.closeups.offer(key, this.sizes[i], this.xs[i], this.ys[i], this.zs[i], this.yaws[i], faces, () => this.markingsSource!(key), this.tints[i])
    }
  }

  /** LOD per box key: nearest within range get LOD0, capped at lod0Cap. Culled boxes are never LOD0. */
  private chooseLods(cam: THREE.Vector3, seen: Uint8Array | null): Uint8Array {
    const { lod0Cap, lod0DistanceM, hysteresis } = this.options
    if (this.dist2.length < this.n) this.dist2 = new Float64Array(Math.max(this.n, this.dist2.length * 2))
    const lod = new Uint8Array(this.n).fill(1)
    const near: number[] = []
    const r2 = lod0DistanceM * lod0DistanceM
    const r2Sticky = r2 * hysteresis * hysteresis
    for (let i = 0; i < this.n; i++) {
      if (!this.has[i]) continue
      const dx = this.xs[i] - cam.x
      const dy = this.ys[i] - cam.y
      const dz = this.zs[i] - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      this.dist2[i] = d2
      if (seen && !seen[i]) continue
      const limit = this.lastLod[i] === 0 ? r2Sticky : r2
      if (d2 <= limit) near.push(i)
    }
    if (near.length > lod0Cap) near.sort((a, b) => this.dist2[a] - this.dist2[b])
    for (let k = 0; k < Math.min(lod0Cap, near.length); k++) lod[near[k]] = 0
    return lod
  }

  stats(): ContainerRenderStats {
    return this.lastStats
  }

  /** Draw calls and triangles of the container layers last frame. */
  cost(): { drawCalls: number; triangles: number } {
    let drawCalls = 0
    let triangles = 0
    for (const { mesh } of this.layerList) {
      if (mesh.count === 0) continue
      drawCalls++
      const g = mesh.geometry
      triangles += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * mesh.count
    }
    const c = this.closeups.cost()
    return { drawCalls: drawCalls + c.drawCalls, triangles: triangles + c.triangles }
  }

  renderedContainer(key: number): RenderedContainer | undefined {
    if (!this.has[key]) return undefined
    return { size: this.sizes[key], livery: this.liveries[key], lod: this.lods ? (this.levelOf[key] === 1 ? 1 : 0) : 1, tint: this.tints[key] }
  }

  dispose(): void {
    this.closeups.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
