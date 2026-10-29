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
import { ascIndexOf, BAY_PITCH_M as YARD_BAY_PITCH_M, ROW_PITCH_M as YARD_ROW_PITCH_M, rowX, transferStallLayout, STALL_LENGTH_M } from '../engine'
import type { ScenarioConfig } from '../scenario/types'
import { CONTAINER_DIMS, type SceneModel, type Vec3 } from './sceneModel'
import { ASC, STS } from './equipmentDims'
import { entityBounds } from './picking'
import { OverlayLayers, type LabelScreen, type OverlayLayerStats } from './overlayLayers'
import { NO_OVERLAYS, type OverlayState } from './overlays'

export type { OverlayState }
import { ContainerInstancer } from './containerInstancer'
import { liveryIndexForLine, loadContainerAssets } from './containerAssets'
import { QUAY_ABOVE_WATER_M } from '../scenario/vesselClasses'
import type { LandsideStats } from './landsideRenderer'
import { EQUIPMENT_KINDS, type EquipmentKindDef, type KindFrame, type KindRenderer, type KindRendererHost } from './equipmentKinds'
import { GROUND_ROTATION_X, StaticBatch } from './staticBatch'
import { QUALITY_PROFILES, type QualityProfile } from './quality'
import { AtmosphereRig, type AtmosphereState } from './atmosphereRig'
import type { Lighting } from './atmosphere'
import { BACKDROP_MODEL_ASSETS, backdropKindFor, buildBackdrop, type Backdrop, type BackdropKind } from './backdrop'
import { InfrastructureScene, type InfrastructureStats } from './infrastructureRenderer'
import { loadInfrastructureAssets } from './infrastructureAssets'

export interface SceneStats {
  /** Container instances drawn. */
  containers: number
  /** Trucks drawn and queued at the gate (TT-13). */
  landside: LandsideStats
  /** Phase 2 infrastructure (TT-28): instanced gate, quay, yard and building models. */
  infrastructure: InfrastructureStats
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
  containerLods: { lod0: number; lod1: number; culled: number }
  /** SHC objects per LOD (all 0 until the SHC GLB has loaded). */
  shcLods: { lod0: number; lod1: number; lod2: number }
  /** 'placeholder' until the SHC GLB has loaded. */
  shcAssets: 'placeholder' | 'loaded'
  /** ASC objects per LOD (all 0 until the ASC GLB has loaded). */
  ascLods: { lod0: number; lod1: number; lod2: number }
  /** 'placeholder' until the ASC GLB has loaded. */
  ascAssets: 'placeholder' | 'loaded'
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

const LAND_RAIL_Z = STS.waterRailZ + STS.gauge

export class SceneRenderer {
  readonly scene = new THREE.Scene()
  private containers: ContainerInstancer
  private containerLivery: number[]
  private disposed = false
  private lastT = 0
  private renderers: { def: EquipmentKindDef; renderer: KindRenderer }[] = []
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
  private water!: THREE.Mesh
  private waterSegments = 0
  private waterBase!: THREE.BufferGeometry
  private quality: QualityProfile = QUALITY_PROFILES.high
  private atmosphere: AtmosphereRig
  private backdrop: Backdrop
  private infrastructure: InfrastructureScene
  /** Phase 1 procedural quay lines, ASC rails and ground markings: hidden once the phase 2 infrastructure draws. */
  private infraPlaceholders: THREE.Object3D[] = []

  constructor(private model: SceneModel) {
    const { config } = model
    this.atmosphere = new AtmosphereRig(this.scene, model, { quayZ: LAND_RAIL_Z + 6 })
    this.addGround(config)
    this.backdrop = buildBackdrop(backdropKindFor(config.name), config.quay.lengthM)
    this.scene.add(this.backdrop.group)
    this.addYard()
    const host: KindRendererHost = { scene: this.scene, model, track: (thing) => this.track(thing), isDisposed: () => this.disposed }
    for (const def of EQUIPMENT_KINDS) this.renderers.push({ def, renderer: def.createRenderer(host) })
    this.infrastructure = new InfrastructureScene({ config, landside: model.landside, pads: model.graph.pads, blocks: model.blockList })
    this.scene.add(this.infrastructure.group)
    const infraNames = [...new Set([...this.infrastructure.assetNames(), ...BACKDROP_MODEL_ASSETS[this.backdrop.kind]])]
    loadInfrastructureAssets(infraNames).then(
      (assets) => {
        if (this.disposed) return
        this.infrastructure.setAssets(assets)
        this.backdrop.useModels(assets)
        for (const r of this.renderers) r.renderer.onInfrastructureLoaded?.()
        this.atmosphere.useMastModels()
        for (const o of this.infraPlaceholders) o.visible = false
      },
      (err: unknown) => console.warn('Terminal Twin: infrastructure GLBs failed to load; keeping procedural infrastructure', err),
    )
    this.laneOverlay = this.buildLaneOverlay()
    this.buildZoneMeshes()
    this.layers = new OverlayLayers(model)
    this.scene.add(this.layers.group)
    this.buildRailMeshes()

    const capacity: Partial<Record<string, number>> = {}
    for (const id of model.containerIds) capacity[model.containerSize[id]] = (capacity[model.containerSize[id]] ?? 0) + 1
    // boxes trucks bring are created during the run: room for them (instances beyond the capacity are not drawn)
    if (config.landside) {
      const perDay = (config.landside.hourlyProfile ?? []).reduce((a, b) => a + b, 0)
      const extra = Math.min(2500, Math.ceil(perDay * 0.5) + (config.landside.scripted?.length ?? 0) + 60)
      for (const size of ['20', '40', '40HC'] as const) capacity[size] = (capacity[size] ?? 0) + extra
    }
    this.containers = new ContainerInstancer(capacity)
    this.containerLivery = model.containerIds.map((id) => liveryIndexForLine(model.containerLine[id]))
    this.scene.add(this.containers.group)
    loadContainerAssets().then(
      (assets) => {
        if (!this.disposed) this.containers.setAssets(assets)
      },
      (err: unknown) => console.warn('Terminal Twin: container GLBs failed to load; keeping placeholders', err),
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

  private addGround(config: ScenarioConfig): void {
    const length = config.quay.lengthM
    const water = (this.water = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(40000, 12000)),
      this.track(new THREE.MeshStandardMaterial({ color: '#2d5873', roughness: 0.35, metalness: 0.1 })),
    ))
    this.waterBase = water.geometry
    this.waterSegments = 1
    water.rotation.x = -Math.PI / 2
    water.position.set(length / 2, -QUAY_ABOVE_WATER_M, -6000)
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

    const strip = (z: number, width: number, colour: string, y = 0.02, placeholder = false) => {
      const m = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(length + 80, width)),
        this.track(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 })),
      )
      m.rotation.x = -Math.PI / 2
      m.position.set(length / 2, y, z)
      m.receiveShadow = true
      this.scene.add(m)
      if (placeholder) this.infraPlaceholders.push(m)
    }
    strip(0.6, 1.2, '#e5c84a', 0.02, true) // quay edge
    strip(STS.waterRailZ, 0.5, '#4b4f55', 0.04, true) // STS rails
    strip(LAND_RAIL_Z, 0.5, '#4b4f55', 0.04, true)
    const { stsGroundLaneZ0M: z0, stsGroundLaneSpacingM: dz } = config.layout
    const lanes = Math.max(0, ...config.sts.map((s) => s.groundPositions))
    for (let lane = 0; lane <= lanes; lane++) strip(z0 - dz / 2 + lane * dz, 0.15, '#eef0f2', 0.03)
  }

  /** Blocks: paved slab, ASC rails, bay marks and transfer stalls; WTP pad markings. */
  private addYard(): void {
    const { graph } = this.model
    const slab = this.track(new THREE.MeshStandardMaterial({ color: '#b4b6b3', roughness: 0.95 }))
    const rail = this.track(new THREE.MeshStandardMaterial({ color: '#4b4f55', roughness: 0.8 }))
    const mark = this.track(new THREE.MeshBasicMaterial({ color: '#8d9091' }))
    const stall = this.track(new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.8 }))
    // every flat piece below is merged per material (StaticBatch): ~1,300 meshes at TTI scale become a handful of draw calls
    const batch = new StaticBatch()
    const ph = new StaticBatch() // phase 1 rails and ground markings: hidden once the phase 2 infrastructure draws (TT-28)
    const flat = (w: number, d: number, x: number, y: number, z: number, mat: THREE.Material, receiveShadow = false, into: StaticBatch = batch) => {
      const geo = new THREE.PlaneGeometry(w, d)
      into.add(geo, mat, { x, y, z }, { rotationX: GROUND_ROTATION_X, receiveShadow })
      geo.dispose()
    }
    for (const b of this.model.blockList) {
      const z0 = b.wtpZ + 7
      const endZ = b.firstBayZ + (b.bays - 0.5) * YARD_BAY_PITCH_M
      const depth = endZ - z0 + 22
      flat(ASC.span + 3.6, depth, b.x, 0.02, z0 + depth / 2, slab, true)
      for (const dx of [-ASC.span / 2, ASC.span / 2]) {
        const geo = new THREE.BoxGeometry(0.4, 0.2, depth)
        ph.add(geo, rail, { x: b.x + dx, y: 0.1, z: z0 + depth / 2 })
        geo.dispose()
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
        flat(b.rows * YARD_ROW_PITCH_M, 0.12, b.x, 0.04, b.firstBayZ + (bay - 0.5) * YARD_BAY_PITCH_M, mark)
      }
      // transfer stalls (truck handover, TT-13) at the landside end
      for (const st of transferStallLayout(b)) {
        flat(3.2, STALL_LENGTH_M, st.x, 0.03, st.z, stall, false, ph)
      }
    }
    const padMat = this.track(new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.8 }))
    const padInner = this.track(new THREE.MeshStandardMaterial({ color: '#8f918f', roughness: 0.95 }))
    for (const p of graph.pads) {
      flat(3.2, 13, p.x, 0.03, p.z, padMat, false, ph)
      flat(2.8, 12.6, p.x, 0.035, p.z, padInner, false, ph)
    }
    for (const m of batch.build((x) => this.track(x))) this.scene.add(m)
    for (const m of ph.build((x) => this.track(x))) {
      this.scene.add(m)
      this.infraPlaceholders.push(m)
    }
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
    const road = this.model.landside
    for (const e of road?.edges ?? []) {
      const a = road!.nodes[e.from]
      const b = road!.nodes[e.to]
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
    for (const zone of [...Object.values(this.model.graph.zones), ...Object.values(this.model.landside?.zones ?? {})]) {
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

  /**
   * Applies a quality profile (TT-19): sun shadow on/off and map size, container LOD range, ocean
   * detail, night-glow budget. Render resolution and the shadow switch of the renderer itself are
   * applied by `useTwinScene`; the sun shadow and the glow points are the atmosphere's (`AtmosphereRig.setQuality`).
   */
  setQuality(profile: QualityProfile): void {
    this.quality = profile
    this.atmosphere.setQuality(profile)
    this.containers.setLodOptions({ lod0DistanceM: profile.lod0DistanceM, lod0Cap: profile.lod0Cap })
    this.setOceanDetail(profile.oceanSegments)
  }

  get qualityProfile(): QualityProfile {
    return this.quality
  }

  /** Water: a flat Lambert quad at the lowest detail, else the standard material on a gently displaced grid of `segments` per side. */
  private setOceanDetail(segments: number): void {
    if (segments === this.waterSegments) return
    this.waterSegments = segments
    const old = this.water.geometry
    const oldMat = this.water.material as THREE.Material
    if (segments <= 1) {
      this.water.geometry = this.waterBase
      this.water.material = this.track(new THREE.MeshLambertMaterial({ color: '#2d5873' }))
    } else {
      const { width, height } = (this.waterBase as THREE.PlaneGeometry).parameters
      const geo = this.track(new THREE.PlaneGeometry(width, height, segments, Math.max(1, Math.round(segments / 3))))
      const pos = geo.getAttribute('position')
      // a long, low swell: wavelengths of about 1.6 km and 1 km, 0.18 m high
      for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.18 * Math.sin(pos.getX(i) * 0.0039) * Math.cos(pos.getY(i) * 0.0063))
      geo.computeVertexNormals()
      this.water.geometry = geo
      this.water.material = this.track(new THREE.MeshStandardMaterial({ color: '#2d5873', roughness: 0.35, metalness: 0.1 }))
    }
    if (old !== this.waterBase) old.dispose()
    oldMat.dispose()
  }

  /** Apply the time-of-day lighting (day/dusk/night; cheap, call when it changes). */
  setLighting(l: Lighting): void {
    this.atmosphere.apply(l)
  }

  atmosphereState(): AtmosphereState & { backdrop: { kind: BackdropKind; parts: string[]; models: Backdrop['models'] } } {
    return { ...this.atmosphere.state(), backdrop: { kind: this.backdrop.kind, parts: [...this.backdrop.parts], models: this.backdrop.models } }
  }

  setOverlays(next: OverlayState): void {
    this.overlays = { ...next }
    this.laneOverlay.visible = next.laneGraph
  }

  update(t: number, selectedId: string | null, cameraPosition: THREE.Vector3, frustum?: THREE.Frustum, screen?: LabelScreen): void {
    const model = this.model
    const containers = this.containers
    // Containers first: what each spreader carries decides its configuration (20 / 40 / twin-20).
    const wantsOwners = this.renderers.some((r) => r.renderer.wantsContainerOwners)
    const loads = new Map<string, { count: number; size: string }>()
    const carried = new Map<string, number>()
    containers.begin()
    model.containerIds.forEach((id, i) => {
      const c = model.containerPose(id, t)
      if (!c) return
      this.containerLivery[i] ??= liveryIndexForLine(model.containerLine[id])
      containers.push(i, model.containerSize[id], c.x, c.y, c.z, this.containerLivery[i], c.yaw)
      if (c.carriedBy) carried.set(c.carriedBy, CONTAINER_DIMS[model.containerSize[id]].height)
      if (wantsOwners) {
        const owner = model.custodyAt(id, t)
        if (owner) {
          const key = `${owner.kind}:${owner.id}`
          const l = loads.get(key)
          loads.set(key, { count: (l?.count ?? 0) + 1, size: model.containerSize[id] })
        }
      }
    })
    containers.end(cameraPosition, frustum)

    this.lastT = t
    this.atmosphere.update(t)
    const frame: KindFrame = { t, cameraPosition, lodScale: this.quality.lodScale, carried, loads }
    for (const { renderer } of this.renderers) renderer.update(frame)
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
    this.layers.update(t, this.overlays, screen, selectedId)
    this.updateSelection(selectedId, t)
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

  /**
   * Where the draw calls go (dev/perf tool): visible, in-frustum drawables grouped by top-level
   * scene child (its name, else its type) and geometry type, with object and triangle counts.
   * Shadow-pass draws are not counted, so the main-pass total is what `renderer.info` reports without shadows.
   */
  drawBreakdown(frustum: THREE.Frustum): Record<string, { objects: number; triangles: number }> {
    const out: Record<string, { objects: number; triangles: number }> = {}
    for (const top of this.scene.children) {
      const label = top.name || top.type
      top.traverseVisible((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh && !(o as THREE.Line).isLine && !(o as THREE.Points).isPoints) return
        if (m.frustumCulled && !frustum.intersectsObject(m)) return
        const key = `${label}/${m.geometry.type}`
        const g = m.geometry
        const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3
        const entry = (out[key] ??= { objects: 0, triangles: 0 })
        entry.objects++
        entry.triangles += tris * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1)
      })
    }
    return out
  }

  stats(): SceneStats {
    const c = this.containers.stats()
    const kinds = Object.assign({}, ...this.renderers.map((r) => r.renderer.stats())) as Partial<SceneStats>
    return {
      ...kinds,
      containers: c.drawn,
      infrastructure: this.infrastructure.stats(),
      overlays: { ...this.overlays },
      reservedZones: this.reservedZones,
      reservedRailSegments: this.reservedRailSegments,
      layers: this.layers.stats(),
      containerLods: { lod0: c.lod0, lod1: c.lod1, culled: c.culled },
      containerAssets: c.assets,
    } as SceneStats
  }

  /** Rig state per equipment kind as last drawn (`EquipmentKindDef.rigKey` names it in the dev API); empty until a kind's GLB has loaded. */
  renderedRigs(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(this.renderers.map(({ def, renderer }) => [def.kind, renderer.rigState()]))
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

  dispose(): void {
    this.disposed = true
    this.atmosphere.dispose()
    this.backdrop.dispose()
    this.infrastructure.dispose()
    for (const { renderer } of this.renderers) renderer.dispose()
    for (const d of this.disposables) d.dispose()
    this.containers.dispose()
    this.layers.dispose()
    this.disposables = []
  }
}
