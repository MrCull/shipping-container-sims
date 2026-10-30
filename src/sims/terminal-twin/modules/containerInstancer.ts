/**
 * Instanced container renderer with LODs and per-instance liveries.
 *
 * Until the GLBs have loaded it draws procedural placeholder boxes (one
 * InstancedMesh per size, coloured by livery). Once `setAssets` is called it
 * draws one InstancedMesh per size × LOD:
 *   - LOD0 (~300-440 triangles) for at most `lod0Cap` boxes nearest the camera
 *     and within `lod0DistanceM` (with hysteresis so boxes do not flicker
 *     between LODs at the threshold);
 *   - Close-up (#119) above LOD0: at most `closeupCap` boxes within `closeupDistanceM` are drawn as individual
 *     detailed meshes with textures painted from their markings (`containerCloseups.ts`); they count as LOD0
 *     in the stats and are left out of the instanced layers;
 *   - LOD1 (12 triangles, normal-mapped corrugation at the same pitch) for the rest.
 * Each instance carries a `liveryIndex` attribute (atlas tile = shipping line).
 *
 * Per frame: `begin()`, `push(...)` for every visible box, then `end(camera)`.
 * Nothing here is reactive.
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import { liveryBodyColour, type ContainerAssets } from './containerAssets'
import { CONTAINER_DIMS } from './sceneModel'
import { ContainerCloseups, type CloseupSource } from './containerCloseups'

const SIZES: ContainerSize[] = ['20', '40', '40HC']

export interface ContainerLodOptions {
  /** Max boxes drawn at LOD0. */
  lod0Cap: number
  /** Boxes beyond this camera distance always use LOD1. */
  lod0DistanceM: number
  /** A box already at LOD0 keeps it out to lod0DistanceM × this factor. */
  hysteresis: number
  /** Max boxes drawn as close-ups (0 = off). */
  closeupCap: number
  /** Boxes beyond this camera distance are never close-ups (a close-up box keeps it out to this x `hysteresis`). */
  closeupDistanceM: number
}

export const DEFAULT_LOD_OPTIONS: ContainerLodOptions = { lod0Cap: 300, lod0DistanceM: 140, hysteresis: 1.15, closeupCap: 48, closeupDistanceM: 35 }

/** Close-up textures kept per box beyond the ones in use. */
const CLOSEUP_CACHE_CAP = 64

export interface ContainerRenderStats {
  /** Boxes posed this frame (visible or not). */
  drawn: number
  lod0: number
  /** Everything not at LOD0, culled boxes included, so lod0 + lod1 = drawn. */
  lod1: number
  /** Of `lod0`: the boxes drawn as close-ups (#119). */
  closeup: number
  /** Boxes outside the camera frustum, not written to the GPU (0 without a frustum). */
  culled: number
  assets: 'placeholder' | 'loaded'
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
}

export class ContainerInstancer {
  readonly group = new THREE.Group()
  private readonly options: ContainerLodOptions
  private readonly capacity: Record<ContainerSize, number>
  private placeholders: Record<ContainerSize, Layer> | null = null
  private lods: Record<ContainerSize, [Layer, Layer]> | null = null
  private disposables: { dispose(): void }[] = []
  // Per-frame input (structure of arrays, reused).
  private n = 0
  private keys: number[] = []
  private sizes: ContainerSize[] = []
  private xs: number[] = []
  private ys: number[] = []
  private zs: number[] = []
  private liveries: number[] = []
  private yaws: number[] = []
  private dist2: Float64Array = new Float64Array(0)
  /** LOD per key from the previous frame (hysteresis). */
  private lastLod = new Map<number, 0 | 1 | 2>()
  private rendered = new Map<number, RenderedContainer>()
  private lastStats: ContainerRenderStats = { drawn: 0, lod0: 0, lod1: 0, closeup: 0, culled: 0, assets: 'placeholder' }
  private readonly matrix = new THREE.Matrix4()
  private readonly colour = new THREE.Color()
  private readonly closeups: ContainerCloseups
  private markingsSource: ((key: number) => CloseupSource) | null = null

  constructor(
    capacity: Partial<Record<ContainerSize, number>>,
    options: Partial<ContainerLodOptions> = {},
    closeups: ContainerCloseups = new ContainerCloseups(CLOSEUP_CACHE_CAP),
  ) {
    this.closeups = closeups
    this.group.add(closeups.group)
    this.options = { ...DEFAULT_LOD_OPTIONS, ...options }
    this.capacity = { '20': capacity['20'] ?? 0, '40': capacity['40'] ?? 0, '40HC': capacity['40HC'] ?? 0 }
    this.group.name = 'containers'
    const mat = this.track(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }))
    this.placeholders = {} as Record<ContainerSize, Layer>
    for (const size of SIZES) {
      const d = CONTAINER_DIMS[size]
      const geo = this.track(new THREE.BoxGeometry(d.length, d.height, d.width).translate(0, d.height / 2, 0))
      this.placeholders[size] = { mesh: this.instanced(geo, mat, size, 'placeholder'), livery: null }
    }
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
        return { mesh: this.instanced(geo, mat, size, tag), livery }
      }
      const m = assets.sizes[size]
      this.lods[size] = [make(m.lod0, assets.lod0Material, 'lod0'), make(m.lod1, assets.lod1Material, 'lod1')]
    }
    for (const layer of Object.values(this.placeholders ?? {})) {
      this.group.remove(layer.mesh)
    }
    this.placeholders = null
  }

  get assetsLoaded(): boolean {
    return this.lods !== null
  }

  begin(): void {
    this.n = 0
  }

  /** One box: `key` is a stable id (e.g. container index), centre position in metres, yaw about Y (0 = length along X). */
  push(key: number, size: ContainerSize, cx: number, cy: number, cz: number, livery: number, yaw = 0): void {
    const i = this.n++
    this.keys[i] = key
    this.sizes[i] = size
    this.xs[i] = cx
    this.ys[i] = cy - CONTAINER_DIMS[size].height / 2 // models have their origin at the bottom centre
    this.zs[i] = cz
    this.liveries[i] = livery
    this.yaws[i] = yaw
  }

  /** What a close-up box is painted from, by the key given to `push` (without one there are no close-ups). */
  setMarkingsSource(source: (key: number) => CloseupSource): void {
    this.markingsSource = source
  }

  /** Retune the LOD0 range and cap (quality settings). */
  setLodOptions(next: Partial<ContainerLodOptions>): void {
    Object.assign(this.options, next)
  }

  /**
   * Writes the pushed boxes into the instanced meshes. With a `frustum`, boxes outside it are not
   * written at all (per-instance culling: the InstancedMesh itself is never culled), so a
   * 30,000-box yard costs only what the camera can see.
   */
  end(cameraPosition: THREE.Vector3, frustum?: THREE.Frustum): ContainerRenderStats {
    this.rendered.clear()
    const counts: Record<string, number> = {}
    const write = (layer: Layer, i: number) => {
      const slot = counts[layer.mesh.name] ?? 0
      counts[layer.mesh.name] = slot + 1
      this.matrix.makeRotationY(this.yaws[i]).setPosition(this.xs[i], this.ys[i], this.zs[i])
      layer.mesh.setMatrixAt(slot, this.matrix)
      if (layer.livery) layer.livery.setX(slot, this.liveries[i])
      else layer.mesh.setColorAt(slot, this.colour.set(liveryBodyColour(this.liveries[i])))
    }

    const seen = this.cull(frustum)
    let lod0 = 0
    let closeup = 0
    let culled = 0
    this.closeups.begin()
    if (this.lods) {
      const lod = this.chooseLods(cameraPosition, seen)
      for (let i = 0; i < this.n; i++) {
        const level = lod[i]
        this.rendered.set(this.keys[i], { size: this.sizes[i], livery: this.liveries[i], lod: level === 1 ? 1 : 0 })
        if (seen && !seen[i]) {
          culled++
          continue
        }
        if (level !== 1) lod0++
        this.lastLod.set(this.keys[i], level as 0 | 1 | 2)
        if (level === 2) {
          closeup++
          const key = this.keys[i]
          this.closeups.show(key, this.sizes[i], this.xs[i], this.ys[i], this.zs[i], this.yaws[i], () => this.markingsSource!(key)!)
          continue
        }
        write(this.lods[this.sizes[i]][level], i)
      }
    } else if (this.placeholders) {
      for (let i = 0; i < this.n; i++) {
        this.rendered.set(this.keys[i], { size: this.sizes[i], livery: this.liveries[i], lod: 1 })
        if (seen && !seen[i]) {
          culled++
          continue
        }
        write(this.placeholders[this.sizes[i]], i)
      }
    }
    this.closeups.end()
    const layers: Layer[] = this.lods
      ? Object.values(this.lods).flat()
      : Object.values(this.placeholders ?? {})
    for (const layer of layers) {
      layer.mesh.count = counts[layer.mesh.name] ?? 0
      layer.mesh.instanceMatrix.needsUpdate = true
      if (layer.livery) layer.livery.needsUpdate = true
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true
    }
    this.lastStats = { drawn: this.n, lod0, lod1: this.n - lod0, closeup, culled, assets: this.lods ? 'loaded' : 'placeholder' }
    return this.lastStats
  }

  private readonly sphere = new THREE.Sphere()

  /** 1 per pushed box that is inside the frustum (a 40 ft box fits in a 7 m radius sphere); null = no culling. */
  private cull(frustum?: THREE.Frustum): Uint8Array | null {
    if (!frustum) return null
    if (this.visible.length < this.n) this.visible = new Uint8Array(Math.max(this.n, this.visible.length * 2))
    this.sphere.radius = 7.5
    for (let i = 0; i < this.n; i++) {
      this.sphere.center.set(this.xs[i], this.ys[i] + 1.3, this.zs[i])
      this.visible[i] = frustum.intersectsSphere(this.sphere) ? 1 : 0
    }
    return this.visible
  }

  private visible: Uint8Array = new Uint8Array(0)

  /** LOD per pushed box: nearest within range get LOD0, capped at lod0Cap. Culled boxes are never LOD0. */
  private chooseLods(cam: THREE.Vector3, seen: Uint8Array | null): Uint8Array {
    const { lod0Cap, lod0DistanceM, hysteresis, closeupCap, closeupDistanceM } = this.options
    if (this.dist2.length < this.n) this.dist2 = new Float64Array(Math.max(this.n, this.dist2.length * 2))
    const lod = new Uint8Array(this.n).fill(1)
    const near: number[] = []
    const nearest: number[] = []
    const c2 = closeupDistanceM * closeupDistanceM
    const c2Sticky = c2 * hysteresis * hysteresis
    const canCloseup = closeupCap > 0 && this.markingsSource !== null
    const r2 = lod0DistanceM * lod0DistanceM
    const r2Sticky = r2 * hysteresis * hysteresis
    for (let i = 0; i < this.n; i++) {
      const dx = this.xs[i] - cam.x
      const dy = this.ys[i] - cam.y
      const dz = this.zs[i] - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      this.dist2[i] = d2
      if (seen && !seen[i]) continue
      const last = this.lastLod.get(this.keys[i])
      if (canCloseup && d2 <= (last === 2 ? c2Sticky : c2)) nearest.push(i)
      const limit = last === 0 || last === 2 ? r2Sticky : r2
      if (d2 <= limit) near.push(i)
    }
    if (nearest.length > closeupCap) nearest.sort((a, b) => this.dist2[a] - this.dist2[b])
    for (let k = 0; k < Math.min(closeupCap, nearest.length); k++) lod[nearest[k]] = 2
    const rest = near.filter((i) => lod[i] !== 2)
    if (rest.length > lod0Cap) rest.sort((a, b) => this.dist2[a] - this.dist2[b])
    for (let k = 0; k < Math.min(lod0Cap, rest.length); k++) lod[rest[k]] = 0
    return lod
  }

  stats(): ContainerRenderStats {
    return this.lastStats
  }

  /** Draw calls and triangles of the container layers last frame. */
  cost(): { drawCalls: number; triangles: number } {
    let drawCalls = 0
    let triangles = 0
    const layers: Layer[] = this.lods ? Object.values(this.lods).flat() : Object.values(this.placeholders ?? {})
    for (const { mesh } of layers) {
      if (mesh.count === 0) continue
      drawCalls++
      const g = mesh.geometry
      triangles += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * mesh.count
    }
    const c = this.closeups.cost()
    return { drawCalls: drawCalls + c.drawCalls, triangles: triangles + c.triangles }
  }

  renderedContainer(key: number): RenderedContainer | undefined {
    return this.rendered.get(key)
  }

  dispose(): void {
    this.closeups.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
