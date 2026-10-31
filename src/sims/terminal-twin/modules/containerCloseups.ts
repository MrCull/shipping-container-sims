/**
 * Close-up container boxes (#119): the detail level above LOD0. At most `cap` boxes near the camera are drawn as
 * individual meshes with the detailed geometry (`closeupGeometry.ts`), a per-box texture painted from that box's
 * markings, and the shared corrugation / roughness maps. The instancer decides which boxes (it owns the LOD choice
 * and its hysteresis) and calls `begin()`, `show(...)` for each, `end()`.
 *
 * Textures are cached per box and evicted least-recently-shown first once more than `cacheCap` are held, so a
 * camera that sweeps along a stack neither repaints every frame nor grows without bound. Boxes shown this frame
 * are never evicted.
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import type { ContainerMarkings } from './containerMarkings'
import { closeupGeometry } from './closeupGeometry'
import { makeContainerTexture, sharedContainerMaps } from './containerTextures'

/** What a close-up box is painted from. */
export interface CloseupSource {
  markings: ContainerMarkings
  /** Livery body colour (CSS). */
  bodyColour: string
}

/** Creates a box's texture; injectable so tests need no canvas. */
export type TextureFactory = (source: CloseupSource, size: ContainerSize) => THREE.Texture

interface Entry {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  texture: THREE.Texture
  size: ContainerSize
  /** The colour-by tint the texture was painted for (-1: the livery). */
  tint: number
  lastShown: number
}

export class ContainerCloseups {
  readonly group = new THREE.Group()
  private entries = new Map<number, Entry>()
  private frame = 0
  private shown = 0
  private maps: { normal: THREE.Texture; roughness: THREE.Texture } | null = null

  constructor(
    private cacheCap: number,
    private readonly makeTexture: TextureFactory = (s, size) => makeContainerTexture(s.markings, size, s.bodyColour),
    private readonly getMaps: () => { normal: THREE.Texture; roughness: THREE.Texture } | null = sharedContainerMaps,
  ) {
    this.group.name = 'containers-closeup'
  }

  setCacheCap(cap: number): void {
    this.cacheCap = cap
  }

  begin(): void {
    this.frame++
    this.shown = 0
  }

  /** Draws box `key` this frame (a changed `tint`, the colour by tint, paints it again): origin at the bottom centre, yaw about Y. `source` is called only when the box has no cached texture. */
  show(key: number, size: ContainerSize, x: number, y: number, z: number, yaw: number, source: () => CloseupSource, tint = -1): void {
    let e = this.entries.get(key)
    if (!e || e.size !== size || e.tint !== tint) {
      if (e) this.drop(key, e)
      const maps = (this.maps ??= this.getMaps())
      const texture = this.makeTexture(source(), size)
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        normalMap: maps?.normal ?? null,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughnessMap: maps?.roughness ?? null,
        roughness: 0.85,
        metalness: 0.15,
      })
      const mesh = new THREE.Mesh(closeupGeometry(size), material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = true
      this.group.add(mesh)
      e = { mesh, material, texture, size, tint, lastShown: 0 }
      this.entries.set(key, e)
    }
    e.lastShown = this.frame
    e.mesh.visible = true
    e.mesh.position.set(x, y, z)
    e.mesh.rotation.y = yaw
    this.shown++
  }

  /** Hides what was not shown this frame and evicts the least recently shown textures beyond the cache cap. */
  end(): void {
    const stale: [number, Entry][] = []
    for (const [key, e] of this.entries) {
      if (e.lastShown !== this.frame) {
        e.mesh.visible = false
        stale.push([key, e])
      }
    }
    let over = this.entries.size - Math.max(this.cacheCap, this.shown)
    if (over > 0) {
      stale.sort((a, b) => a[1].lastShown - b[1].lastShown)
      for (const [key, e] of stale) {
        if (over-- <= 0) break
        this.drop(key, e)
      }
    }
  }

  private drop(key: number, e: Entry): void {
    this.group.remove(e.mesh)
    e.material.dispose()
    e.texture.dispose()
    this.entries.delete(key)
  }

  /** Boxes drawn in the last frame. */
  get count(): number {
    return this.shown
  }

  /** Textures currently held (drawn or cached). */
  get cached(): number {
    return this.entries.size
  }

  /** Draw calls and triangles of the boxes shown last frame. */
  cost(): { drawCalls: number; triangles: number } {
    let drawCalls = 0
    let triangles = 0
    for (const e of this.entries.values()) {
      if (!e.mesh.visible) continue
      drawCalls++
      const g = e.mesh.geometry
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3
    }
    return { drawCalls, triangles }
  }

  dispose(): void {
    for (const [key, e] of [...this.entries]) this.drop(key, e)
  }
}
