/**
 * The hero equipment level (#273, #275, #276): the spreaders nearest the camera are drawn with the detailed hero spreader model
 * instead of their rig's LOD0 spreader, the nearest SHC with the hero SHC body instead of its LOD0 body, and the
 * nearest trucks with the hero chassis and cab instead of their LOD0. Each piece
 * type (`HERO_PIECES`) is selected on its own lane with its own cap and distance; everything below applies per piece,
 * with "spreader" standing for any piece. Framework-free; the scene renderer owns one `HeroEquipmentLevel`.
 *
 * Each frame the equipment kinds (`equipmentKinds/sts.ts`, `asc.ts`, `shc.ts`, `truck.ts`) offer every rig that is at LOD0, after
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
 * - **Release:** a spreader no longer chosen (farther away, rig left LOD0, cap lowered) fades back out over
 *   `HERO_FADE_MS`: the same two dither patterns run backwards, the hero model dithering out while the rig meshes
 *   dither back in, so the drop back has no pop. Then the hero model is detached and the shared materials are put
 *   back. A release in the middle of the fade-in reverses from the alpha it has reached, and so does a piece chosen
 *   again in the middle of its fade-out. A releasing piece is no longer counted (`count`, `countOf`) or described
 *   (`describe`), but the level stays busy until its fade-out ends. `dispose()` detaches every piece at once.
 *
 * Per-frame cost: a frame with no offer in reach and nothing attached returns before any work; the candidate list, the
 * chosen set and the prep list are reused across frames.
 *
 * No depth bias: a spreader is its own object, not a face over a box (`HERO_DEPTH_BIAS_M` is for hero faces only).
 */
import * as THREE from 'three'
import { loadHeroEquipment, type HeroEquipmentKind } from './heroEquipmentAssets'
import { HERO_EQUIPMENT_HYSTERESIS, selectHeroEquipment, type HeroEquipmentCandidate } from './heroEquipmentSelection'
import { CameraGate, HERO_FADE_MS, runPrep, type PrepItem } from './heroPrep'
import { gltfNodeName as nodeName, type HeroEquipmentOffer } from './heroEquipmentMount'
import type { HeroCapField, QualityProfile } from './quality'

/** A failed load is asked for again this long (ms) after the failure, while the spreader stays chosen. */
export const HERO_EQUIPMENT_RETRY_MS = 3000
/** Each further failure doubles the wait, up to this (ms). */
export const HERO_EQUIPMENT_RETRY_MAX_MS = 30000
export interface HeroPieceConfig {
  /** The file kinds (`heroEquipmentAssets.ts`) offered for this piece. */
  kinds: readonly HeroEquipmentKind[]
  /** Reach (m) from the camera to the mount's centre (`HeroMount.centre`); kept out to this times the hysteresis. */
  distanceM: number
  /** The quality profile field that caps how many are drawn. */
  cap: HeroCapField
}

/**
 * The hero pieces. A new piece is an entry here (its kinds, distance and cap field), a loader URL per kind
 * (`heroEquipmentAssets.ts`), a quality cap field and a kind hook: the rig builds a `HeroMount` and the kind offers it
 * at LOD0 (`offerHeroEquipmentAtLod0`). How it mounts (which node, which subtree it leaves alone) is in the mount. The
 * full list of edits: docs/rendering-3d.md, Hero equipment, Adding a piece.
 */
export const HERO_PIECES = {
  // #273: 25 m from the spreader centre (a spreader is 12 m long)
  spreader: { kinds: ['sts', 'asc', 'shc'], distanceM: 25, cap: 'heroEquipment' },
  // #275: 30 m from the SHC centre (the carrier is about 15 m high)
  'shc-body': { kinds: ['shc-body'], distanceM: 30, cap: 'heroShc' },
  // #276: one piece per truck, the hero chassis and the hero cab of the truck's shape loaded as one LOD0 (`heroEquipmentAssets.ts`); 25 m from the truck centre
  truck: { kinds: ['truck-day', 'truck-mid', 'truck-high'], distanceM: 25, cap: 'heroTrucks' },
} as const satisfies Record<string, HeroPieceConfig>

/** A piece type (a `HERO_PIECES` key): selected on its own, with its own cap and distance, so pieces never compete for each other's places. */
export type HeroPiece = keyof typeof HERO_PIECES

/**
 * The older per-piece names in `__tt.scene()` that smoke specs read (`heroSpreaders`, `heroShcBodies`, `heroTrucks`),
 * each the `heroPieces` list of its piece. A new piece needs none: specs read `heroPieces[piece]`.
 */
export interface HeroPieceAliases {
  heroSpreaders: HeroPieceInfo[]
  heroShcBodies: HeroPieceInfo[]
  heroTrucks: HeroPieceInfo[]
}

export const heroPieceAliases = (pieces: Record<HeroPiece, HeroPieceInfo[]>): HeroPieceAliases => ({ heroSpreaders: pieces.spreader, heroShcBodies: pieces['shc-body'], heroTrucks: pieces.truck })

/** `HERO_PIECES` as a typed list, in declaration order. */
export const HERO_PIECE_LIST = Object.entries(HERO_PIECES) as readonly [HeroPiece, HeroPieceConfig][]

const PIECE_OF = new Map<HeroEquipmentKind, HeroPiece>()
for (const [piece, config] of HERO_PIECE_LIST) for (const k of config.kinds) PIECE_OF.set(k, piece)

/** The piece a file kind belongs to. */
export const heroPieceOf = (kind: HeroEquipmentKind): HeroPiece => PIECE_OF.get(kind)!

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
  /** The hero model's meshes (dithered while fading). */
  heroMeshes: THREE.Mesh[]
  /** The rig's own meshes this piece replaces (hidden once the fade-in has ended). */
  rigMeshes: THREE.Mesh[]
  /** Fade alpha (0 rig model only, 1 hero model only) at `fromMs`; it moves towards `target` over `HERO_FADE_MS`. */
  alphaFrom: number
  fromMs: number
  /** 1 while attaching or attached, 0 while releasing. */
  target: 0 | 1
  /** While fading: the dither materials in use and the shared ones to put back. */
  fade: HeroFade | null
}

/** A piece's fade alpha at `nowMs`. */
function alphaAt(hero: Attached, nowMs: number): number {
  const step = HERO_FADE_MS > 0 ? (nowMs - hero.fromMs) / HERO_FADE_MS : 1
  return hero.target === 1 ? Math.min(1, hero.alphaFrom + step) : Math.max(0, hero.alphaFrom - step)
}

type Entry = { state: 'loading'; attempt: number } | { state: 'failed'; attempt: number; retryAt: number } | { state: 'loaded'; root: THREE.Object3D } | { state: 'attached'; hero: Attached }

const DITHER = 'float heroDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));'
/** The hero model: drawn where the dither value is below the fade. */
const FADE_IN_DISCARD = `if (heroEquipmentFade < 0.999) {
  ${DITHER}
  if (heroDither >= heroEquipmentFade) discard;
}`
/** The rig model: drawn exactly where the hero model is not. */
const FADE_OUT_DISCARD = `{
  ${DITHER}
  if (heroEquipmentFade >= 0.999 || heroDither < heroEquipmentFade) discard;
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
    shader.uniforms.heroEquipmentFade = uniform
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float heroEquipmentFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + discard)
  }
  own.customProgramCacheKey = () => `${material.customProgramCacheKey()}|heroEquipmentFade-${direction}`
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

/** World-space box of a hero piece, metres. */
export interface HeroPieceBounds {
  min: [number, number, number]
  max: [number, number, number]
}

/** One attached hero piece as last drawn (`__tt.scene().heroPieces[piece]`): where it is against the rig meshes it replaces. */
export interface HeroPieceInfo {
  id: string
  kind: HeroEquipmentKind
  /** True while it fades in over the rig meshes. */
  fading: boolean
  /** True once the rig's own meshes it replaces are hidden. */
  rigHidden: boolean
  /** World bounds of the hero model. */
  hero: HeroPieceBounds
  /** World bounds of the rig's own meshes it replaces (hidden or not). */
  rig: HeroPieceBounds
}

export interface HeroEquipmentOptions {
  /** The cloned `LOD0` subtree of a kind's hero model (tests pass a fake). */
  load?: (kind: HeroEquipmentKind) => Promise<THREE.Object3D>
  /** Clock for the prep allowance (ms). */
  now?: () => number
}

/** One piece type's selection state: its cap, offers, chosen set and entries. Pieces never share any of it. */
interface Lane {
  config: HeroPieceConfig
  /** Offers beyond this (m) are dropped at once: the distance times the hysteresis. */
  reachM: number
  cap: number
  /** One slot per equipment id ever offered in reach (bounded by the fleet); `candidates` holds this frame's. */
  slots: Map<string, Slot>
  candidates: Slot[]
  chosen: Set<string>
  entries: Map<string, Entry>
}

/** Marks a hero root, so another piece on the same rig never takes its meshes for rig meshes. */
const HERO_ROOT = 'heroEquipmentRoot'

/** Visits `node` and its descendants, leaving out hero roots and the subtrees named `skip`. */
function walk(node: THREE.Object3D, skip: string | undefined, visit: (o: THREE.Object3D) => void): void {
  visit(node)
  for (const c of node.children) {
    if (c.userData[HERO_ROOT] || (skip !== undefined && nodeName(c) === skip)) continue
    walk(c, skip, visit)
  }
}

export class HeroEquipmentLevel {
  private readonly load: (kind: HeroEquipmentKind) => Promise<THREE.Object3D>
  private readonly now: () => number
  private readonly gate = new CameraGate()
  private readonly lanes = new Map<HeroPiece, Lane>()
  private readonly prep: PrepItem[] = []
  private frameMs = 0
  private waiting = 0
  private fading = 0
  private disposed = false
  private readonly world = new THREE.Vector3()

  constructor(options: HeroEquipmentOptions = {}) {
    this.load = options.load ?? loadHeroEquipment
    this.now = options.now ?? (() => performance.now())
    for (const [piece, config] of HERO_PIECE_LIST) {
      this.lanes.set(piece, { config, reachM: config.distanceM * HERO_EQUIPMENT_HYSTERESIS, cap: 0, slots: new Map(), candidates: [], chosen: new Set(), entries: new Map() })
    }
  }

  /** At most this many hero pieces of `piece` (spreaders: `QualityProfile.heroEquipment`); 0 removes them all at the next `update()`. */
  setCap(cap: number, piece: HeroPiece = 'spreader'): void {
    this.lanes.get(piece)!.cap = Math.max(0, Math.floor(cap))
  }

  /** Every piece's cap from its quality profile field (`HeroPieceConfig.cap`). */
  setCaps(profile: Pick<QualityProfile, HeroCapField>): void {
    for (const [piece, lane] of this.lanes) this.setCap(profile[lane.config.cap], piece)
  }

  /** Starts a frame: forgets last frame's offers. */
  begin(): void {
    for (const lane of this.lanes.values()) lane.candidates.length = 0
  }

  /** A kind offers a rig that is at LOD0 and posed for this frame. */
  offer(offer: HeroEquipmentOffer, cameraPosition: THREE.Vector3): void {
    const lane = this.lanes.get(heroPieceOf(offer.kind))!
    if (lane.cap <= 0) return
    const { node, centre } = offer.mount
    node.updateWorldMatrix(true, false)
    if (centre) this.world.copy(centre).applyMatrix4(node.matrixWorld)
    else this.world.setFromMatrixPosition(node.matrixWorld)
    const distanceM = this.world.distanceTo(cameraPosition)
    if (distanceM > lane.reachM) return
    let slot = lane.slots.get(offer.id)
    if (!slot) lane.slots.set(offer.id, (slot = { id: offer.id, distanceM, offer }))
    slot.distanceM = distanceM
    slot.offer = offer
    lane.candidates.push(slot)
  }

  /** Ends a frame: chooses among the offers (per piece), prepares within the allowance, attaches, follows the rigs and fades. */
  update(cameraPosition: THREE.Vector3, nowMs: number): void {
    if (this.disposed) return
    this.frameMs = nowMs
    const calm = this.gate.update(cameraPosition.x, cameraPosition.y, cameraPosition.z, nowMs)
    this.waiting = 0
    this.fading = 0
    for (const lane of this.lanes.values()) this.updateLane(lane, calm, nowMs)
    if (this.prep.length > 0) {
      runPrep(this.prep, this.now)
      this.prep.length = 0
    }
    for (const lane of this.lanes.values()) {
      for (const [id, entry] of lane.entries) {
        if (entry.state !== 'attached') continue
        this.follow(entry.hero)
        if (this.fade(entry.hero, nowMs)) {
          this.detach(entry.hero)
          lane.entries.delete(id)
        }
      }
    }
  }

  private updateLane(lane: Lane, calm: boolean, nowMs: number): void {
    if (lane.candidates.length === 0 && lane.entries.size === 0) {
      // the common frame: no LOD0 rig of this piece in reach and nothing attached, loading or waiting to be retried
      if (lane.chosen.size > 0) lane.chosen.clear()
      return
    }
    const chosen = selectHeroEquipment(lane.candidates, lane.cap, lane.chosen, lane.config.distanceM)
    lane.chosen.clear()
    for (const id of chosen) lane.chosen.add(id)
    for (const [id, entry] of lane.entries) {
      if (lane.chosen.has(id)) continue
      if (entry.state === 'attached') {
        this.retarget(entry.hero, 0, nowMs) // fades out; detached when the fade-out ends (`update`)
        continue
      }
      // a file still loading resolves into nothing (see `prepare`)
      lane.entries.delete(id)
    }
    for (const id of chosen) {
      const slot = lane.slots.get(id)!
      const offer = slot.offer
      const entry = lane.entries.get(id)
      if (!entry || (entry.state === 'failed' && nowMs >= entry.retryAt)) {
        this.waiting++
        if (calm) this.prep.push({ d2: slot.distanceM * slot.distanceM, run: () => this.prepare(lane, offer, entry ? entry.attempt + 1 : 1) })
      } else if (entry.state === 'loading') this.waiting++
      else if (entry.state === 'loaded') {
        this.waiting++
        if (calm) this.prep.push({ d2: slot.distanceM * slot.distanceM, run: () => lane.entries.set(id, { state: 'attached', hero: this.attach(offer, entry.root, nowMs) }) })
      } else if (entry.state === 'attached') {
        entry.hero.offer = offer
        this.retarget(entry.hero, 1, nowMs) // chosen again while fading out: fades back in from where it is
      }
      // failed and waiting on its back-off: not counted as waiting, so the level is settled meanwhile
    }
  }

  /**
   * Fetches the kind's file (first need only); the result waits as `loaded` for a later frame's prep slot. `attempt`
   * counts the requests for this piece since it was chosen (1 first): a failure waits
   * `HERO_EQUIPMENT_RETRY_MS x 2^(attempt - 1)`, at most `HERO_EQUIPMENT_RETRY_MAX_MS`, before the next.
   */
  private prepare(lane: Lane, offer: HeroEquipmentOffer, attempt: number): void {
    const loading: Entry = { state: 'loading', attempt }
    lane.entries.set(offer.id, loading)
    this.load(offer.kind).then(
      (root) => {
        if (!this.disposed && lane.entries.get(offer.id) === loading) lane.entries.set(offer.id, { state: 'loaded', root })
      },
      (err: unknown) => {
        const waitMs = Math.min(HERO_EQUIPMENT_RETRY_MAX_MS, HERO_EQUIPMENT_RETRY_MS * 2 ** (attempt - 1))
        console.warn(`Terminal Twin: hero equipment (${offer.kind}) failed to load; keeping the rig model, next try in ${waitMs / 1000} s`, err)
        if (lane.entries.get(offer.id) === loading) lane.entries.set(offer.id, { state: 'failed', attempt, retryAt: this.frameMs + waitMs })
      },
    )
  }

  private attach(offer: HeroEquipmentOffer, root: THREE.Object3D, nowMs: number): Attached {
    const { node, rest, skip, materials } = offer.mount
    const rigMeshes: THREE.Mesh[] = []
    const rigByName = new Map<string, THREE.Object3D>()
    walk(node, skip, (o) => {
      if (o !== node) rigByName.set(nodeName(o), o)
      if ((o as THREE.Mesh).isMesh && o.visible) rigMeshes.push(o as THREE.Mesh)
    })
    const restByName = rest()
    const pairs: Pair[] = []
    const heroMeshes: THREE.Mesh[] = []
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        const shared = materials && !Array.isArray(mesh.material) ? materials.get(mesh.material.name) : undefined
        if (shared) mesh.material = shared
        heroMeshes.push(mesh)
      }
      if (o === root) return
      const rig = rigByName.get(nodeName(o))
      const rigRest = restByName.get(nodeName(o))
      if (!rig || !rigRest) return
      o.updateMatrix()
      o.matrixAutoUpdate = false
      pairs.push({ rig, hero: o, restOffset: rigRest.clone().invert().multiply(o.matrix) })
    })
    root.position.set(0, 0, 0)
    root.quaternion.identity()
    root.scale.set(1, 1, 1)
    root.userData[HERO_ROOT] = true
    node.add(root)
    const fade: HeroFade = { uniform: { value: 0 }, swaps: [] }
    ditherMeshes(heroMeshes, fade.uniform, 'in', fade.swaps)
    ditherMeshes(rigMeshes, fade.uniform, 'out', fade.swaps)
    return { offer, root, pairs, heroMeshes, rigMeshes, alphaFrom: 0, fromMs: nowMs, target: 1, fade }
  }

  /** Turns a piece's fade towards `target` from the alpha it has now; a fully shown piece gets its dither materials back. */
  private retarget(hero: Attached, target: 0 | 1, nowMs: number): void {
    if (hero.target === target) return
    hero.alphaFrom = alphaAt(hero, nowMs)
    hero.fromMs = nowMs
    hero.target = target
    if (hero.fade) return
    const fade: HeroFade = { uniform: { value: hero.alphaFrom }, swaps: [] }
    ditherMeshes(hero.heroMeshes, fade.uniform, 'in', fade.swaps)
    ditherMeshes(hero.rigMeshes, fade.uniform, 'out', fade.swaps)
    for (const m of hero.rigMeshes) m.visible = true
    hero.fade = fade
  }

  /** Every paired hero node takes its rig node's local motion from rest. */
  private follow(hero: Attached): void {
    for (const p of hero.pairs) {
      p.rig.updateMatrix()
      p.hero.matrix.multiplyMatrices(p.rig.matrix, p.restOffset)
      p.hero.matrixWorldNeedsUpdate = true
    }
  }

  /** Advances a piece's fade; true when its fade-out has ended and it is to be detached. */
  private fade(hero: Attached, nowMs: number): boolean {
    if (!hero.fade) return false
    const alpha = alphaAt(hero, nowMs)
    hero.fade.uniform.value = alpha
    if (alpha !== hero.target) {
      this.fading++
      return false
    }
    if (hero.target === 0) return true
    this.endFade(hero)
    for (const m of hero.rigMeshes) m.visible = false
    return false
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

  /** Hero pieces in the scene (fading in or shown in full; not fading out), every piece type: one number for `SceneStats.heroEquipment`. */
  get count(): number {
    return this.countOf()
  }

  /** Hero pieces in the scene (not fading out), every piece type, or only `piece`. */
  countOf(piece?: HeroPiece): number {
    let n = 0
    for (const entry of this.shown(piece)) if (entry) n++
    return n
  }

  /** The attached pieces that are not fading out, every piece type or only `piece`. */
  private *shown(piece?: HeroPiece): Generator<[string, Attached]> {
    for (const [p, lane] of this.lanes) {
      if (piece !== undefined && p !== piece) continue
      for (const [id, e] of lane.entries) if (e.state === 'attached' && e.hero.target === 1) yield [id, e.hero]
    }
  }

  /** `describe` per piece type, one list per `HERO_PIECES` entry (`__tt.scene().heroPieces`). */
  describeAll(): Record<HeroPiece, HeroPieceInfo[]> {
    return Object.fromEntries(HERO_PIECE_LIST.map(([piece]) => [piece, this.describe(piece)])) as Record<HeroPiece, HeroPieceInfo[]>
  }

  /** The hero pieces `countOf` counts (all, or only `piece`) with their world bounds and their rig meshes', for readouts and tests (not per frame). */
  describe(piece?: HeroPiece): HeroPieceInfo[] {
    const box = new THREE.Box3()
    const part = new THREE.Box3()
    const bounds = (b: THREE.Box3): HeroPieceBounds => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] })
    const out: HeroPieceInfo[] = []
    for (const [id, h] of this.shown(piece)) {
      h.offer.mount.node.updateWorldMatrix(true, true)
      const hero = bounds(box.setFromObject(h.root))
      box.makeEmpty()
      // each rig mesh by its own geometry: the hero subtree hangs under the rig node, which may itself be a mesh
      for (const m of h.rigMeshes) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        box.union(part.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld))
      }
      out.push({ id, kind: h.offer.kind, fading: h.fade !== null, rigHidden: h.rigMeshes.every((m) => !m.visible), hero, rig: bounds(box) })
    }
    return out
  }

  /** True while a chosen piece waits for its model (camera gate, fetch, prep slot, a retry that is due), or a piece fades in or out; not while a failed load waits on its back-off. */
  get busy(): boolean {
    return this.waiting > 0 || this.fading > 0
  }

  /** True when nothing more is coming for this view. */
  get settled(): boolean {
    return !this.busy
  }

  /** Removes every hero piece and shows the rig meshes again. Geometry and materials belong to the loader's cache. */
  dispose(): void {
    this.disposed = true
    for (const lane of this.lanes.values()) {
      for (const entry of lane.entries.values()) if (entry.state === 'attached') this.detach(entry.hero)
      lane.entries.clear()
      lane.chosen.clear()
      lane.slots.clear()
      lane.candidates.length = 0
    }
    this.prep.length = 0
    this.waiting = 0
    this.fading = 0
  }
}
