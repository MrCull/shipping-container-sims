/**
 * Vessel hulls in the twin (TT-27). Each vessel gets a procedural placeholder
 * hull at once, then its class's GLB (LOD0 / LOD1 / LOD2 chosen by camera
 * distance to the hull's bounds, with hysteresis) in its line's livery, plus
 * runtime name boards (bow flanks and transom) drawn on a canvas.
 *
 * Frames: the vessel root sits at (stern x, 0, anchorage z offset) like the
 * SceneModel's slot centres; the hull asset is placed in it by `hullPlacement`
 * from its sidecar, so the hull's bay grid lands on the engine's slots.
 * Nothing here is reactive (never put these objects in Vue state).
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { VesselSizeClass } from '../scenario/types'
import { aftOffsetM, BAY_PITCH_M, FENDER_GAP_M, ROW_PITCH_M, slotX, slotZ, TIER_PITCH_M } from '../scenario/vesselClasses'
import { vesselLine } from '../scenario/vesselNames'
import { liveryMaterial } from './containerAssets'
import type { SceneModel, Vec3 } from './sceneModel'
import { hullMeta, loadHullModel, VESSEL_LIVERY_ATLAS, vesselHullColour, vesselLiveryIndex, type HullModel } from './vesselAssets'
import { holdLinerOutline, hullHatchOpenings, hullWithOpenHatches } from './hullHatchOpening'
import { hullPlacement, type HullMeta } from './vesselHull'
import { buildRobMesh, type RobMesh } from './robBoxes'
import type { ColourBy, ColourContext } from './colourBy'

/** LOD switch distances (m, camera to the hull's bounding box) and hysteresis factor. */
export const DEFAULT_VESSEL_LOD = { lod1M: 300, lod2M: 1100, hysteresis: 1.1 }

/** What the twin draws for one vessel (dev API `sceneState().vesselHulls`). */
export interface VesselHullState {
  sizeClass: VesselSizeClass
  /** Operator from the scenario (`vesselLine`), null = generic livery. */
  line: string | null
  /** Vessel livery atlas tile (assets/models/vessels/vessel-livery-atlas.json). */
  liveryIndex: number
  /** Name drawn on the name boards. */
  name: string
  assets: 'placeholder' | 'loaded'
  /** LOD drawn (null while the placeholder shows or the vessel is not in the scene). */
  lod: 0 | 1 | 2 | null
  /** Triangles of the hull drawn at that LOD (null like `lod`). With hatch panels drawn by the twin (TT-R10) the hull has none baked in over their bays, so this is below the sidecar's count for LOD0 and LOD1. */
  triangles: number | null
  /** ROB boxes (spec #106) drawn in this vessel's hull: display-only remain-on-board boxes of its ROB bays. */
  robBoxes: number
  /** The ROB boxes are hidden (colour by menu, #130). */
  robHidden: boolean
  /** The rendered hull's bay grid in world coordinates (from the GLB's bay_grid node); null when not in the scene. */
  bayGrid: {
    origin: Vec3
    holdTopY: number
    bayPitchM: number
    rowPitchM: number
    tierPitchM: number
    holdTiers: number
    halfOffsetM: number
  } | null
}

interface VesselEntry {
  id: string
  sizeClass: VesselSizeClass
  line: string | null
  liveryIndex: number
  name: string
  meta: HullMeta
  root: THREE.Group
  placeholder: THREE.Group
  hull: THREE.Group | null
  levels: THREE.Object3D[]
  marker: THREE.Object3D | null
  lod: 0 | 1 | 2
  disposables: { dispose(): void }[]
  robBoxes: number
  rob: RobMesh | null
}

export class VesselHulls {
  readonly group = new THREE.Group()
  private entries: VesselEntry[] = []
  private shared: { dispose(): void }[] = []
  private disposed = false
  private readonly box = new THREE.Box3()
  /** Per vessel, the bays whose hatch panels the twin draws itself (TT-R10): the hull drawn here has no baked covers over them. */
  private readonly panelBays = new Map<string, Set<number>>()

  constructor(private model: SceneModel) {
    this.group.name = 'vessels'
    for (const id of model.hatchPanelIds) {
      const panel = model.hatchPanelSpec(id)
      if (!panel) continue
      let bays = this.panelBays.get(panel.vesselId)
      if (!bays) this.panelBays.set(panel.vesselId, (bays = new Set()))
      bays.add(panel.bay)
    }
    for (const v of model.config.vessels) {
      const line = vesselLine(v) ?? null
      const liveryIndex = vesselLiveryIndex(line)
      const entry: VesselEntry = {
        id: v.id,
        sizeClass: v.sizeClass,
        line,
        liveryIndex,
        name: v.name,
        meta: hullMeta(v.sizeClass),
        root: new THREE.Group(),
        placeholder: this.placeholder(v.id, vesselHullColour(liveryIndex)),
        hull: null,
        levels: [],
        marker: null,
        lod: 0,
        disposables: [],
        robBoxes: 0,
        rob: null,
      }
      const rob = buildRobMesh(this.model.vesselSpec(v.id), model.robBoxesOf(v.id))
      if (rob) {
        entry.root.add(rob.mesh)
        entry.robBoxes = rob.count
        entry.rob = rob
        entry.disposables.push(rob)
      }
      entry.root.name = v.id
      entry.root.visible = false
      entry.root.add(entry.placeholder)
      this.group.add(entry.root)
      this.entries.push(entry)
    }
    for (const sizeClass of new Set(this.entries.map((e) => e.sizeClass))) {
      loadHullModel(sizeClass).then(
        (hull) => {
          if (this.disposed) return
          for (const e of this.entries) if (e.sizeClass === sizeClass) this.attachHull(e, hull)
        },
        (err: unknown) => console.warn(`Terminal Twin: ${sizeClass} hull GLB failed to load; keeping the placeholder`, err),
      )
    }
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.shared.push(thing)
    return thing
  }

  /**
   * Procedural low-poly hull (phase 1, shown until the GLB loads): a plan-view
   * outline extruded from the keel to the main deck, hatch covers per bay, the
   * accommodation block and a funnel. Local frame: stern at x = 0, quay-side
   * hull face at z = -FENDER_GAP_M.
   */
  private placeholder(id: string, hullColour: string): THREE.Group {
    const spec = this.model.vesselSpec(id)
    const group = new THREE.Group()
    group.name = 'placeholder'
    const draft = 10
    const mainDeck = spec.deckHeightM - 0.8
    const bow = Math.min(30, spec.loaM * 0.12)
    const outline = new THREE.Shape()
    outline.moveTo(0, 0)
    outline.lineTo(spec.loaM - bow, 0)
    outline.lineTo(spec.loaM, spec.beamM / 2)
    outline.lineTo(spec.loaM - bow, spec.beamM)
    outline.lineTo(0, spec.beamM)
    outline.closePath()
    const hullGeo = this.track(new THREE.ExtrudeGeometry(outline, { depth: mainDeck + draft, bevelEnabled: false }))
    hullGeo.rotateX(-Math.PI / 2) // shape Y (beam) -> -Z (seaward), extrusion -> +Y
    const hull = new THREE.Mesh(hullGeo, this.track(new THREE.MeshStandardMaterial({ color: hullColour, roughness: 0.6 })))
    hull.position.set(0, -draft, -FENDER_GAP_M)
    hull.castShadow = true
    const aft = aftOffsetM(spec)
    const bridgeL = Math.min(14, aft - 4)
    const bridgeH = spec.deckTiers * TIER_PITCH_M + 8
    const bridge = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(bridgeL, bridgeH, spec.beamM - 2)),
      this.track(new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.6 })),
    )
    bridge.position.set(aft - bridgeL / 2 - 2, mainDeck + bridgeH / 2, -FENDER_GAP_M - spec.beamM / 2)
    const hatchMat = this.track(new THREE.MeshStandardMaterial({ color: '#5b6470', roughness: 0.8 }))
    const hatchGeo = this.track(new THREE.BoxGeometry(BAY_PITCH_M - 1.2, 0.8, spec.rows * ROW_PITCH_M))
    for (let bay = 0; bay < spec.bays; bay++) {
      if (this.panelBays.get(id)?.has(bay)) continue // drawn as panels (HatchPanels)
      const hatch = new THREE.Mesh(hatchGeo, hatchMat)
      hatch.position.set(slotX(spec, 0, bay), spec.deckHeightM - 0.4, slotZ(spec, (spec.rows - 1) / 2))
      group.add(hatch)
    }
    group.add(hull, bridge)
    return group
  }

  private attachHull(e: VesselEntry, model: HullModel): void {
    const material = liveryMaterial(model.material, VESSEL_LIVERY_ATLAS)
    material.userData.liveryBase.value = e.liveryIndex
    if (material.map) material.map.anisotropy = 4
    e.disposables.push(material)
    const hull = new THREE.Group()
    hull.name = 'hull'
    const p = hullPlacement(model.meta, 0)
    hull.position.set(p.x, p.y, p.z)
    const boards = this.nameBoards(e, model.meta)
    const panelBays = this.panelBays.get(e.id)
    e.levels = model.lods.map((lodGeometry, i) => {
      let geometry = lodGeometry
      if (panelBays && i < 2) {
        // the twin draws this vessel's hatch panels itself: this copy of the hull has no baked covers over their bays, and a hole in the deck
        const attributes = Object.fromEntries(
          Object.entries(lodGeometry.attributes).map(([name, a]) => [name, { array: a.array as ArrayLike<number>, itemSize: a.itemSize }]),
        )
        const index = lodGeometry.getIndex()
        const open = hullWithOpenHatches(model.meta, i as 0 | 1, { index: index ? (index.array as ArrayLike<number>) : null, attributes }, panelBays)
        geometry = new THREE.BufferGeometry()
        for (const [name, array] of Object.entries(open)) geometry.setAttribute(name, new THREE.BufferAttribute(array, lodGeometry.attributes[name].itemSize))
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()
        e.disposables.push(geometry)
      }
      const level = new THREE.Group()
      level.name = `LOD${i}`
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      level.add(mesh)
      if (boards && i < 2) level.add(i === 0 ? boards : boards.clone())
      level.visible = i === 0
      hull.add(level)
      return level
    })
    const marker = new THREE.Object3D()
    marker.name = 'bay_grid'
    marker.position.copy(model.bayGrid)
    hull.add(marker)
    if (panelBays) hull.add(this.holdLiners(model.meta, panelBays))
    e.marker = marker
    e.hull = hull
    e.lod = 0
    e.root.remove(e.placeholder)
    e.root.add(hull)
  }

  /** Dark pits inside the coamings of the bays whose deck is open (TT-R10): the hold seen through a lifted panel, narrowing towards the keel (hull profile, #131). One mesh, inside faces only. */
  private holdLiners(meta: HullMeta, bays: ReadonlySet<number>): THREE.Mesh {
    // a little inside the coaming so the walls do not fight with it
    // the section is the hull profile (#131): a stepped V, lower hold tiers narrower than the upper ones
    const boxes = hullHatchOpenings(meta, bays).map((o) => {
      const shape = new THREE.Shape(holdLinerOutline(meta, o).map(([z, y]) => new THREE.Vector2(z, y)))
      const depth = o.x1 - o.x0 - 0.04
      // shape x = world z, shape y = world y, extruded along local z; rotate that onto +x
      return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(o.x1 - 0.02, 0, 0)
    })
    const geometry = this.track(mergeGeometries(boxes) as THREE.BufferGeometry)
    for (const b of boxes) b.dispose()
    const liner = new THREE.Mesh(geometry, this.track(new THREE.MeshStandardMaterial({ color: '#272d35', roughness: 0.9, side: THREE.BackSide })))
    liner.name = 'hold_liners'
    liner.receiveShadow = true
    return liner
  }

  /** Name boards from the sidecar's `nameboard_*` attach points: the vessel name in capitals, white or dark by hull colour. */
  private nameBoards(e: VesselEntry, meta: HullMeta): THREE.Mesh | null {
    const boards = meta.attachPoints.filter((a) => a.name.startsWith('nameboard_') && a.normal && a.heightM && a.widthM)
    if (!boards.length || typeof document === 'undefined') return null
    const text = e.name.toUpperCase()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const font = 'bold 96px Archivo, "Arial Narrow", Arial, sans-serif'
    ctx.font = font
    const textW = Math.ceil(ctx.measureText(text).width) + 24
    canvas.width = Math.min(4096, textW)
    canvas.height = 128
    ctx.font = font
    ctx.fillStyle = new THREE.Color(vesselHullColour(e.liveryIndex)).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6 ? '#1b2633' : '#f4f5f6'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 24)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const aspect = canvas.width / canvas.height
    const positions: number[] = []
    const uvs: number[] = []
    const up = new THREE.Vector3(0, 1, 0)
    for (const b of boards) {
      const n = new THREE.Vector3(...b.normal!)
      const right = n.clone().negate().cross(up).normalize()
      let h = b.heightM! * (128 / 96)
      let w = h * aspect
      if (w > b.widthM!) {
        h *= b.widthM! / w
        w = b.widthM!
      }
      const c = new THREE.Vector3(...b.position).addScaledVector(n, 0.02)
      const corner = (sx: number, sy: number) => c.clone().addScaledVector(right, (sx * w) / 2).addScaledVector(up, (sy * h) / 2)
      const [a, bb, cc, d] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
      for (const v of [a, bb, cc, a, cc, d]) positions.push(v.x, v.y, v.z)
      uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    const material = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.4, roughness: 0.6 })
    e.disposables.push(texture, geometry, material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'name_boards'
    return mesh
  }

  update(t: number, cameraPosition: THREE.Vector3): void {
    const { lod1M, lod2M, hysteresis } = DEFAULT_VESSEL_LOD
    for (const e of this.entries) {
      const p = this.model.vesselPlacement(e.id, t)
      e.root.visible = p !== null
      if (!p) continue
      e.root.position.set(p.x, 0, p.zOffset)
      if (!e.hull) continue
      const { loaM, beamM, draftM, airDraftM } = e.meta.dimensions
      const q = e.meta.waterline.quayLevelAboveWaterlineM
      this.box.min.set(p.x, -q - draftM, p.zOffset - FENDER_GAP_M - beamM)
      this.box.max.set(p.x + loaM, airDraftM - q, p.zOffset - FENDER_GAP_M)
      const d = this.box.distanceToPoint(cameraPosition)
      // Hysteresis: a boundary moves away from the current level, so a level is kept until the distance clearly crosses it.
      const b01 = e.lod >= 1 ? lod1M / hysteresis : lod1M * hysteresis
      const b12 = e.lod >= 2 ? lod2M / hysteresis : lod2M * hysteresis
      const next: 0 | 1 | 2 = d > b12 ? 2 : d > b01 ? 1 : 0
      if (next !== e.lod) {
        e.levels[e.lod].visible = false
        e.levels[next].visible = true
        e.lod = next
      }
    }
  }

  stats(): { visible: number; assets: 'placeholder' | 'loaded'; lods: { lod0: number; lod1: number; lod2: number } } {
    const lods = { lod0: 0, lod1: 0, lod2: 0 }
    let visible = 0
    for (const e of this.entries) {
      if (!e.root.visible) continue
      visible++
      if (e.hull) lods[(['lod0', 'lod1', 'lod2'] as const)[e.lod]]++
    }
    return { visible, assets: this.entries.every((e) => e.hull) ? 'loaded' : 'placeholder', lods }
  }

  private colourKey = ''

  /** Colour by (#130): recolours the ROB boxes when the mode changes, hides them with `hideRob` (never drawn, so `robBoxes` reads 0). */
  setColour(mode: ColourBy, hideRob: boolean, ctx: ColourContext): void {
    const key = `${mode}:${hideRob}`
    if (key === this.colourKey) return
    const modeChanged = !this.colourKey.startsWith(`${mode}:`)
    this.colourKey = key
    for (const e of this.entries) {
      if (!e.rob) continue
      if (modeChanged) e.rob.setColour(mode, ctx)
      e.rob.mesh.visible = !hideRob
    }
  }

  states(): Record<string, VesselHullState> {
    const out: Record<string, VesselHullState> = {}
    for (const e of this.entries) {
      let bayGrid: VesselHullState['bayGrid'] = null
      if (e.root.visible && e.marker && e.hull) {
        e.root.updateMatrixWorld(true)
        const o = e.marker.getWorldPosition(new THREE.Vector3())
        const g = e.meta.bayGrid
        bayGrid = {
          origin: { x: o.x, y: o.y, z: o.z },
          holdTopY: o.y + (g.holdTopY - g.origin[1]),
          bayPitchM: g.bayPitchM,
          rowPitchM: g.rowPitchM,
          tierPitchM: g.tierPitchM,
          holdTiers: g.holdTiers,
          halfOffsetM: g.halfOffsetM,
        }
      }
      out[e.id] = {
        sizeClass: e.sizeClass,
        line: e.line,
        liveryIndex: e.liveryIndex,
        name: e.name,
        assets: e.hull ? 'loaded' : 'placeholder',
        lod: e.hull && e.root.visible ? e.lod : null,
        triangles: e.hull && e.root.visible ? this.triangles(e) : null,
        robBoxes: e.rob && !e.rob.mesh.visible ? 0 : e.robBoxes,
        robHidden: e.rob ? !e.rob.mesh.visible : false,
        bayGrid,
      }
    }
    return out
  }

  private triangles(e: VesselEntry): number {
    let n = 0
    e.levels[e.lod].traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
      if (g && o.name === '' && (o as THREE.Mesh).isMesh) n += (g.index ? g.index.count : g.getAttribute('position').count) / 3
    })
    return n
  }

  dispose(): void {
    this.disposed = true
    for (const d of this.shared) d.dispose()
    for (const e of this.entries) for (const d of e.disposables) d.dispose()
    this.shared = []
  }
}
