/**
 * Phase 1 procedural low-poly scene: quay, water, STS cranes on their rail,
 * yard blocks (rails, bay marks, WTP pads, transfer stalls) and ASCs. Vessel hulls are drawn by VesselHulls (placeholder, then the TT-27 GLB LODs in the line's livery,
 * see vesselRenderer.ts). Containers are drawn by the ContainerInstancer: procedural
 * placeholder boxes at once, then the phase 2 GLB LODs (LOD0 near the camera,
 * LOD1 elsewhere) with a per-instance livery as soon as they load. STS cranes
 * start as procedural placeholders and switch to the phase 2 Malaccamax GLB
 * (`StsModel`, three LODs, rigged) once it loads. Shared
 * geometries and materials; nothing here is reactive (never put these in Vue state).
 *
 * `update(model, t)` poses everything for display time `t` from the
 * SceneModel timelines.
 */
import * as THREE from 'three'
import { ascIndexOf, BAY_PITCH_M as YARD_BAY_PITCH_M, ROW_PITCH_M as YARD_ROW_PITCH_M, rowX } from '../engine'
import type { ScenarioConfig } from '../scenario/types'
import { CONTAINER_DIMS, type SceneModel, type Vec3 } from './sceneModel'
import { ASC, ascHeightM, SHC, STS } from './equipmentDims'
import { entityBounds } from './picking'
import { OverlayLayers, type OverlayLayerStats } from './overlayLayers'
import { NO_OVERLAYS, type OverlayState } from './overlays'

export type { OverlayState }
import { ContainerInstancer } from './containerInstancer'
import { loadShcModel, ShcRig, SHC_RIG, type ShcRigState } from './shcAssets'
import { liveryIndexForLine, loadContainerAssets } from './containerAssets'
import { loadStsTemplate, StsModel, type SpreaderMode, type StsRenderState } from './stsAssets'
import { QUAY_ABOVE_WATER_M } from '../scenario/vesselClasses'
import { VesselHulls, type VesselHullState } from './vesselRenderer'

/** [A] How fast an empty spreader rises and lowers when the engine gives it no lift motion (m/s of display time). */
const EMPTY_HOIST_MPS = 1.5
/** Height of the spreader's twist-lock plane when an empty SHC is not driving: the top of a standard box on the ground. */
const EMPTY_SPREADER_DOWN_Y = CONTAINER_DIMS['40'].height
export interface SceneStats {
  /** Container instances drawn. */
  containers: number
  /** STS crane objects in the scene. */
  sts: number
  /** SHC objects in the scene. */
  shcs: number
  /** ASC objects in the scene (one or two per yard block). */
  ascs: number
  /** Vessel hulls currently visible. */
  vessels: number
  /** 'placeholder' until every scenario vessel's hull GLB has loaded (TT-27). */
  vesselAssets: 'placeholder' | 'loaded'
  /** Visible vessels per hull LOD (placeholders not counted). */
  vesselLods: { lod0: number; lod1: number; lod2: number }
  overlays: OverlayState
  /** Reserved zones highlighted (0 when the reservations overlay is off). */
  reservedZones: number
  /** Rail segments highlighted (0 when the ASC rail overlay is off). */
  reservedRailSegments: number
  /** Occupancy and label overlay counts (zeros while those overlays are off). */
  layers: OverlayLayerStats
  /** Container instances per LOD (placeholders count as LOD1). */
  containerLods: { lod0: number; lod1: number }
  /** SHC objects per LOD (all 0 until the SHC GLB has loaded). */
  shcLods: { lod0: number; lod1: number; lod2: number }
  /** 'placeholder' until the SHC GLB has loaded. */
  shcAssets: 'placeholder' | 'loaded'
  /** 'placeholder' until the container GLBs have loaded. */
  containerAssets: 'placeholder' | 'loaded'
  /** 'placeholder' (procedural cranes) until the STS GLB has loaded. */
  stsAssets: 'placeholder' | 'loaded'
  /** STS cranes per LOD drawn (placeholders count as none). */
  stsLods: { lod0: number; lod1: number; lod2: number }
}

/** What the scene draws for one container (dev API). */
export interface RenderedLivery {
  /** Livery atlas index (see assets/models/containers/livery-atlas.json). */
  index: number
  size: string
  lod: 0 | 1
  /** Centre drawn at the last update (m, world). */
  centre: Vec3
}

interface StsParts {
  group: THREE.Group
  trolley: THREE.Mesh
  ropes: THREE.Mesh
  spreader: THREE.Mesh
}

const LAND_RAIL_Z = STS.waterRailZ + STS.gauge

export class SceneRenderer {
  readonly scene = new THREE.Scene()
  private containers: ContainerInstancer
  private containerLivery: number[]
  private disposed = false
  private sts = new Map<string, StsParts>()
  private stsModels = new Map<string, StsModel>()
  private lastSpreader = new Map<string, SpreaderMode>()
  private vessels: VesselHulls
  private lastT = 0
  private shcs = new Map<string, { group: THREE.Group; spreader: THREE.Mesh; rig?: ShcRig }>()
  private hoistEase = new Map<string, { t: number; y: number }>()
  private ascs = new Map<string, { group: THREE.Group; trolley: THREE.Mesh; spreader: THREE.Mesh; ropes: THREE.Mesh; blockX: number; height: number }>()
  private laneOverlay: THREE.Group
  private zoneMeshes = new Map<string, THREE.Mesh>()
  private overlays: OverlayState = { ...NO_OVERLAYS }
  private reservedZones = 0
  private layers: OverlayLayers
  private railMeshes = new Map<string, THREE.Mesh>()
  private railMaterials: THREE.MeshBasicMaterial[] = []
  private reservedRailSegments = 0
  private readonly matrix = new THREE.Matrix4()
  private selection: THREE.LineSegments
  private disposables: { dispose(): void }[] = []

  constructor(private model: SceneModel) {
    const { config } = model
    this.scene.background = new THREE.Color('#a9bfd3')
    this.scene.fog = new THREE.Fog('#a9bfd3', 600, 2600)
    this.addLights()
    this.addGround(config)
    for (const s of config.sts) this.addSts(s.id)
    this.vessels = new VesselHulls(model)
    this.scene.add(this.vessels.group)
    this.addYard()
    for (const id of model.shcIds) this.addShc(id)
    for (const id of model.ascIds) this.addAsc(id)
    this.laneOverlay = this.buildLaneOverlay()
    this.buildZoneMeshes()
    this.layers = new OverlayLayers(model)
    this.scene.add(this.layers.group)
    this.buildRailMeshes()

    const capacity: Partial<Record<string, number>> = {}
    for (const id of model.containerIds) capacity[model.containerSize[id]] = (capacity[model.containerSize[id]] ?? 0) + 1
    this.containers = new ContainerInstancer(capacity)
    this.containerLivery = model.containerIds.map((id) => liveryIndexForLine(model.containerLine[id]))
    this.scene.add(this.containers.group)
    loadContainerAssets().then(
      (assets) => {
        if (!this.disposed) this.containers.setAssets(assets)
      },
      (err: unknown) => console.warn('Terminal Twin: container GLBs failed to load; keeping placeholders', err),
    )

    if (model.shcIds.length > 0) {
      loadShcModel().then(
        (shcModel) => {
          if (this.disposed) return
          for (const [id, entry] of this.shcs) {
            entry.rig = new ShcRig(shcModel, id)
            entry.group.visible = false
            this.scene.add(entry.rig.root)
          }
        },
        (err: unknown) => console.warn('Terminal Twin: SHC GLB failed to load; keeping placeholders', err),
      )
    }
    loadStsTemplate().then(
      (template) => {
        if (this.disposed) return
        config.sts.forEach((s, i) => {
          const m = new StsModel(template, i)
          m.root.name = `${s.id}-model`
          this.scene.add(m.root)
          this.stsModels.set(s.id, m)
          const placeholder = this.sts.get(s.id)
          if (placeholder) placeholder.group.visible = false
        })
      },
      (err: unknown) => console.warn('Terminal Twin: STS GLB failed to load; keeping procedural cranes', err),
    )

    const box = this.track(new THREE.BoxGeometry(1, 1, 1))
    const edges = this.track(new THREE.EdgesGeometry(box))
    this.selection = new THREE.LineSegments(edges, this.track(new THREE.LineBasicMaterial({ color: '#f59e0b' })))
    this.selection.visible = false
    this.scene.add(this.selection)
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing)
    return thing
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight('#dfe9f5', '#5a5248', 1.4))
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2)
    sun.position.set(-150, 260, 180)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    // ~0.25 m shadow texels: bias so container corrugation does not self-shadow (acne).
    sun.shadow.normalBias = 0.35
    sun.shadow.bias = -0.0004
    const c = sun.shadow.camera
    c.left = -250
    c.right = 250
    c.top = 250
    c.bottom = -250
    c.near = 10
    c.far = 800
    sun.target.position.set(0, 0, 0)
    this.scene.add(sun, sun.target)
  }

  private addGround(config: ScenarioConfig): void {
    const length = config.quay.lengthM
    const water = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(6000, 3000)),
      this.track(new THREE.MeshStandardMaterial({ color: '#2d5873', roughness: 0.35, metalness: 0.1 })),
    )
    water.rotation.x = -Math.PI / 2
    water.position.set(length / 2, -QUAY_ABOVE_WATER_M, -1500)
    water.receiveShadow = true
    this.scene.add(water)

    const apronDepth = 900
    const apron = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(length + 1200, 3, apronDepth)),
      this.track(new THREE.MeshStandardMaterial({ color: '#9a9c9a', roughness: 0.95 })),
    )
    apron.position.set(length / 2, -1.5, apronDepth / 2)
    apron.receiveShadow = true
    this.scene.add(apron)

    const strip = (z: number, width: number, colour: string, y = 0.02) => {
      const m = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(length + 80, width)),
        this.track(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 })),
      )
      m.rotation.x = -Math.PI / 2
      m.position.set(length / 2, y, z)
      m.receiveShadow = true
      this.scene.add(m)
    }
    strip(0.6, 1.2, '#e5c84a') // quay edge
    strip(STS.waterRailZ, 0.5, '#4b4f55', 0.04) // STS rails
    strip(LAND_RAIL_Z, 0.5, '#4b4f55', 0.04)
    const { stsGroundLaneZ0M: z0, stsGroundLaneSpacingM: dz } = config.layout
    const lanes = Math.max(0, ...config.sts.map((s) => s.groundPositions))
    for (let lane = 0; lane <= lanes; lane++) strip(z0 - dz / 2 + lane * dz, 0.15, '#eef0f2', 0.03)
  }

  private addSts(id: string): void {
    const group = new THREE.Group()
    group.name = id
    const steel = this.track(new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 0.6, metalness: 0.3 }))
    const accent = this.track(new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.6 }))
    const dark = this.track(new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.7 }))
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), mat)
      m.position.set(x, y, z)
      m.castShadow = true
      group.add(m)
      return m
    }
    const zW = STS.waterRailZ
    const zL = LAND_RAIL_Z
    const hx = STS.legSpacingX / 2
    for (const x of [-hx, hx]) {
      for (const z of [zW, zL]) box(STS.legSize, STS.portalY, STS.legSize, steel, x, STS.portalY / 2, z)
      box(STS.legSize, STS.legSize, zL - zW, steel, x, STS.portalY, (zW + zL) / 2) // portal side beams
      box(STS.legSize * 0.8, STS.legSize * 0.8, zL - zW, steel, x, 12, (zW + zL) / 2) // sill beams
      box(STS.legSize * 0.7, STS.apexY - STS.portalY, STS.legSize * 0.7, steel, x, (STS.apexY + STS.portalY) / 2, zL - 4) // A-frame
    }
    for (const z of [zW, zL]) box(STS.legSpacingX, STS.legSize, STS.legSize, steel, 0, STS.portalY, z)
    // Boom (girders on both sides of the trolley path) and the machinery house.
    const boomLen = STS.boomBackreachZ + zL - STS.boomOutreachZ
    const boomZ = (STS.boomOutreachZ + zL + STS.boomBackreachZ) / 2
    for (const x of [-3, 3]) box(1.2, 2.4, boomLen, steel, x, STS.portalY + 4, boomZ)
    box(7.2, 0.6, 2, accent, 0, STS.portalY + 4, STS.boomOutreachZ + 1) // boom tip
    box(10, 6, 14, steel, 0, STS.portalY + 9, zL + STS.boomBackreachZ - 8) // machinery house
    box(STS.legSpacingX + 2, 1.2, 2, accent, 0, STS.portalY + 1.2, zW) // waterside portal accent
    // Moving parts.
    const trolley = box(6.4, 2.4, 5, dark, 0, STS.portalY + 1.6, 0)
    const ropes = box(0.25, 1, 0.25, dark, 0, 0, 0)
    const spreader = box(12.2, 0.7, 2.5, this.track(new THREE.MeshStandardMaterial({ color: '#f2b705' })), 0, 0, 0)
    this.scene.add(group)
    this.sts.set(id, { group, trolley, ropes, spreader })
  }

  /** Blocks: paved slab, ASC rails, bay marks and transfer stalls; WTP pad markings. */
  private addYard(): void {
    const { graph } = this.model
    const slab = this.track(new THREE.MeshStandardMaterial({ color: '#b4b6b3', roughness: 0.95 }))
    const rail = this.track(new THREE.MeshStandardMaterial({ color: '#4b4f55', roughness: 0.8 }))
    const mark = this.track(new THREE.MeshBasicMaterial({ color: '#8d9091' }))
    const stall = this.track(new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.8 }))
    for (const b of this.model.blockList) {
      const z0 = b.wtpZ + 7
      const endZ = b.firstBayZ + (b.bays - 0.5) * YARD_BAY_PITCH_M
      const depth = endZ - z0 + 22
      const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(ASC.span + 3.6, depth)), slab)
      m.rotation.x = -Math.PI / 2
      m.position.set(b.x, 0.02, z0 + depth / 2)
      m.receiveShadow = true
      this.scene.add(m)
      for (const dx of [-ASC.span / 2, ASC.span / 2]) {
        const r = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.4, 0.2, depth)), rail)
        r.position.set(b.x + dx, 0.1, z0 + depth / 2)
        this.scene.add(r)
      }
      // row lines (between the rows) and bay ticks along the block
      const lines = new THREE.BufferGeometry()
      const pts: number[] = []
      for (let r = 0; r <= b.rows; r++) {
        const x = rowX(b, r + 0.5)
        pts.push(x, 0.05, z0 + 1, x, 0.05, endZ + 3.35)
      }
      lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      this.track(lines)
      this.scene.add(new THREE.LineSegments(lines, this.track(new THREE.LineBasicMaterial({ color: '#8d9091' }))))
      for (let bay = 0; bay <= b.bays; bay++) {
        const tick = new THREE.Mesh(this.track(new THREE.PlaneGeometry(b.rows * YARD_ROW_PITCH_M, 0.12)), mark)
        tick.rotation.x = -Math.PI / 2
        tick.position.set(b.x, 0.04, b.firstBayZ + (bay - 0.5) * YARD_BAY_PITCH_M)
        this.scene.add(tick)
      }
      // transfer stalls (truck handover, TT-13) at the landside end
      for (let k = 0; k < b.transferStalls; k++) {
        const x = b.x + (k - (b.transferStalls - 1) / 2) * 5.5
        const outline = new THREE.Mesh(this.track(new THREE.PlaneGeometry(3.2, 13)), stall)
        outline.rotation.x = -Math.PI / 2
        outline.position.set(x, 0.03, endZ + 14)
        this.scene.add(outline)
      }
    }
    const padMat = this.track(new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.8 }))
    const padInner = this.track(new THREE.MeshStandardMaterial({ color: '#8f918f', roughness: 0.95 }))
    for (const p of graph.pads) {
      const outline = new THREE.Mesh(this.track(new THREE.PlaneGeometry(3.2, 13)), padMat)
      outline.rotation.x = -Math.PI / 2
      outline.position.set(p.x, 0.03, p.z)
      this.scene.add(outline)
      const inner = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2.8, 12.6)), padInner)
      inner.rotation.x = -Math.PI / 2
      inner.position.set(p.x, 0.035, p.z)
      this.scene.add(inner)
    }
  }

  /** Procedural low-poly shuttle carrier: four legs, side and cross beams, cab, spreader. Length along local X. */
  private addShc(id: string): void {
    const group = new THREE.Group()
    group.name = id
    const frame = this.track(new THREE.MeshStandardMaterial({ color: '#e8ebef', roughness: 0.55, metalness: 0.25 }))
    const accent = this.track(new THREE.MeshStandardMaterial({ color: '#d35400', roughness: 0.6 }))
    const dark = this.track(new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.8 }))
    const glass = this.track(new THREE.MeshStandardMaterial({ color: '#7fb3d5', roughness: 0.2, metalness: 0.4 }))
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), mat)
      m.position.set(x, y, z)
      m.castShadow = true
      group.add(m)
      return m
    }
    const hl = SHC.length / 2 - SHC.leg / 2
    const hw = SHC.width / 2 - SHC.leg / 2
    const top = SHC.height - SHC.beam / 2
    for (const x of [-hl, hl]) {
      for (const z of [-hw, hw]) {
        box(SHC.leg, SHC.height - 0.9, SHC.leg, frame, x, (SHC.height - 0.9) / 2 + 0.9, z)
        box(1.2, 1.2, 0.5, dark, x, 0.6, z) // wheel
      }
      box(SHC.leg, SHC.beam, SHC.width, accent, x, top, 0) // cross beam
    }
    for (const z of [-hw, hw]) {
      box(SHC.length, SHC.beam, SHC.leg, frame, 0, top, z) // side beam
      box(SHC.length * 0.8, 0.5, SHC.leg, accent, 0, 1.3, z) // lower skirt
    }
    box(2.2, 1.8, 2, frame, hl - 0.6, SHC.height + 0.9, 0) // cab
    box(0.1, 1.1, 1.7, glass, hl + 0.52, SHC.height + 1.05, 0)
    const spreader = box(6.4, 0.35, 2.6, this.track(new THREE.MeshStandardMaterial({ color: '#f2b705' })), 0, 0, 0)
    this.scene.add(group)
    this.shcs.set(id, { group, spreader })
  }

  /**
   * Procedural ASC: a portal on two rails that spans the rows (legs at the
   * rails, a girder across), a trolley on the girder and a hoisted spreader.
   * The group sits at the gantry Z; the trolley and spreader move in local X.
   */
  private addAsc(id: string): void {
    const block = this.model.blockOfAsc(id)
    const height = ascHeightM(block)
    const group = new THREE.Group()
    group.name = id
    const frame = this.track(new THREE.MeshStandardMaterial({ color: '#2f6fb3', roughness: 0.55, metalness: 0.25 }))
    const accent = this.track(new THREE.MeshStandardMaterial({ color: '#f2b705', roughness: 0.6 }))
    const dark = this.track(new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.8 }))
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), mat)
      m.position.set(x, y, z)
      m.castShadow = true
      group.add(m)
      return m
    }
    for (const side of [-1, 1]) {
      const x = (side * ASC.span) / 2
      box(ASC.legWidth, height, ASC.legWidth, frame, x, height / 2, -ASC.legLength / 2 + 0.5)
      box(ASC.legWidth, height, ASC.legWidth, frame, x, height / 2, ASC.legLength / 2 - 0.5)
      box(ASC.legWidth * 1.4, 0.6, ASC.legLength + 1, dark, x, 0.4, 0) // bogie
      box(ASC.legWidth, 0.8, ASC.legLength, accent, x, height * 0.55, 0) // leg tie
    }
    box(ASC.span + 6, ASC.girderHeight, ASC.girderDepth, frame, 0, height + ASC.girderHeight / 2, 0)
    const trolley = box(3.2, 1.2, ASC.girderDepth - 0.4, accent, 0, height + ASC.girderHeight + 0.6, 0)
    const ropes = box(0.12, 1, 0.12, dark, 0, 0, 0)
    const spreader = box(6.4, 0.35, 2.6, accent, 0, 0, 0)
    this.scene.add(group)
    this.ascs.set(id, { group, trolley, spreader, ropes, blockX: block.x, height: height + ASC.girderHeight })
  }

  /** Lane-graph overlay: every one-way edge with a chevron at its midpoint, plus node markers. */
  private buildLaneOverlay(): THREE.Group {
    const group = new THREE.Group()
    const { graph } = this.model
    const points: number[] = []
    const y = 0.25
    for (const e of graph.edges) {
      const a = graph.nodes[e.from]
      const b = graph.nodes[e.to]
      points.push(a.x, y, a.z, b.x, y, b.z)
      const len = Math.max(1e-6, Math.abs(b.x - a.x) + Math.abs(b.z - a.z))
      const dx = (b.x - a.x) / len
      const dz = (b.z - a.z) / len
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      const s = Math.min(1.5, len / 4)
      points.push(mx - dx * s - dz * s, y, mz - dz * s + dx * s, mx, y, mz)
      points.push(mx - dx * s + dz * s, y, mz - dz * s - dx * s, mx, y, mz)
    }
    const geom = this.track(new THREE.BufferGeometry())
    geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const lines = new THREE.LineSegments(geom, this.track(new THREE.LineBasicMaterial({ color: '#22d3ee' })))
    lines.renderOrder = 2
    group.add(lines)
    const nodeList = Object.values(graph.nodes)
    const nodes = new THREE.InstancedMesh(
      this.track(new THREE.BoxGeometry(0.8, 0.1, 0.8)),
      this.track(new THREE.MeshBasicMaterial({ color: '#0e7490' })),
      Math.max(1, nodeList.length),
    )
    nodeList.forEach((n, i) => {
      this.matrix.makeTranslation(n.x, y + 0.03, n.z)
      nodes.setMatrixAt(i, this.matrix)
    })
    this.disposables.push(nodes)
    group.add(nodes)
    group.visible = false
    this.scene.add(group)
    return group
  }

  /** One translucent plate per conflict zone, shown while that zone is reserved. */
  private buildZoneMeshes(): void {
    const mat = this.track(
      new THREE.MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.45, depthWrite: false }),
    )
    for (const zone of Object.values(this.model.graph.zones)) {
      const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(zone.x1 - zone.x0, zone.z1 - zone.z0)), mat)
      m.rotation.x = -Math.PI / 2
      m.position.set((zone.x0 + zone.x1) / 2, 0.3, (zone.z0 + zone.z1) / 2)
      m.renderOrder = 3
      m.visible = false
      m.name = zone.id
      this.scene.add(m)
      this.zoneMeshes.set(zone.id, m)
    }
  }

  /** One translucent strip per ASC rail segment, shown while a crane holds it (colour per crane). */
  private buildRailMeshes(): void {
    this.railMaterials = ['#38bdf8', '#fb7185'].map((color) =>
      this.track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false })),
    )
    for (const b of this.model.blockList) {
      for (const seg of this.model.railSegments(b.id)) {
        const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(ASC.span, seg.z1 - seg.z0)), this.railMaterials[0])
        m.rotation.x = -Math.PI / 2
        m.position.set(b.x, 0.35, (seg.z0 + seg.z1) / 2)
        m.renderOrder = 4
        m.visible = false
        m.name = seg.zone
        this.scene.add(m)
        this.railMeshes.set(seg.zone, m)
      }
    }
  }

  setOverlays(next: OverlayState): void {
    this.overlays = { ...next }
    this.laneOverlay.visible = next.laneGraph
  }

  update(t: number, selectedId: string | null, cameraPosition: THREE.Vector3): void {
    const model = this.model
    const containers = this.containers
    // Containers first: what each spreader carries decides its configuration (20 / 40 / twin-20).
    const load = new Map<string, { count: number; size: string }>()
    const carried = new Map<string, number>()
    containers.begin()
    model.containerIds.forEach((id, i) => {
      const c = model.containerPose(id, t)
      if (!c) return
      containers.push(i, model.containerSize[id], c.x, c.y, c.z, this.containerLivery[i], c.yaw)
      if (c.carriedBy) carried.set(c.carriedBy, CONTAINER_DIMS[model.containerSize[id]].height)
      if (this.stsModels.size) {
        const owner = model.custodyAt(id, t)
        if (owner?.kind === 'sts') {
          const l = load.get(owner.id)
          load.set(owner.id, { count: (l?.count ?? 0) + 1, size: model.containerSize[id] })
        }
      }
    })
    containers.end(cameraPosition)

    for (const [id, m] of this.stsModels) {
      const pose = model.stsPose(id, t)
      const l = load.get(id)
      const mode: SpreaderMode = !l ? (this.lastSpreader.get(id) ?? '40') : l.count > 1 ? 'twin-20' : l.size === '20' ? '20' : '40'
      this.lastSpreader.set(id, mode)
      m.carrying = l?.count ?? 0
      m.setPose({ gantryX: pose.gantryX, trolleyZ: pose.trolleyZ, hoistY: pose.hoistY, spreader: mode, locked: !!l })
      m.updateLod(cameraPosition)
    }
    for (const [id, parts] of this.sts) {
      if (this.stsModels.has(id)) continue
      const pose = model.stsPose(id, t)
      parts.group.position.x = pose.gantryX
      parts.trolley.position.z = pose.trolleyZ
      parts.spreader.position.set(0, pose.hoistY + 0.35, pose.trolleyZ)
      const ropeTop = STS.portalY + 0.4
      const ropeLen = Math.max(0.1, ropeTop - (pose.hoistY + 0.7))
      parts.ropes.scale.y = ropeLen
      parts.ropes.position.set(0, ropeTop - ropeLen / 2, pose.trolleyZ)
    }
    this.lastT = t
    this.vessels.update(t, cameraPosition)
    for (const [id, parts] of this.ascs) {
      const pose = model.ascPose(id, t)
      const lx = pose.x - parts.blockX
      parts.group.position.set(parts.blockX, 0, pose.z)
      parts.trolley.position.x = lx
      const spreaderY = pose.hoistY + CONTAINER_DIMS['40HC'].height + 0.2
      parts.spreader.position.set(lx, spreaderY, 0)
      const ropeLen = Math.max(0.1, parts.height - spreaderY)
      parts.ropes.scale.y = ropeLen
      parts.ropes.position.set(lx, parts.height - ropeLen / 2, 0)
    }
    this.reservedZones = 0
    const active = this.overlays.reservations ? model.activeReservations(t) : {}
    for (const [zone, mesh] of this.zoneMeshes) {
      mesh.visible = zone in active
      if (mesh.visible) this.reservedZones++
    }

    this.reservedRailSegments = 0
    const holders = this.overlays.ascRail ? model.activeReservations(t) : {}
    for (const [zone, mesh] of this.railMeshes) {
      const holder = holders[zone]
      mesh.visible = holder !== undefined
      if (mesh.visible) {
        this.reservedRailSegments++
        mesh.material = this.railMaterials[ascIndexOf(holder) === 1 ? 0 : 1]
      }
    }


    for (const [id, parts] of this.shcs) {
      const pose = model.shcPose(id, t)
      if (parts.rig) {
        const boxHeight = carried.get(id)
        parts.rig.chooseLod(Math.hypot(cameraPosition.x - pose.x, cameraPosition.y - 4, cameraPosition.z - pose.z))
        parts.rig.pose({
          x: pose.x,
          z: pose.z,
          yaw: pose.yaw,
          steerRad: pose.steerRad,
          odometerM: pose.odometerM,
          attachY: this.spreaderPlane(id, t, pose.lift, pose.travelling || model.statusAt('shc', id, t) === 'parked', boxHeight),
          carrying: boxHeight !== undefined,
        })
        continue
      }
      parts.group.position.set(pose.x, 0, pose.z)
      parts.group.rotation.y = pose.heading === 'z' ? Math.PI / 2 : 0
      // the spreader sits on top of the (possible) box: box bottom = lift
      parts.spreader.position.y = pose.lift + CONTAINER_DIMS['40'].height + 0.2
    }
    this.layers.update(t, this.overlays)
    this.updateSelection(selectedId, t)
  }

  /**
   * Height of the spreader's twist-lock plane. Carrying: exactly the box top (it follows the engine's lift
   * motion). Empty: raised while driving or parked, lowered onto where a box would stand otherwise, eased so it never snaps.
   */
  private spreaderPlane(id: string, t: number, lift: number, raised: boolean, boxHeight: number | undefined): number {
    if (boxHeight !== undefined) {
      this.hoistEase.delete(id)
      return lift + boxHeight
    }
    const target = raised ? SHC_RIG.attachRestY : lift + EMPTY_SPREADER_DOWN_Y
    const ease = this.hoistEase.get(id)
    let y = target
    if (ease && Math.abs(t - ease.t) < 30) {
      const step = EMPTY_HOIST_MPS * Math.abs(t - ease.t)
      y = ease.y + Math.max(-step, Math.min(step, target - ease.y))
    }
    this.hoistEase.set(id, { t, y })
    return y
  }


  private updateSelection(id: string | null, t: number): void {
    const b = id ? entityBounds(this.model, id, t) : null
    if (!b) {
      this.selection.visible = false
      return
    }
    this.selection.scale.set(b.sx, b.sy, b.sz)
    this.selection.position.set(b.x, b.y, b.z)
    this.selection.rotation.y = b.yaw
    this.selection.visible = true
  }

  /** A reasonable camera target for the whole scene (between the first STS and the yard when there are SHCs). */
  overviewTarget(): Vec3 {
    const s = this.model.config.sts[0]
    const x = s ? s.gantryX : this.model.config.quay.lengthM / 2
    const block = this.model.config.yard?.blocks[0]
    if (block && this.model.shcIds.length > 0) return { x: (x + block.x) / 2, y: 8, z: 30 }
    return { x, y: 10, z: 5 }
  }

  stats(): SceneStats {
    const v = this.vessels.stats()
    const c = this.containers.stats()
    const shcLods = { lod0: 0, lod1: 0, lod2: 0 }
    let rigged = 0
    for (const { rig } of this.shcs.values()) {
      if (!rig) continue
      rigged++
      shcLods[`lod${rig.rigState.lod}` as keyof typeof shcLods]++
    }
    return {
      containers: c.drawn,
      sts: this.sts.size,
      shcs: this.shcs.size,
      ascs: this.ascs.size,
      vessels: v.visible,
      vesselAssets: v.assets,
      vesselLods: v.lods,
      overlays: { ...this.overlays },
      reservedZones: this.reservedZones,
      reservedRailSegments: this.reservedRailSegments,
      layers: this.layers.stats(),
      containerLods: { lod0: c.lod0, lod1: c.lod1 },
      containerAssets: c.assets,
      shcLods,
      shcAssets: rigged > 0 ? 'loaded' : 'placeholder',
      stsAssets: this.stsModels.size ? 'loaded' : 'placeholder',
      stsLods: {
        lod0: [...this.stsModels.values()].filter((m) => m.lod === 0).length,
        lod1: [...this.stsModels.values()].filter((m) => m.lod === 1).length,
        lod2: [...this.stsModels.values()].filter((m) => m.lod === 2).length,
      },
    }
  }

  /** Per STS: LOD, spreader configuration, boxes carried and the drawn spreader/trolley positions (GLB cranes only). */
  renderedSts(): Record<string, StsRenderState> {
    return Object.fromEntries([...this.stsModels].map(([id, m]) => [id, m.renderState()]))
  }


  /** Rig state per SHC at the last update (empty until the SHC GLB has loaded). */
  renderedShcs(): Record<string, ShcRigState> {
    const out: Record<string, ShcRigState> = {}
    for (const [id, { rig }] of this.shcs) if (rig) out[id] = { ...rig.rigState }
    return out
  }

  /** Livery, size and LOD drawn per container id at the last update. */
  renderedLiveries(): Record<string, RenderedLivery> {
    const out: Record<string, RenderedLivery> = {}
    this.model.containerIds.forEach((id, i) => {
      const r = this.containers.renderedContainer(i)
      const centre = r && this.model.containerCentre(id, this.lastT)
      if (r && centre) out[id] = { index: r.livery, size: r.size, lod: r.lod, centre }
    })
    return out
  }

  /** Per vessel: class, line, livery, name, LOD and the rendered bay grid (TT-27). */
  vesselHulls(): Record<string, VesselHullState> {
    return this.vessels.states()
  }

  dispose(): void {
    this.disposed = true
    for (const m of this.stsModels.values()) m.dispose()
    this.vessels.dispose()
    for (const d of this.disposables) d.dispose()
    this.containers.dispose()
    this.layers.dispose()
    this.disposables = []
  }
}
