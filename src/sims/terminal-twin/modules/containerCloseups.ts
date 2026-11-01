/**
 * Close-up container markings (#119, #143): the detail level above LOD0. Instead of one mesh and one canvas per box,
 * markings are drawn per visible face. The instancer offers every box near the camera together with its exposed
 * faces (`exposedFaces.ts`); faces turned away from the camera are dropped, the rest compete for a face budget
 * (`closeupFaceBudget.ts`: nearest first, with hysteresis). A chosen face is one instance of a shared unit quad
 * that samples a tile of a texture atlas painted from the box's markings, over the plain instanced box underneath
 * (which stays the fallback for every face without a tile). Draw calls grow by one per atlas page (a page holds
 * 20 to 32 tiles), not per box.
 *
 * Atlas pages exist per face kind (long sides, roofs, ends), are created on demand up to the budget, keep their
 * tiles painted while the face is cached, and give up the least recently shown tile when full. Painting needs a
 * canvas, so it sits behind `AtlasBackend` (a stub in Vitest).
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import type { ContainerMarkings } from './containerMarkings'
import type { Region } from './closeupGeometry'
import { CORRUGATION_PITCH_M } from './closeupGeometry'
import { selectFaces, type FaceCandidate } from './closeupFaceBudget'
import { canvasAtlasBackend, sharedContainerMaps } from './containerTextures'
import { FACES, visibleFaceList, type ExposedFaces, type Face } from './exposedFaces'

/** What a close-up box is painted from. */
export interface CloseupSource {
  markings: ContainerMarkings
  /** Livery body colour (CSS). */
  bodyColour: string
}

export interface AtlasPage {
  texture: THREE.Texture
  ctx: CanvasRenderingContext2D | null
}

/** One face to paint into a tile of a page. */
export interface PaintJob {
  face: Face
  page: AtlasPage
  rect: Region
}

/** Creates atlas pages and paints a box's faces into tiles; injectable so tests need no canvas. */
export interface AtlasBackend {
  createPage(w: number, h: number): AtlasPage
  paint(source: CloseupSource, size: ContainerSize, jobs: PaintJob[]): void
}

type Kind = 'side' | 'roof' | 'end'

export const PAGE_PX = 1024
/** Tile sizes in pixels per face kind (the faces' own aspect is restored by the quad). */
export const TILE_PX: Record<Kind, { w: number; h: number }> = {
  side: { w: 512, h: 96 },
  roof: { w: 512, h: 64 },
  end: { w: 192, h: 192 },
}

const kindOf = (face: Face): Kind | null => (face === 'bottom' ? null : face === 'top' ? 'roof' : face === 'door' || face === 'front' ? 'end' : 'side')

const DIMS: Record<ContainerSize, { length: number; height: number; width: number }> = {
  '20': { length: 6.058, height: 2.591, width: 2.438 },
  '40': { length: 12.192, height: 2.591, width: 2.438 },
  '40HC': { length: 12.192, height: 2.896, width: 2.438 },
}

/** A decal sits this far off the box so it never z-fights with it. */
const OFFSET_M = 0.006
const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Per face: the quad's orientation in the box frame (a unit quad faces +Z with u along +X). */
const FACE_QUAT: Record<Exclude<Face, 'bottom'>, THREE.Quaternion> = {
  sideP: new THREE.Quaternion(),
  sideN: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI),
  door: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2),
  front: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -Math.PI / 2),
  top: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
}

/** Face centre (box frame, origin at the bottom centre), outward normal and size in metres. */
function faceFrame(face: Exclude<Face, 'bottom'>, size: ContainerSize): { c: [number, number, number]; n: [number, number, number]; w: number; h: number } {
  const { length: L, height: H, width: W } = DIMS[size]
  switch (face) {
    case 'sideP':
      return { c: [0, H / 2, W / 2], n: [0, 0, 1], w: L, h: H }
    case 'sideN':
      return { c: [0, H / 2, -W / 2], n: [0, 0, -1], w: L, h: H }
    case 'door':
      return { c: [L / 2, H / 2, 0], n: [1, 0, 0], w: W, h: H }
    case 'front':
      return { c: [-L / 2, H / 2, 0], n: [-1, 0, 0], w: W, h: H }
    case 'top':
      return { c: [0, H, 0], n: [0, 1, 0], w: L, h: W }
  }
}

interface Page {
  atlas: AtlasPage
  mesh: THREE.InstancedMesh
  uvRect: THREE.InstancedBufferAttribute
  sizeM: THREE.InstancedBufferAttribute
  cols: number
  /** Slot indexes not in use. */
  free: number[]
}

interface Slot {
  kind: Kind
  page: Page
  index: number
  size: ContainerSize
  tint: number
  lastShown: number
  painted: boolean
}

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

export interface CloseupLimits {
  /** Max faces drawn (0 = off). */
  budget: number
  /** Faces beyond this camera distance are never drawn (a drawn face keeps it out to this x `hysteresis`). */
  distanceM: number
  hysteresis: number
}

export class ContainerCloseups {
  readonly group = new THREE.Group()
  private limits: CloseupLimits = { budget: 400, distanceM: 35, hysteresis: 1.15 }
  private pages: Record<Kind, Page[]> = { side: [], roof: [], end: [] }
  private slots = new Map<number, Slot>()
  private frame = 0
  private faceCount = 0
  private boxCount = 0
  private previous = new Set<number>()
  private cam = new THREE.Vector3()
  // this frame's offers
  private offers: Offer[] = []
  private offerOf = new Map<number, number>()
  private candidates: FaceCandidate[] = []
  private maps: { normal: THREE.Texture; roughness: THREE.Texture } | null | undefined
  private quad: THREE.BufferGeometry | null = null
  private readonly q = new THREE.Quaternion()
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()

  constructor(
    private readonly backend: AtlasBackend = canvasAtlasBackend(),
    private readonly getMaps: () => { normal: THREE.Texture; roughness: THREE.Texture } | null = sharedContainerMaps,
  ) {
    this.group.name = 'containers-closeup'
  }

  setLimits(next: Partial<CloseupLimits>): void {
    Object.assign(this.limits, next)
  }

  begin(camera: THREE.Vector3): void {
    this.frame++
    this.cam.copy(camera)
    this.offers.length = 0
    this.offerOf.clear()
    this.candidates.length = 0
  }

  /**
   * Offers box `key` (origin at the bottom centre, yaw about Y) with the faces that can be seen. Faces turned away
   * from the camera are dropped here. `source` is called only when a face needs painting.
   */
  offer(key: number, size: ContainerSize, x: number, y: number, z: number, yaw: number, faces: ExposedFaces, source: () => CloseupSource, tint = -1): void {
    if (this.limits.budget <= 0) return
    const idx = this.offers.length
    this.offers.push({ key, size, x, y, z, yaw, source, tint })
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    for (const face of visibleFaceList(faces)) {
      if (face === 'bottom') continue
      const f = faceFrame(face, size)
      const wx = x + f.c[0] * cos + f.c[2] * sin
      const wy = y + f.c[1]
      const wz = z - f.c[0] * sin + f.c[2] * cos
      const dx = this.cam.x - wx
      const dy = this.cam.y - wy
      const dz = this.cam.z - wz
      const nx = f.n[0] * cos + f.n[2] * sin
      const nz = -f.n[0] * sin + f.n[2] * cos
      if (nx * dx + f.n[1] * dy + nz * dz <= 0) continue // turned away from the camera
      const id = key * 8 + FACES.indexOf(face)
      this.offerOf.set(id, idx)
      this.candidates.push({ id, d2: dx * dx + dy * dy + dz * dz })
    }
  }

  /** Picks the faces within the budget, paints the new ones and writes the instances. */
  end(): void {
    const { budget, distanceM, hysteresis } = this.limits
    for (const kind of Object.keys(this.pages) as Kind[]) for (const page of this.pages[kind]) page.mesh.count = 0
    this.faceCount = 0
    this.boxCount = 0
    if (budget <= 0) {
      this.previous.clear()
      return
    }
    const chosen = selectFaces(this.candidates, { budget, maxDistM: distanceM, hysteresis }, this.previous)
    this.previous = new Set(chosen)
    // allocate and paint, a box at a time
    const jobsByOffer = new Map<number, PaintJob[]>()
    const boxes = new Set<number>()
    for (const id of chosen) {
      const oi = this.offerOf.get(id)
      if (oi === undefined) continue
      const o = this.offers[oi]
      const face = FACES[id % 8]
      const kind = kindOf(face)
      if (!kind) continue
      let slot = this.slots.get(id)
      if (slot && (slot.size !== o.size || slot.tint !== o.tint)) slot.painted = false
      if (!slot) {
        const fresh = this.allocate(kind, budget)
        if (!fresh) continue
        slot = fresh
        this.slots.set(id, slot)
        slot.painted = false
      }
      slot.size = o.size
      slot.tint = o.tint
      slot.lastShown = this.frame
      boxes.add(o.key)
      if (!slot.painted) {
        slot.painted = true
        const cols = slot.page.cols
        const t = TILE_PX[kind]
        const rect = { x: (slot.index % cols) * t.w, y: Math.floor(slot.index / cols) * t.h, w: t.w, h: t.h }
        let jobs = jobsByOffer.get(oi)
        if (!jobs) jobsByOffer.set(oi, (jobs = []))
        jobs.push({ face, page: slot.page.atlas, rect })
        slot.page.atlas.texture.needsUpdate = true
      }
    }
    for (const [oi, jobs] of jobsByOffer) {
      const o = this.offers[oi]
      this.backend.paint(o.source(), o.size, jobs)
    }
    // write the instances
    const written = new Map<Page, number>()
    for (const id of chosen) {
      const slot = this.slots.get(id)
      const oi = this.offerOf.get(id)
      if (!slot || oi === undefined || slot.lastShown !== this.frame) continue
      const o = this.offers[oi]
      const face = FACES[id % 8] as Exclude<Face, 'bottom'>
      const f = faceFrame(face, o.size)
      const page = slot.page
      const n = written.get(page) ?? 0
      written.set(page, n + 1)
      this.q.setFromAxisAngle(Y_AXIS, o.yaw)
      const cos = Math.cos(o.yaw)
      const sin = Math.sin(o.yaw)
      const lx = f.c[0] + f.n[0] * OFFSET_M
      const ly = f.c[1] + f.n[1] * OFFSET_M
      const lz = f.c[2] + f.n[2] * OFFSET_M
      this.p.set(o.x + lx * cos + lz * sin, o.y + ly, o.z - lx * sin + lz * cos)
      this.q.multiply(FACE_QUAT[face])
      this.s.set(f.w, f.h, 1)
      page.mesh.setMatrixAt(n, this.m.compose(this.p, this.q, this.s))
      const t = TILE_PX[slot.kind]
      const cx = slot.index % page.cols
      const cy = Math.floor(slot.index / page.cols)
      // inset by a pixel so a neighbouring tile never bleeds in
      page.uvRect.setXYZW(n, (cx * t.w + 1) / PAGE_PX, 1 - ((cy + 1) * t.h - 1) / PAGE_PX, (t.w - 2) / PAGE_PX, (t.h - 2) / PAGE_PX)
      page.sizeM.setXY(n, f.w, f.h)
      this.faceCount++
    }
    for (const [page, n] of written) {
      page.mesh.count = n
      page.mesh.instanceMatrix.needsUpdate = true
      page.uvRect.needsUpdate = true
      page.sizeM.needsUpdate = true
    }
    this.boxCount = boxes.size
  }

  /** A tile of `kind`: a free one, a new page's, or the least recently shown one not drawn this frame. */
  private allocate(kind: Kind, budget: number): Slot | null {
    const pages = this.pages[kind]
    for (const page of pages) {
      const index = page.free.pop()
      if (index !== undefined) return this.slotOf(kind, page, index)
    }
    const perPage = Math.floor(PAGE_PX / TILE_PX[kind].w) * Math.floor(PAGE_PX / TILE_PX[kind].h)
    if (pages.length * perPage < budget) {
      const page = this.newPage(kind)
      pages.push(page)
      return this.slotOf(kind, page, page.free.pop()!)
    }
    let oldest: [number, Slot] | null = null
    for (const [id, s] of this.slots) {
      if (s.kind === kind && s.lastShown !== this.frame && (!oldest || s.lastShown < oldest[1].lastShown)) oldest = [id, s]
    }
    if (!oldest) return null
    this.slots.delete(oldest[0])
    return oldest[1]
  }

  private slotOf(kind: Kind, page: Page, index: number): Slot {
    return { kind, page, index, size: '40', tint: -2, lastShown: 0, painted: false }
  }

  private newPage(kind: Kind): Page {
    const atlas = this.backend.createPage(PAGE_PX, PAGE_PX)
    const t = TILE_PX[kind]
    const cols = Math.floor(PAGE_PX / t.w)
    const cap = cols * Math.floor(PAGE_PX / t.h)
    const geo = (this.quad ??= (() => {
      const g = new THREE.PlaneGeometry(1, 1)
      g.setAttribute('uv1', g.getAttribute('uv').clone()) // the shared normal map reads the second UV set
      return g
    })()).clone()
    const uvRect = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
    const sizeM = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2)
    uvRect.setUsage(THREE.DynamicDrawUsage)
    sizeM.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('uvRect', uvRect)
    geo.setAttribute('sizeM', sizeM)
    const maps = (this.maps ??= this.getMaps())
    const material = new THREE.MeshStandardMaterial({
      map: atlas.texture,
      normalMap: maps?.normal ?? null,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.85,
      metalness: 0.15,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 uvRect;\nattribute vec2 sizeM;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = uv * uvRect.zw + uvRect.xy;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = uv * sizeM / ${CORRUGATION_PITCH_M.toFixed(3)};
#endif`,
        )
    }
    material.customProgramCacheKey = () => 'tt-closeup-face'
    const mesh = new THREE.InstancedMesh(geo, material, cap)
    mesh.name = `containers-closeup-${kind}-${this.pages[kind].length}`
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = true
    this.group.add(mesh)
    return { atlas, mesh, uvRect, sizeM, cols, free: Array.from({ length: cap }, (_, i) => cap - 1 - i) }
  }

  /** Boxes with at least one face drawn in the last frame. */
  get count(): number {
    return this.boxCount
  }

  /** Faces drawn in the last frame. */
  get faces(): number {
    return this.faceCount
  }

  /** Painted tiles held (drawn or cached). */
  get cached(): number {
    return this.slots.size
  }

  /** Draw calls and triangles of the faces drawn last frame (one draw call per atlas page in use). */
  cost(): { drawCalls: number; triangles: number } {
    let drawCalls = 0
    for (const kind of Object.keys(this.pages) as Kind[]) for (const page of this.pages[kind]) if (page.mesh.count > 0) drawCalls++
    return { drawCalls, triangles: this.faceCount * 2 }
  }

  dispose(): void {
    for (const kind of Object.keys(this.pages) as Kind[]) {
      for (const page of this.pages[kind]) {
        this.group.remove(page.mesh)
        page.mesh.geometry.dispose()
        ;(page.mesh.material as THREE.Material).dispose()
        page.mesh.dispose()
        page.atlas.texture.dispose()
      }
      this.pages[kind] = []
    }
    this.quad?.dispose()
    this.slots.clear()
  }
}
