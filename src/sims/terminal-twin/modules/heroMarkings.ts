/**
 * Hero markings (#260): the markings of a hero face, painted at about four times the close-up resolution (168 px per
 * metre of a long side against 42) into their own atlas pages, drawn as a transparent decal over the hero face so the
 * hero paint, ribs and wear show through. The content is the close-up level's (`describeMarkings`, painted by the same
 * `drawSideMarks` / `drawDoorMarks` / `drawFrontMarks`), so a hero face and the close-up face of one box say the same.
 *
 * Pages exist per kind (`side`, `end`: roofs print nothing), are created on demand up to `maxPages(boxes)`, and give up
 * the least recently shown tile when a kind is full. Painting needs a canvas, so it sits behind `HeroMarkBackend`
 * (a stub in Vitest). Painting is called from the hero level's preparation, inside the per-frame allowance (#259).
 *
 * Two steps (`HeroMarkStep`): `sharp` (scale 4) and `standard` (scale 1, today's close-up resolution). Switching drops
 * every page and tile (the standard step uses pages of 1/16 the memory); the hero level repaints through its
 * preparation queue, so the hero geometry stays drawn meanwhile.
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import type { CloseupSource, AtlasPage } from './containerCloseups'
import { FACE_QUAT, faceFrame } from './containerCloseups'
import type { Region } from './closeupGeometry'
import type { Face } from './exposedFaces'
import type { HeroMarkStep } from './markStep'

export type { HeroMarkStep }
export type MarkKind = 'side' | 'end'

/** Resolution multiple of today's close-up tiles (`TILE_PX` in containerCloseups.ts) per step. */
export const HERO_MARK_SCALE: Record<HeroMarkStep, number> = { sharp: 4, standard: 1 }
/** Page edge at scale 1 in pixels; a page is this times the scale (2048 px at `sharp`, 512 px at `standard`). */
export const HERO_MARK_PAGE_BASE_PX = 512
/** Tile size at scale 1 (the close-up level's): long side 512 x 96, end 192 x 192. */
export const HERO_MARK_TILE_BASE: Record<MarkKind, { w: number; h: number }> = { side: { w: 512, h: 96 }, end: { w: 192, h: 192 } }
/**
 * A decal lies on the crests of the hero panel, this far inside the box frame: 3.5 cm on a door end (the leaves are
 * recessed, and the locking bars pass in front of the lettering), 1 cm on the walls.
 */
export const heroMarkInsetM = (face: Face): number => (face === 'door' ? 0.035 : 0.01)

/**
 * Generator constants the corrugation profile is rebuilt from (containers.py, hero_containers.py, liveries.py).
 * `tests/generator-constants.test.ts` reads the generators and fails when a copy here has drifted.
 */
export const HERO_GENERATOR_CONSTANTS = {
  castLengthM: 0.178,
  castWidthM: 0.162,
  ribDepthM: 0.038,
  heroPitchM: 0.25,
  doorBands: 4,
  railBottomM: 0.16,
  railTopM: 0.1,
  /** The deepest hero surface inside the box frame (the door leaves' valley): `HERO_DEPTH_BIAS_M` must exceed it. */
  doorValleyInsetM: 0.075,
} as const
const { castLengthM: CAST_L_M, castWidthM: CAST_W_M, ribDepthM: RIB_DEPTH_M, heroPitchM: HERO_PITCH_M, doorBands: DOOR_BANDS, railBottomM: RAIL_BOTTOM_M, railTopM: RAIL_TOP_M } = HERO_GENERATOR_CONSTANTS

/**
 * The corrugation under a decal, for its shading: `[start, end, ribs, slope]`. `start` and `end` are the corrugated
 * span as fractions of the face (along its width for the vertical ribs of a wall, up its height for the horizontal
 * bands of a door, which is marked by a negative rib count), `slope` the rise of a rib flank (depth over flank width).
 */
export function heroMarkProfile(face: Face, widthM: number, heightM: number): [number, number, number, number] {
  const flank = (pitchM: number): number => RIB_DEPTH_M / (0.125 * pitchM)
  if (face === 'door') {
    const span = heightM - RAIL_BOTTOM_M - RAIL_TOP_M
    return [RAIL_BOTTOM_M / heightM, 1 - RAIL_TOP_M / heightM, -DOOR_BANDS, flank(span / DOOR_BANDS)]
  }
  const margin = face === 'front' ? CAST_W_M - 0.007 : CAST_L_M
  const span = widthM - 2 * margin
  const ribs = Math.max(1, Math.round(span / HERO_PITCH_M))
  return [margin / widthM, 1 - margin / widthM, ribs, flank(span / ribs)]
}

/**
 * A hero face and its decal are drawn this much nearer the camera in depth only (view-space metres; nothing moves on
 * screen). The plain LOD0 box under a hero face has its own, coarser ribs and door leaves at about the same depth, which
 * would otherwise poke through the hero valleys and the recessed door panels (up to 7.5 cm inside the box frame).
 */
export const HERO_DEPTH_BIAS_M = 0.1
/** Goes right after `#include <project_vertex>` in a hero vertex shader. */
export const HERO_DEPTH_BIAS_GLSL = `{
  vec4 heroNear = projectionMatrix * (mvPosition + vec4(0.0, 0.0, ${HERO_DEPTH_BIAS_M.toFixed(2)}, 0.0));
  gl_Position.z = heroNear.z / heroNear.w * gl_Position.w;
}`

/** The marking kind of a face (roofs and the bottom print nothing). */
export const markKindOf = (face: Face): MarkKind | null => (face === 'sideP' || face === 'sideN' ? 'side' : face === 'door' || face === 'front' ? 'end' : null)

/** Creates atlas pages and paints one face of a box into a tile; injectable so tests need no canvas. */
export interface HeroMarkBackend {
  createPage(px: number): AtlasPage
  paint(source: CloseupSource, size: ContainerSize, face: Face, page: AtlasPage, rect: Region): void
}

/** Tiles per page for `kind` at `step`. */
export function tilesPerPage(kind: MarkKind, step: HeroMarkStep): number {
  const scale = HERO_MARK_SCALE[step]
  const px = HERO_MARK_PAGE_BASE_PX * scale
  const t = HERO_MARK_TILE_BASE[kind]
  return Math.floor(px / (t.w * scale)) * Math.floor(px / (t.h * scale))
}

/** Pages that bound `kind` for a cap of `boxes` hero boxes: a box shows at most one side and one end to a camera. */
export const maxPages = (kind: MarkKind, step: HeroMarkStep, boxes: number): number => Math.ceil(Math.max(0, boxes) / tilesPerPage(kind, step))

interface Page {
  atlas: AtlasPage
  mesh: THREE.InstancedMesh
  uvRect: THREE.InstancedBufferAttribute
  fade: THREE.InstancedBufferAttribute
  profile: THREE.InstancedBufferAttribute
  cols: number
  free: number[]
  written: number
}

interface Slot {
  kind: MarkKind
  page: Page
  index: number
  lastShown: number
}

const FADE_VERTEX = 'attribute vec4 uvRect;\nattribute float heroFade;\nvarying float vHeroFade;'
/** The decal is a flat quad, but it is lit as the corrugated panel under it: a rib flank tilts the normal, so lettering takes the panel's light and shade. */
const PROFILE_VERTEX_DECL = 'attribute vec4 heroProfile;\nvarying vec4 vHeroProfile;\nvarying vec3 vHeroAxis;\nvarying float vHeroS;'
const PROFILE_VERTEX = `
vHeroProfile = vec4(heroProfile.xy, abs(heroProfile.z), heroProfile.w);
vHeroS = heroProfile.z < 0.0 ? uv.y : uv.x;
vHeroAxis = normalize(normalMatrix * normalize(mat3(instanceMatrix) * (heroProfile.z < 0.0 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))));`
const PROFILE_FRAGMENT_DECL = 'varying vec4 vHeroProfile;\nvarying vec3 vHeroAxis;\nvarying float vHeroS;'
const PROFILE_FRAGMENT = `
{
  float heroS = (vHeroS - vHeroProfile.x) / (vHeroProfile.y - vHeroProfile.x);
  if (heroS > 0.0 && heroS < 1.0) {
    float heroT = fract(heroS * vHeroProfile.z) - 0.5;
    float heroA = abs(heroT);
    if (heroA > 0.175 && heroA < 0.30) normal = normalize(normal + sign(heroT) * vHeroProfile.w * vHeroAxis);
  }
}`
const KINDS: readonly MarkKind[] = ['side', 'end']

export class HeroMarkings {
  readonly group = new THREE.Group()
  private stepNow: HeroMarkStep = 'sharp'
  private boxes = 0
  private pages: Record<MarkKind, Page[]> = { side: [], end: [] }
  private slots = new Map<number, Slot>()
  private frame = 0
  private quad: THREE.BufferGeometry | null = null
  private readonly q = new THREE.Quaternion()
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly yAxis = new THREE.Vector3(0, 1, 0)

  constructor(private readonly backend: HeroMarkBackend) {
    this.group.name = 'containers-hero-marks'
  }

  get step(): HeroMarkStep {
    return this.stepNow
  }

  /** Switches the resolution step; drops every page and tile. Returns true when the step changed. */
  setStep(step: HeroMarkStep): boolean {
    if (step === this.stepNow) return false
    this.stepNow = step
    this.clear()
    return true
  }

  /** Bounds the pages to the hero cap (boxes). */
  setBoxes(boxes: number): void {
    this.boxes = boxes
  }

  beginFrame(): void {
    this.frame++
    for (const kind of KINDS) for (const page of this.pages[kind]) page.written = 0
  }

  /** True when `id` holds a painted tile. */
  has(id: number): boolean {
    return this.slots.has(id)
  }

  /** Marks the tile of `id` as shown this frame (so it is not reused). */
  touch(id: number): void {
    const s = this.slots.get(id)
    if (s) s.lastShown = this.frame
  }

  /**
   * Takes a tile for `id` (a free one, a new page's, or the least recently shown one not shown this frame) and paints
   * the face into it. False when the kind has no tile to give (every one is shown this frame) or the face prints nothing.
   */
  paint(id: number, face: Face, size: ContainerSize, source: CloseupSource): boolean {
    const kind = markKindOf(face)
    if (!kind) return false
    let slot = this.slots.get(id)
    if (!slot) {
      const fresh = this.allocate(kind)
      if (!fresh) return false
      slot = fresh
      this.slots.set(id, slot)
    }
    slot.lastShown = this.frame
    const scale = HERO_MARK_SCALE[this.stepNow]
    const t = HERO_MARK_TILE_BASE[kind]
    const w = t.w * scale
    const h = t.h * scale
    const rect = { x: (slot.index % slot.page.cols) * w, y: Math.floor(slot.index / slot.page.cols) * h, w, h }
    this.backend.paint(source, size, face, slot.page.atlas, rect)
    slot.page.atlas.texture.needsUpdate = true
    return true
  }

  /** Writes the decal instance of a painted face; `alpha` is the face's fade. */
  place(id: number, face: Face, size: ContainerSize, x: number, y: number, z: number, yaw: number, alpha: number): void {
    const slot = this.slots.get(id)
    if (!slot || face === 'bottom') return
    const page = slot.page
    const n = page.written++
    const f = faceFrame(face, size)
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const inset = heroMarkInsetM(face)
    const lx = f.c[0] - f.n[0] * inset
    const ly = f.c[1] - f.n[1] * inset
    const lz = f.c[2] - f.n[2] * inset
    this.p.set(x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos)
    this.q.setFromAxisAngle(this.yAxis, yaw).multiply(FACE_QUAT[face])
    this.s.set(f.w, f.h, 1)
    page.mesh.setMatrixAt(n, this.m.compose(this.p, this.q, this.s))
    const scale = HERO_MARK_SCALE[this.stepNow]
    const t = HERO_MARK_TILE_BASE[slot.kind]
    const px = HERO_MARK_PAGE_BASE_PX * scale
    const w = t.w * scale
    const h = t.h * scale
    const cx = slot.index % page.cols
    const cy = Math.floor(slot.index / page.cols)
    // inset by a pixel so a neighbouring tile never bleeds in
    page.uvRect.setXYZW(n, (cx * w + 1) / px, 1 - ((cy + 1) * h - 1) / px, (w - 2) / px, (h - 2) / px)
    page.fade.setX(n, alpha)
    const pr = heroMarkProfile(face, f.w, f.h)
    page.profile.setXYZW(n, pr[0], pr[1], pr[2], pr[3])
  }

  endFrame(): void {
    for (const kind of KINDS) {
      for (const page of this.pages[kind]) {
        page.mesh.count = page.written
        if (page.written > 0) {
          page.mesh.instanceMatrix.needsUpdate = true
          page.uvRect.needsUpdate = true
          page.fade.needsUpdate = true
          page.profile.needsUpdate = true
        }
      }
    }
  }

  /** Forgets the tile of `id` (the face left the hero level); the tile goes back to the free list. */
  release(id: number): void {
    const s = this.slots.get(id)
    if (!s) return
    this.slots.delete(id)
    s.page.free.push(s.index)
  }

  private allocate(kind: MarkKind): Slot | null {
    const pages = this.pages[kind]
    for (const page of pages) {
      const index = page.free.pop()
      if (index !== undefined) return { kind, page, index, lastShown: this.frame }
    }
    if (pages.length < maxPages(kind, this.stepNow, this.boxes)) {
      const page = this.newPage(kind)
      pages.push(page)
      return { kind, page, index: page.free.pop()!, lastShown: this.frame }
    }
    let oldest: [number, Slot] | null = null
    for (const [id, s] of this.slots) if (s.kind === kind && s.lastShown !== this.frame && (!oldest || s.lastShown < oldest[1].lastShown)) oldest = [id, s]
    if (!oldest) return null
    this.slots.delete(oldest[0])
    return { kind, page: oldest[1].page, index: oldest[1].index, lastShown: this.frame }
  }

  private newPage(kind: MarkKind): Page {
    const scale = HERO_MARK_SCALE[this.stepNow]
    const px = HERO_MARK_PAGE_BASE_PX * scale
    const atlas = this.backend.createPage(px)
    const t = HERO_MARK_TILE_BASE[kind]
    const cols = Math.floor(px / (t.w * scale))
    const cap = cols * Math.floor(px / (t.h * scale))
    const geo = (this.quad ??= new THREE.PlaneGeometry(1, 1)).clone()
    const uvRect = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1)
    uvRect.setUsage(THREE.DynamicDrawUsage)
    fade.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('uvRect', uvRect)
    geo.setAttribute('heroFade', fade)
    const profile = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
    profile.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('heroProfile', profile)
    const material = new THREE.MeshStandardMaterial({
      map: atlas.texture,
      roughness: 0.85,
      metalness: 0,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + FADE_VERTEX + '\n' + PROFILE_VERTEX_DECL)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvHeroFade = heroFade;\n#ifdef USE_MAP\n  vMapUv = uv * uvRect.zw + uvRect.xy;\n#endif')
        .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>' + PROFILE_VERTEX)
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + HERO_DEPTH_BIAS_GLSL)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeroFade;\n' + PROFILE_FRAGMENT_DECL)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vHeroFade;')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + PROFILE_FRAGMENT)
    }
    material.customProgramCacheKey = () => 'tt-hero-marks'
    const mesh = new THREE.InstancedMesh(geo, material, cap)
    mesh.name = `containers-hero-marks-${kind}-${this.pages[kind].length}`
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = true // lettering in a shadow is as dark as the paint around it
    mesh.renderOrder = 1 // after the opaque hero paint
    this.group.add(mesh)
    return { atlas, mesh, uvRect, fade, profile, cols, free: Array.from({ length: cap }, (_, i) => cap - 1 - i), written: 0 }
  }

  /** Pages and tiles held, draw calls of the last frame, and the texel memory of the pages. */
  stats(): { pages: number; tiles: number; drawCalls: number; texelBytes: number } {
    let pages = 0
    let drawCalls = 0
    let texelBytes = 0
    const scale = HERO_MARK_SCALE[this.stepNow]
    for (const kind of KINDS) {
      for (const page of this.pages[kind]) {
        pages++
        if (page.mesh.count > 0) drawCalls++
        texelBytes += (HERO_MARK_PAGE_BASE_PX * scale) ** 2 * 4
      }
    }
    return { pages, tiles: this.slots.size, drawCalls, texelBytes }
  }

  /** Drops every page and tile (step change, dispose). */
  clear(): void {
    for (const kind of KINDS) {
      for (const page of this.pages[kind]) {
        this.group.remove(page.mesh)
        page.mesh.geometry.dispose()
        ;(page.mesh.material as THREE.Material).dispose()
        page.mesh.dispose()
        page.atlas.texture.dispose()
      }
      this.pages[kind] = []
    }
    this.slots.clear()
  }

  dispose(): void {
    this.clear()
    this.quad?.dispose()
  }
}
