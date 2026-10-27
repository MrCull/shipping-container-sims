/**
 * Instanced container renderer with LODs and per-instance liveries.
 *
 * Until the GLBs have loaded it draws procedural placeholder boxes (one
 * InstancedMesh per size, coloured by livery). Once `setAssets` is called it
 * draws one InstancedMesh per size × LOD:
 *   - LOD0 (~300-440 triangles) for at most `lod0Cap` boxes nearest the camera
 *     and within `lod0DistanceM` (with hysteresis so boxes do not flicker
 *     between LODs at the threshold);
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

const SIZES: ContainerSize[] = ['20', '40', '40HC']

export interface ContainerLodOptions {
  /** Max boxes drawn at LOD0. */
  lod0Cap: number
  /** Boxes beyond this camera distance always use LOD1. */
  lod0DistanceM: number
  /** A box already at LOD0 keeps it out to lod0DistanceM × this factor. */
  hysteresis: number
}

export const DEFAULT_LOD_OPTIONS: ContainerLodOptions = { lod0Cap: 300, lod0DistanceM: 140, hysteresis: 1.15 }

export interface ContainerRenderStats {
  drawn: number
  lod0: number
  lod1: number
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
  private dist2: Float64Array = new Float64Array(0)
  /** LOD per key from the previous frame (hysteresis). */
  private lastLod = new Map<number, 0 | 1>()
  private rendered = new Map<number, RenderedContainer>()
  private lastStats: ContainerRenderStats = { drawn: 0, lod0: 0, lod1: 0, assets: 'placeholder' }
  private readonly matrix = new THREE.Matrix4()
  private readonly colour = new THREE.Color()

  constructor(capacity: Partial<Record<ContainerSize, number>>, options: Partial<ContainerLodOptions> = {}) {
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

  /** One box: `key` is a stable id (e.g. container index), centre position in metres. */
  push(key: number, size: ContainerSize, cx: number, cy: number, cz: number, livery: number): void {
    const i = this.n++
    this.keys[i] = key
    this.sizes[i] = size
    this.xs[i] = cx
    this.ys[i] = cy - CONTAINER_DIMS[size].height / 2 // models have their origin at the bottom centre
    this.zs[i] = cz
    this.liveries[i] = livery
  }

  end(cameraPosition: THREE.Vector3): ContainerRenderStats {
    this.rendered.clear()
    const counts: Record<string, number> = {}
    const write = (layer: Layer, i: number) => {
      const slot = counts[layer.mesh.name] ?? 0
      counts[layer.mesh.name] = slot + 1
      this.matrix.makeTranslation(this.xs[i], this.ys[i], this.zs[i])
      layer.mesh.setMatrixAt(slot, this.matrix)
      if (layer.livery) layer.livery.setX(slot, this.liveries[i])
      else layer.mesh.setColorAt(slot, this.colour.set(liveryBodyColour(this.liveries[i])))
    }

    let lod0 = 0
    if (this.lods) {
      const lod = this.chooseLods(cameraPosition)
      for (let i = 0; i < this.n; i++) {
        const level = lod[i] as 0 | 1
        if (level === 0) lod0++
        write(this.lods[this.sizes[i]][level], i)
        this.lastLod.set(this.keys[i], level)
        this.rendered.set(this.keys[i], { size: this.sizes[i], livery: this.liveries[i], lod: level })
      }
    } else if (this.placeholders) {
      for (let i = 0; i < this.n; i++) {
        write(this.placeholders[this.sizes[i]], i)
        this.rendered.set(this.keys[i], { size: this.sizes[i], livery: this.liveries[i], lod: 1 })
      }
    }
    const layers: Layer[] = this.lods
      ? Object.values(this.lods).flat()
      : Object.values(this.placeholders ?? {})
    for (const layer of layers) {
      layer.mesh.count = counts[layer.mesh.name] ?? 0
      layer.mesh.instanceMatrix.needsUpdate = true
      if (layer.livery) layer.livery.needsUpdate = true
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true
    }
    this.lastStats = { drawn: this.n, lod0, lod1: this.n - lod0, assets: this.lods ? 'loaded' : 'placeholder' }
    return this.lastStats
  }

  /** LOD per pushed box: nearest within range get LOD0, capped at lod0Cap. */
  private chooseLods(cam: THREE.Vector3): Uint8Array {
    const { lod0Cap, lod0DistanceM, hysteresis } = this.options
    if (this.dist2.length < this.n) this.dist2 = new Float64Array(Math.max(this.n, this.dist2.length * 2))
    const lod = new Uint8Array(this.n).fill(1)
    const near: number[] = []
    const r2 = lod0DistanceM * lod0DistanceM
    const r2Sticky = r2 * hysteresis * hysteresis
    for (let i = 0; i < this.n; i++) {
      const dx = this.xs[i] - cam.x
      const dy = this.ys[i] - cam.y
      const dz = this.zs[i] - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      this.dist2[i] = d2
      const limit = this.lastLod.get(this.keys[i]) === 0 ? r2Sticky : r2
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
    const layers: Layer[] = this.lods ? Object.values(this.lods).flat() : Object.values(this.placeholders ?? {})
    for (const { mesh } of layers) {
      if (mesh.count === 0) continue
      drawCalls++
      const g = mesh.geometry
      triangles += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * mesh.count
    }
    return { drawCalls, triangles }
  }

  renderedContainer(key: number): RenderedContainer | undefined {
    return this.rendered.get(key)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
