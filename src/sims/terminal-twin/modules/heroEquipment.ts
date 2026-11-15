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
 *   follows the crane. It fades in over `HERO_FADE_MS` as a screen-door dither over the rig spreader (the hero faces'
 *   pattern, on a per-spreader copy of the material); when the fade ends the rig's own spreader meshes are hidden and
 *   the shared material is put back.
 * - **Follow the rig:** the rig code moves its own nodes (twistlock turn, telescoping, the 20 ft squeeze of the ASC
 *   and SHC spreader). Each frame every hero node that has a rig node of the same name takes that node's local
 *   transform, relative to rest: `hero = rigNow x rigRest^-1 x heroRest`. So the hero spreader shows exactly the
 *   motion the rig shows, whatever the rig code does to a node.
 * - **Release:** a spreader no longer chosen (farther away, rig left LOD0, cap lowered) loses the hero model and its
 *   rig meshes are shown again. `dispose()` does that for all of them.
 *
 * No depth bias: a spreader is its own object, not a face over a box (`HERO_DEPTH_BIAS_M` is for hero faces only).
 */
import * as THREE from 'three'
import { loadHeroSpreader, type HeroEquipmentKind } from './heroEquipmentAssets'
import { selectHeroEquipment, type HeroEquipmentCandidate } from './heroEquipmentSelection'
import { CameraGate, fadeAlpha, runPrep, type PrepItem } from './heroPrep'

/** GLTFLoader renames duplicate node names (`spreader_1`); the file's own name is kept in `userData.name`. */
const nodeName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name

/** Where a hero spreader goes on a rig: the rig's LOD0 `spreader` node, and a copy of that subtree as loaded (unposed). */
export interface HeroSpreaderMount {
  node: THREE.Object3D
  rest: THREE.Object3D
}

/**
 * The mount of a rig's LOD0 subtree, or null when it has no `spreader` node. Call it before the rig is first posed:
 * the copy taken here is the rest pose that later motion is measured against.
 */
export function heroSpreaderMount(lod0: THREE.Object3D): HeroSpreaderMount | null {
  let node: THREE.Object3D | null = null
  lod0.traverse((o) => {
    if (!node && nodeName(o) === 'spreader') node = o
  })
  if (!node) return null
  return { node, rest: (node as THREE.Object3D).clone(true) }
}

export interface HeroEquipmentOffer {
  /** Stable equipment id. */
  id: string
  kind: HeroEquipmentKind
  mount: HeroSpreaderMount
}

interface Pair {
  rig: THREE.Object3D
  hero: THREE.Object3D
  /** `rigRest^-1 x heroRest`. */
  k: THREE.Matrix4
}

interface Attached {
  offer: HeroEquipmentOffer
  root: THREE.Object3D
  pairs: Pair[]
  /** The rig's own meshes under the spreader node (hidden once the fade has ended). */
  rigMeshes: THREE.Mesh[]
  readyAt: number
  /** While fading: the dither materials in use and the shared ones to put back. */
  fade: { uniform: { value: number }; swaps: { mesh: THREE.Mesh; shared: THREE.Material | THREE.Material[]; own: THREE.Material[] }[] } | null
}

type Entry = { state: 'loading' } | { state: 'failed' } | { state: 'loaded'; root: THREE.Object3D } | { state: 'attached'; hero: Attached }

const FADE_DISCARD = `if (heroSpreaderFade < 0.999) {
  float heroDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (heroDither >= heroSpreaderFade) discard;
}`

/** A copy of `material` that discards by an ordered screen-door dither while `uniform.value` is below 1. */
function ditherMaterial(material: THREE.Material, uniform: { value: number }): THREE.Material {
  const own = material.clone()
  own.onBeforeCompile = (shader) => {
    shader.uniforms.heroSpreaderFade = uniform
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float heroSpreaderFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FADE_DISCARD)
  }
  own.customProgramCacheKey = () => 'heroSpreaderFade'
  return own
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
  private offers = new Map<string, HeroEquipmentOffer>()
  private candidates: HeroEquipmentCandidate[] = []
  private chosen = new Set<string>()
  private entries = new Map<string, Entry>()
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
    this.offers.clear()
    this.candidates.length = 0
  }

  /** A kind offers a rig that is at LOD0 and posed for this frame. */
  offer(offer: HeroEquipmentOffer, cameraPosition: THREE.Vector3): void {
    if (this.cap <= 0) return
    offer.mount.node.updateWorldMatrix(true, false)
    const distanceM = this.world.setFromMatrixPosition(offer.mount.node.matrixWorld).distanceTo(cameraPosition)
    this.offers.set(offer.id, offer)
    this.candidates.push({ id: offer.id, distanceM })
  }

  /** Ends a frame: chooses among the offers, prepares within the allowance, attaches, follows the rigs and fades. */
  update(cameraPosition: THREE.Vector3, nowMs: number): void {
    if (this.disposed) return
    const calm = this.gate.update(cameraPosition.x, cameraPosition.y, cameraPosition.z, nowMs)
    const chosen = selectHeroEquipment(this.candidates, this.cap, this.chosen)
    this.chosen = new Set(chosen)
    for (const [id, entry] of this.entries) {
      if (this.chosen.has(id)) continue
      if (entry.state === 'attached') this.detach(entry.hero)
      // a file still loading resolves into nothing (see `prepare`)
      this.entries.delete(id)
    }
    const prep: PrepItem[] = []
    this.waiting = 0
    this.fading = 0
    for (const id of chosen) {
      const offer = this.offers.get(id)!
      const entry = this.entries.get(id)
      const distanceM = this.candidates.find((c) => c.id === id)!.distanceM
      if (!entry) {
        this.waiting++
        if (calm) prep.push({ d2: distanceM * distanceM, run: () => this.prepare(offer) })
      } else if (entry.state === 'loading') this.waiting++
      else if (entry.state === 'loaded') {
        this.waiting++
        if (calm) prep.push({ d2: distanceM * distanceM, run: () => this.entries.set(id, { state: 'attached', hero: this.attach(offer, entry.root, nowMs) }) })
      } else if (entry.state === 'attached') entry.hero.offer = offer
    }
    if (prep.length > 0) runPrep(prep, this.now)
    for (const entry of this.entries.values()) {
      if (entry.state !== 'attached') continue
      this.follow(entry.hero)
      this.fade(entry.hero, nowMs)
    }
  }

  /** Fetches the kind's file (first need only); the result waits as `loaded` for a later frame's prep slot. */
  private prepare(offer: HeroEquipmentOffer): void {
    const loading: Entry = { state: 'loading' }
    this.entries.set(offer.id, loading)
    this.load(offer.kind).then(
      (root) => {
        if (!this.disposed && this.entries.get(offer.id) === loading) this.entries.set(offer.id, { state: 'loaded', root })
      },
      (err: unknown) => {
        console.warn(`Terminal Twin: hero spreader (${offer.kind}) failed to load; keeping the rig spreader`, err)
        if (this.entries.get(offer.id) === loading) this.entries.set(offer.id, { state: 'failed' })
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
    const uniform = { value: 0 }
    const swaps: NonNullable<Attached['fade']>['swaps'] = []
    const dithered = new Map<THREE.Material, THREE.Material>()
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        const shared = mesh.material
        const own = (Array.isArray(shared) ? shared : [shared]).map((m) => {
          let d = dithered.get(m)
          if (!d) dithered.set(m, (d = ditherMaterial(m, uniform)))
          return d
        })
        mesh.material = Array.isArray(shared) ? own : own[0]
        swaps.push({ mesh, shared, own })
      }
      if (o === root) return
      const rig = rigByName.get(nodeName(o))
      const rigRest = restByName.get(nodeName(o))
      if (!rig || !rigRest) return
      rigRest.updateMatrix()
      o.updateMatrix()
      o.matrixAutoUpdate = false
      pairs.push({ rig, hero: o, k: rigRest.matrix.clone().invert().multiply(o.matrix) })
    })
    root.position.set(0, 0, 0)
    root.quaternion.identity()
    root.scale.set(1, 1, 1)
    node.add(root)
    return { offer, root, pairs, rigMeshes, readyAt: nowMs, fade: { uniform, swaps } }
  }

  /** Every paired hero node takes its rig node's local motion from rest. */
  private follow(hero: Attached): void {
    for (const p of hero.pairs) {
      p.rig.updateMatrix()
      p.hero.matrix.multiplyMatrices(p.rig.matrix, p.k)
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

  /** Puts the shared materials back and frees the dither copies. */
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
      for (const m of h.rigMeshes) box.union(part.setFromObject(m))
      out.push({ id, kind: h.offer.kind, fading: h.fade !== null, rigHidden: h.rigMeshes.every((m) => !m.visible), hero, rig: bounds(box) })
    }
    return out
  }

  /** True while a chosen spreader waits for its model (camera gate, fetch, prep slot) or fades in. */
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
    this.offers.clear()
    this.candidates.length = 0
    this.waiting = 0
    this.fading = 0
  }
}
