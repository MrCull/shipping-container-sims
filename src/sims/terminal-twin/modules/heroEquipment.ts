/**
 * The hero equipment level (#273): the spreaders nearest the camera are drawn with the detailed hero spreader model
 * instead of their rig's LOD0 spreader. Framework-free; the scene renderer owns one `HeroEquipmentLevel`.
 *
 * Each frame the equipment kinds (`equipmentKinds/sts.ts`, `asc.ts`, `shc.ts`) offer every rig that is at LOD0, after
 * posing it; `update()` then chooses (`selectHeroEquipment`, at most the quality profile's `heroEquipment`), prepares,
 * attaches and fades:
 *
 * - **Prepare:** a chosen spreader's file is fetched (`heroEquipmentAssets.ts`, first need only) and its nodes are
 *   paired with the rig's, through `runPrep` within the hero prep allowance, and only while the `CameraGate` is calm
 *   (same constants as the hero faces): nothing is fetched or attached during a fast camera move.
 * - **Attach:** the hero `LOD0` becomes a child of the rig's LOD0 `spreader` node with an identity transform, so it
 *   follows the crane. It fades in over `HERO_FADE_MS` as a screen-door dither (the hero faces' pattern, on a
 *   per-spreader copy of the material) while the rig's own spreader meshes dither out with the complementary pattern:
 *   every pixel shows exactly one of the two, so the two models never z-fight where their surfaces coincide. When the
 *   fade ends the rig meshes are hidden and the shared materials are put back on both.
 * - **Failed load:** the rig spreader stays, and the file is asked for again after a back-off (`HERO_EQUIPMENT_RETRY_MS`,
 *   doubling to `HERO_EQUIPMENT_RETRY_MAX_MS`) for as long as the spreader stays chosen. While it waits on the back-off
 *   the level counts as settled.
 * - **Follow the rig:** the rig code moves its own nodes (twistlock turn, telescoping, the 20 ft squeeze of the ASC
 *   and SHC spreader). Each frame every hero node that has a rig node of the same name takes that node's local
 *   transform, relative to rest: `hero = rigNow x rigRest^-1 x heroRest`. So the hero spreader shows exactly the
 *   motion the rig shows, whatever the rig code does to a node.
 * - **Release:** a spreader no longer chosen (farther away, rig left LOD0, cap lowered) loses the hero model and its
 *   rig meshes are shown again. `dispose()` does that for all of them.
 *
 * Per-frame cost: a frame with no offer in reach and nothing attached returns before any work; the candidate list, the
 * chosen set and the prep list are reused across frames.
 *
 * No depth bias: a spreader is its own object, not a face over a box (`HERO_DEPTH_BIAS_M` is for hero faces only).
 */
import * as THREE from 'three'
import { loadHeroSpreader, type HeroEquipmentKind } from './heroEquipmentAssets'
import { HERO_EQUIPMENT_DISTANCE_M, HERO_EQUIPMENT_HYSTERESIS, selectHeroEquipment, type HeroEquipmentCandidate } from './heroEquipmentSelection'
import { CameraGate, fadeAlpha, runPrep, type PrepItem } from './heroPrep'
import { gltfNodeName as nodeName, type HeroEquipmentOffer } from './heroSpreaderMount'

/** A failed load is asked for again this long (ms) after the failure, while the spreader stays chosen. */
export const HERO_EQUIPMENT_RETRY_MS = 3000
/** Each further failure doubles the wait, up to this (ms). */
export const HERO_EQUIPMENT_RETRY_MAX_MS = 30000
/** No spreader farther than this (m) can be chosen, new or kept: such an offer is dropped at once. */
const REACH_M = HERO_EQUIPMENT_DISTANCE_M * HERO_EQUIPMENT_HYSTERESIS

interface Pair {
  rig: THREE.Object3D
  hero: THREE.Object3D
  /** `rigRest^-1 x heroRest`: the hero node's rest pose seen from the rig node's rest pose. */
  restOffset: THREE.Matrix4
}

/** A mesh that wears a dither copy of its material during the fade, and the shared material to put back. */
interface MaterialSwap {
  mesh: THREE.Mesh
  shared: THREE.Material | THREE.Material[]
  own: THREE.Material[]
}

/** A fade in progress: the fade uniform (0 to 1) and the hero (dither in) and rig (dither out) meshes it drives. */
interface HeroFade {
  uniform: { value: number }
  swaps: MaterialSwap[]
}

/** An offer as held between frames: one object per equipment id, reused. */
interface Slot extends HeroEquipmentCandidate {
  offer: HeroEquipmentOffer
}

interface Attached {
  offer: HeroEquipmentOffer
  root: THREE.Object3D
  pairs: Pair[]
  /** The rig's own meshes under the spreader node (hidden once the fade has ended). */
  rigMeshes: THREE.Mesh[]
  readyAt: number
  /** While fading: the dither materials in use and the shared ones to put back. */
  fade: HeroFade | null
}

type Entry = { state: 'loading'; attempt: number } | { state: 'failed'; attempt: number; retryAt: number } | { state: 'loaded'; root: THREE.Object3D } | { state: 'attached'; hero: Attached }

const DITHER = 'float heroDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));'
/** The hero model: drawn where the dither value is below the fade. */
const FADE_IN_DISCARD = `if (heroSpreaderFade < 0.999) {
  ${DITHER}
  if (heroDither >= heroSpreaderFade) discard;
}`
/** The rig model: drawn exactly where the hero model is not. */
const FADE_OUT_DISCARD = `{
  ${DITHER}
  if (heroSpreaderFade >= 0.999 || heroDither < heroSpreaderFade) discard;
}`

/**
 * A copy of `material` that discards by an ordered screen-door dither of `uniform.value` (0 to 1): `in` appears as the
 * value rises, `out` disappears, and the two patterns are complementary. A shader patch the material already has
 * (the plate materials) is kept.
 */
function ditherMaterial(material: THREE.Material, uniform: { value: number }, direction: 'in' | 'out'): THREE.Material {
  const own = material.clone()
  const discard = direction === 'in' ? FADE_IN_DISCARD : FADE_OUT_DISCARD
  own.onBeforeCompile = (shader, renderer) => {
    material.onBeforeCompile(shader, renderer)
    shader.uniforms.heroSpreaderFade = uniform
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float heroSpreaderFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + discard)
  }
  own.customProgramCacheKey = () => `${material.customProgramCacheKey()}|heroSpreaderFade-${direction}`
  return own
}

/** Puts dither copies on `meshes` (one copy per shared material) and records the swaps. */
function ditherMeshes(meshes: Iterable<THREE.Mesh>, uniform: { value: number }, direction: 'in' | 'out', swaps: MaterialSwap[]): void {
  const dithered = new Map<THREE.Material, THREE.Material>()
  for (const mesh of meshes) {
    const shared = mesh.material
    const own = (Array.isArray(shared) ? shared : [shared]).map((m) => {
      let d = dithered.get(m)
      if (!d) dithered.set(m, (d = ditherMaterial(m, uniform, direction)))
      return d
    })
    mesh.material = Array.isArray(shared) ? own : own[0]
    swaps.push({ mesh, shared, own })
  }
}

/** World-space box of a spreader, metres. */
export interface HeroSpreaderBounds {
  min: [number, number, number]
  max: [number, number, number]
}

/** One attached hero spreader as last drawn (`__tt.scene().heroSpreaders`): where it is against the rig spreader it replaces. */
export interface HeroSpreaderInfo {
  id: string
  kind: HeroEquipmentKind
  /** True while it fades in over the rig spreader. */
  fading: boolean
  /** True once the rig's own spreader meshes are hidden. */
  rigHidden: boolean
  /** World bounds of the hero spreader. */
  hero: HeroSpreaderBounds
  /** World bounds of the rig's own spreader meshes (hidden or not). */
  rig: HeroSpreaderBounds
}

export interface HeroEquipmentOptions {
  /** The cloned `LOD0` subtree of a kind's hero spreader (tests pass a fake). */
  load?: (kind: HeroEquipmentKind) => Promise<THREE.Object3D>
  /** Clock for the prep allowance (ms). */
  now?: () => number
}

export class HeroEquipmentLevel {
  private readonly load: (kind: HeroEquipmentKind) => Promise<THREE.Object3D>
  private readonly now: () => number
  private readonly gate = new CameraGate()
  private cap = 0
  /** One slot per equipment id ever offered in reach (bounded by the fleet); `candidates` holds this frame's. */
  private readonly slots = new Map<string, Slot>()
  private readonly candidates: Slot[] = []
  private readonly chosen = new Set<string>()
  private readonly prep: PrepItem[] = []
  private readonly entries = new Map<string, Entry>()
  private frameMs = 0
  private waiting = 0
  private fading = 0
  private disposed = false
  private readonly world = new THREE.Vector3()

  constructor(options: HeroEquipmentOptions = {}) {
    this.load = options.load ?? loadHeroSpreader
    this.now = options.now ?? (() => performance.now())
  }

  /** At most this many hero spreaders (`QualityProfile.heroEquipment`); 0 removes them all at the next `update()`. */
  setCap(cap: number): void {
    this.cap = Math.max(0, Math.floor(cap))
  }

  /** Starts a frame: forgets last frame's offers. */
  begin(): void {
    this.candidates.length = 0
  }

  /** A kind offers a rig that is at LOD0 and posed for this frame. */
  offer(offer: HeroEquipmentOffer, cameraPosition: THREE.Vector3): void {
    if (this.cap <= 0) return
    offer.mount.node.updateWorldMatrix(true, false)
    const distanceM = this.world.setFromMatrixPosition(offer.mount.node.matrixWorld).distanceTo(cameraPosition)
    if (distanceM > REACH_M) return
    let slot = this.slots.get(offer.id)
    if (!slot) this.slots.set(offer.id, (slot = { id: offer.id, distanceM, offer }))
    slot.distanceM = distanceM
    slot.offer = offer
    this.candidates.push(slot)
  }

  /** Ends a frame: chooses among the offers, prepares within the allowance, attaches, follows the rigs and fades. */
  update(cameraPosition: THREE.Vector3, nowMs: number): void {
    if (this.disposed) return
    this.frameMs = nowMs
    const calm = this.gate.update(cameraPosition.x, cameraPosition.y, cameraPosition.z, nowMs)
    this.waiting = 0
    this.fading = 0
    if (this.candidates.length === 0 && this.entries.size === 0) {
      // the common frame: no LOD0 spreader in reach and nothing attached, loading or waiting to be retried
      if (this.chosen.size > 0) this.chosen.clear()
      return
    }
    const chosen = selectHeroEquipment(this.candidates, this.cap, this.chosen)
    this.chosen.clear()
    for (const id of chosen) this.chosen.add(id)
    for (const [id, entry] of this.entries) {
      if (this.chosen.has(id)) continue
      if (entry.state === 'attached') this.detach(entry.hero)
      // a file still loading resolves into nothing (see `prepare`)
      this.entries.delete(id)
    }
    const prep = this.prep
    for (const id of chosen) {
      const slot = this.slots.get(id)!
      const offer = slot.offer
      const entry = this.entries.get(id)
      if (!entry || (entry.state === 'failed' && nowMs >= entry.retryAt)) {
        this.waiting++
        if (calm) prep.push({ d2: slot.distanceM * slot.distanceM, run: () => this.prepare(offer, entry ? entry.attempt + 1 : 1) })
      } else if (entry.state === 'loading') this.waiting++
      else if (entry.state === 'loaded') {
        this.waiting++
        if (calm) prep.push({ d2: slot.distanceM * slot.distanceM, run: () => this.entries.set(id, { state: 'attached', hero: this.attach(offer, entry.root, nowMs) }) })
      } else if (entry.state === 'attached') entry.hero.offer = offer
      // failed and waiting on its back-off: not counted as waiting, so the level is settled meanwhile
    }
    if (prep.length > 0) {
      runPrep(prep, this.now)
      prep.length = 0
    }
    for (const entry of this.entries.values()) {
      if (entry.state !== 'attached') continue
      this.follow(entry.hero)
      this.fade(entry.hero, nowMs)
    }
  }

  /**
   * Fetches the kind's file (first need only); the result waits as `loaded` for a later frame's prep slot. `attempt`
   * counts the requests for this spreader since it was chosen (1 first): a failure waits
   * `HERO_EQUIPMENT_RETRY_MS x 2^(attempt - 1)`, at most `HERO_EQUIPMENT_RETRY_MAX_MS`, before the next.
   */
  private prepare(offer: HeroEquipmentOffer, attempt: number): void {
    const loading: Entry = { state: 'loading', attempt }
    this.entries.set(offer.id, loading)
    this.load(offer.kind).then(
      (root) => {
        if (!this.disposed && this.entries.get(offer.id) === loading) this.entries.set(offer.id, { state: 'loaded', root })
      },
      (err: unknown) => {
        const waitMs = Math.min(HERO_EQUIPMENT_RETRY_MAX_MS, HERO_EQUIPMENT_RETRY_MS * 2 ** (attempt - 1))
        console.warn(`Terminal Twin: hero spreader (${offer.kind}) failed to load; keeping the rig spreader, next try in ${waitMs / 1000} s`, err)
        if (this.entries.get(offer.id) === loading) this.entries.set(offer.id, { state: 'failed', attempt, retryAt: this.frameMs + waitMs })
      },
    )
  }

  private attach(offer: HeroEquipmentOffer, root: THREE.Object3D, nowMs: number): Attached {
    const { node, rest } = offer.mount
    const rigMeshes: THREE.Mesh[] = []
    const rigByName = new Map<string, THREE.Object3D>()
    node.traverse((o) => {
      if (o !== node) rigByName.set(nodeName(o), o)
      if ((o as THREE.Mesh).isMesh && o.visible) rigMeshes.push(o as THREE.Mesh)
    })
    const restByName = new Map<string, THREE.Object3D>()
    rest.traverse((o) => {
      if (o !== rest) restByName.set(nodeName(o), o)
    })
    const pairs: Pair[] = []
    const heroMeshes: THREE.Mesh[] = []
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        heroMeshes.push(mesh)
      }
      if (o === root) return
      const rig = rigByName.get(nodeName(o))
      const rigRest = restByName.get(nodeName(o))
      if (!rig || !rigRest) return
      rigRest.updateMatrix()
      o.updateMatrix()
      o.matrixAutoUpdate = false
      pairs.push({ rig, hero: o, restOffset: rigRest.matrix.clone().invert().multiply(o.matrix) })
    })
    root.position.set(0, 0, 0)
    root.quaternion.identity()
    root.scale.set(1, 1, 1)
    node.add(root)
    const fade: HeroFade = { uniform: { value: 0 }, swaps: [] }
    ditherMeshes(heroMeshes, fade.uniform, 'in', fade.swaps)
    ditherMeshes(rigMeshes, fade.uniform, 'out', fade.swaps)
    return { offer, root, pairs, rigMeshes, readyAt: nowMs, fade }
  }

  /** Every paired hero node takes its rig node's local motion from rest. */
  private follow(hero: Attached): void {
    for (const p of hero.pairs) {
      p.rig.updateMatrix()
      p.hero.matrix.multiplyMatrices(p.rig.matrix, p.restOffset)
      p.hero.matrixWorldNeedsUpdate = true
    }
  }

  private fade(hero: Attached, nowMs: number): void {
    if (!hero.fade) return
    const alpha = fadeAlpha(hero.readyAt, nowMs)
    hero.fade.uniform.value = alpha
    if (alpha < 1) {
      this.fading++
      return
    }
    this.endFade(hero)
    for (const m of hero.rigMeshes) m.visible = false
  }

  /** Puts the shared materials back (hero and rig meshes) and frees the dither copies. */
  private endFade(hero: Attached): void {
    if (!hero.fade) return
    const freed = new Set<THREE.Material>()
    for (const s of hero.fade.swaps) {
      s.mesh.material = s.shared
      for (const m of s.own) {
        if (!freed.has(m)) m.dispose()
        freed.add(m)
      }
    }
    hero.fade = null
  }

  private detach(hero: Attached): void {
    this.endFade(hero)
    hero.root.removeFromParent()
    for (const m of hero.rigMeshes) m.visible = true
  }

  /** Hero spreaders in the scene (attached, fading or shown in full). */
  get count(): number {
    let n = 0
    for (const e of this.entries.values()) if (e.state === 'attached') n++
    return n
  }

  /** The attached hero spreaders with their world bounds and their rig spreader's, for readouts and tests (not per frame). */
  describe(): HeroSpreaderInfo[] {
    const box = new THREE.Box3()
    const part = new THREE.Box3()
    const bounds = (b: THREE.Box3): HeroSpreaderBounds => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] })
    const out: HeroSpreaderInfo[] = []
    for (const [id, entry] of this.entries) {
      if (entry.state !== 'attached') continue
      const h = entry.hero
      h.offer.mount.node.updateWorldMatrix(true, true)
      const hero = bounds(box.setFromObject(h.root))
      box.makeEmpty()
      // each rig mesh by its own geometry: the hero subtree hangs under the rig's spreader node, which may itself be a mesh
      for (const m of h.rigMeshes) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        box.union(part.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld))
      }
      out.push({ id, kind: h.offer.kind, fading: h.fade !== null, rigHidden: h.rigMeshes.every((m) => !m.visible), hero, rig: bounds(box) })
    }
    return out
  }

  /** True while a chosen spreader waits for its model (camera gate, fetch, prep slot, a retry that is due) or fades in; not while a failed load waits on its back-off. */
  get busy(): boolean {
    return this.waiting > 0 || this.fading > 0
  }

  /** True when nothing more is coming for this view. */
  get settled(): boolean {
    return !this.busy
  }

  /** Removes every hero spreader and shows the rig spreaders again. Geometry and materials belong to the loader's cache. */
  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) if (entry.state === 'attached') this.detach(entry.hero)
    this.entries.clear()
    this.chosen.clear()
    this.slots.clear()
    this.candidates.length = 0
    this.prep.length = 0
    this.waiting = 0
    this.fading = 0
  }
}
