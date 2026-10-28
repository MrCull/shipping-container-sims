/**
 * Phase 1 procedural low-poly scene: quay, water, STS cranes on their rail and
 * vessel hulls. Containers are drawn by the ContainerInstancer: procedural
 * placeholder boxes at once, then the phase 2 GLB LODs (LOD0 near the camera,
 * LOD1 elsewhere) with a per-instance livery as soon as they load. Shared
 * geometries and materials; nothing here is reactive (never put these in Vue state).
 *
 * `update(model, t)` poses everything for display time `t` from the
 * SceneModel timelines.
 */
import * as THREE from 'three'
import type { ScenarioConfig } from '../scenario/types'
import { CONTAINER_DIMS, type SceneModel, type Vec3 } from './sceneModel'
import { ContainerInstancer } from './containerInstancer'
import { LIVERY_ATLAS, liveryBodyColour, liveryIndexForLine, loadContainerAssets } from './containerAssets'
import { aftOffsetM, BAY_PITCH_M, FENDER_GAP_M, ROW_PITCH_M, slotX, slotZ, TIER_PITCH_M } from '../scenario/vesselClasses'

/** [A] Malaccamax-style STS proportions (m). */
const STS = {
  waterRailZ: 3,
  gauge: 30.48,
  legSpacingX: 18,
  legSize: 1.6,
  portalY: 48,
  boomOutreachZ: -72,
  boomBackreachZ: 22,
  apexY: 72,
}

/** [A] Shuttle-carrier proportions (m): length along travel, width across, height. */
const SHC = { length: 9.2, width: 4.9, height: 6.2, leg: 0.6, beam: 0.7 }

export interface OverlayState {
  /** Lane graph (one-way edges) drawn on the ground. */
  laneGraph: boolean
  /** Conflict zones reserved at the displayed time, highlighted. */
  reservations: boolean
}

export interface SceneStats {
  /** Container instances drawn. */
  containers: number
  /** STS crane objects in the scene. */
  sts: number
  /** SHC objects in the scene. */
  shcs: number
  /** Vessel hulls currently visible. */
  vessels: number
  overlays: OverlayState
  /** Reserved zones highlighted (0 when the reservations overlay is off). */
  reservedZones: number
  /** Container instances per LOD (placeholders count as LOD1). */
  containerLods: { lod0: number; lod1: number }
  /** 'placeholder' until the container GLBs have loaded. */
  containerAssets: 'placeholder' | 'loaded'
}

/** What the scene draws for one container (dev API). */
export interface RenderedLivery {
  /** Livery atlas index (see assets/models/containers/livery-atlas.json). */
  index: number
  size: string
  lod: 0 | 1
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
  private vessels = new Map<string, THREE.Group>()
  private shcs = new Map<string, { group: THREE.Group; spreader: THREE.Mesh }>()
  private laneOverlay: THREE.Group
  private zoneMeshes = new Map<string, THREE.Mesh>()
  private overlays: OverlayState = { laneGraph: false, reservations: false }
  private reservedZones = 0
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
    for (const v of config.vessels) this.addVessel(v.id)
    this.addYard()
    for (const id of model.shcIds) this.addShc(id)
    this.laneOverlay = this.buildLaneOverlay()
    this.buildZoneMeshes()

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
    water.position.set(length / 2, -2.5, -1500)
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

  /**
   * Procedural low-poly hull sized to the vessel's class: a plan-view outline
   * (square stern, pointed bow) extruded from the keel to the main deck, a
   * boot-top band, hatch covers per bay, the accommodation block aft of bay 0
   * and a funnel. Local frame: stern at x = 0, quay-side hull face at
   * z = -FENDER_GAP_M; the group is moved to the berth (or anchorage) per frame.
   */
  private addVessel(id: string): void {
    const spec = this.model.vesselSpec(id)
    const v = this.model.vesselConfig(id)
    const group = new THREE.Group()
    group.name = id
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
    const extrude = (depth: number) => {
      const g = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false })
      g.rotateX(-Math.PI / 2) // shape Y (beam) -> -Z (seaward), extrusion -> +Y
      return this.track(g)
    }
    const line = LIVERY_ATLAS.liveries.find((l) => l.line !== null && v.name.startsWith(l.line))?.line
    const hullColour = line ? liveryBodyColour(liveryIndexForLine(line)) : '#33465f'
    const hull = new THREE.Mesh(
      extrude(mainDeck + draft),
      this.track(new THREE.MeshStandardMaterial({ color: new THREE.Color(hullColour).multiplyScalar(0.55), roughness: 0.6 })),
    )
    hull.position.set(0, -draft, -FENDER_GAP_M)
    hull.castShadow = true
    hull.receiveShadow = true
    const boot = new THREE.Mesh(extrude(4), this.track(new THREE.MeshStandardMaterial({ color: '#8c2f2f', roughness: 0.7 })))
    boot.scale.set(1.002, 1, 1.004)
    boot.position.set(-0.05, -3, -FENDER_GAP_M + 0.05)
    const aft = aftOffsetM(spec)
    const white = this.track(new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.6 }))
    const bridgeL = Math.min(14, aft - 4)
    const bridgeH = spec.deckTiers * TIER_PITCH_M + 8
    const bridge = new THREE.Mesh(this.track(new THREE.BoxGeometry(bridgeL, bridgeH, spec.beamM - 2)), white)
    bridge.position.set(aft - bridgeL / 2 - 2, mainDeck + bridgeH / 2, -FENDER_GAP_M - spec.beamM / 2)
    bridge.castShadow = true
    const funnel = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(5, 8, 5)),
      this.track(new THREE.MeshStandardMaterial({ color: hullColour, roughness: 0.6 })),
    )
    funnel.position.set(Math.max(3, aft - bridgeL - 6), mainDeck + 4, -FENDER_GAP_M - spec.beamM / 2)
    // hatch covers: one slab per 40 ft bay
    const hatchMat = this.track(new THREE.MeshStandardMaterial({ color: '#5b6470', roughness: 0.8 }))
    const hatchGeo = this.track(new THREE.BoxGeometry(BAY_PITCH_M - 1.2, 0.8, spec.rows * ROW_PITCH_M))
    for (let bay = 0; bay < spec.bays; bay++) {
      const hatch = new THREE.Mesh(hatchGeo, hatchMat)
      hatch.position.set(slotX(spec, 0, bay), spec.deckHeightM - 0.4, slotZ(spec, (spec.rows - 1) / 2))
      hatch.receiveShadow = true
      group.add(hatch)
    }
    group.add(hull, boot, bridge, funnel)
    group.visible = false
    this.scene.add(group)
    this.vessels.set(id, group)
  }

  /** WTP pad markings and block footprints (the ASC itself arrives with TT-06). */
  private addYard(): void {
    const { graph } = this.model
    const slab = this.track(new THREE.MeshStandardMaterial({ color: '#b4b6b3', roughness: 0.95 }))
    const rail = this.track(new THREE.MeshStandardMaterial({ color: '#4b4f55', roughness: 0.8 }))
    for (const b of this.model.config.yard?.blocks ?? []) {
      const depth = 140
      const z0 = graph.layout.wtpZ + 7
      const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(28, depth)), slab)
      m.rotation.x = -Math.PI / 2
      m.position.set(b.x, 0.02, z0 + depth / 2)
      m.receiveShadow = true
      this.scene.add(m)
      for (const dx of [-14.2, 14.2]) {
        const r = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.4, 0.2, depth + 10)), rail)
        r.position.set(b.x + dx, 0.1, z0 + depth / 2 - 5)
        this.scene.add(r)
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

  setOverlays(next: OverlayState): void {
    this.overlays = { ...next }
    this.laneOverlay.visible = next.laneGraph
  }

  update(t: number, selectedId: string | null, cameraPosition: THREE.Vector3): void {
    const model = this.model
    for (const [id, parts] of this.sts) {
      const pose = model.stsPose(id, t)
      parts.group.position.x = pose.gantryX
      parts.trolley.position.z = pose.trolleyZ
      parts.spreader.position.set(0, pose.hoistY + 0.35, pose.trolleyZ)
      const ropeTop = STS.portalY + 0.4
      const ropeLen = Math.max(0.1, ropeTop - (pose.hoistY + 0.7))
      parts.ropes.scale.y = ropeLen
      parts.ropes.position.set(0, ropeTop - ropeLen / 2, pose.trolleyZ)
    }
    for (const [id, group] of this.vessels) {
      const p = model.vesselPlacement(id, t)
      group.visible = p !== null
      if (p) group.position.set(p.x, 0, p.zOffset)
    }
    for (const [id, parts] of this.shcs) {
      const pose = model.shcPose(id, t)
      parts.group.position.set(pose.x, 0, pose.z)
      parts.group.rotation.y = pose.heading === 'z' ? Math.PI / 2 : 0
      // the spreader sits on top of the (possible) box: box bottom = lift
      parts.spreader.position.y = pose.lift + CONTAINER_DIMS['40'].height + 0.2
    }
    this.reservedZones = 0
    const active = this.overlays.reservations ? model.activeReservations(t) : {}
    for (const [zone, mesh] of this.zoneMeshes) {
      mesh.visible = zone in active
      if (mesh.visible) this.reservedZones++
    }

    const containers = this.containers
    containers.begin()
    model.containerIds.forEach((id, i) => {
      const c = model.containerPose(id, t)
      if (c) containers.push(i, model.containerSize[id], c.x, c.y, c.z, this.containerLivery[i], c.yaw)
    })
    containers.end(cameraPosition)

    this.updateSelection(selectedId, t)
  }

  private updateSelection(id: string | null, t: number): void {
    const centre = id ? this.model.entityCentre(id, t) : null
    if (!id || !centre) {
      this.selection.visible = false
      return
    }
    const size = this.model.containerSize[id]
    this.selection.rotation.y = 0
    if (size) {
      const d = CONTAINER_DIMS[size]
      this.selection.scale.set(d.length + 0.6, d.height + 0.6, d.width + 0.6)
      this.selection.position.set(centre.x, centre.y, centre.z)
      this.selection.rotation.y = this.model.containerPose(id, t)?.yaw ?? 0
    } else if (this.shcs.has(id)) {
      const pose = this.model.shcPose(id, t)
      this.selection.scale.set(SHC.length + 1, SHC.height + 3, SHC.width + 1)
      this.selection.position.set(pose.x, (SHC.height + 3) / 2, pose.z)
      this.selection.rotation.y = pose.heading === 'z' ? Math.PI / 2 : 0
    } else if (this.sts.has(id)) {
      this.selection.scale.set(STS.legSpacingX + 4, STS.apexY + 2, STS.gauge + 6)
      this.selection.position.set(centre.x, (STS.apexY + 2) / 2, STS.waterRailZ + STS.gauge / 2)
    } else {
      const spec = this.model.vesselSpec(id)
      this.selection.scale.set(spec.loaM + 2, spec.deckHeightM + 14, spec.beamM + 2)
      this.selection.position.set(centre.x, spec.deckHeightM / 2, centre.z - FENDER_GAP_M)
    }
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
    let vessels = 0
    for (const g of this.vessels.values()) if (g.visible) vessels++
    const c = this.containers.stats()
    return {
      containers: c.drawn,
      sts: this.sts.size,
      shcs: this.shcs.size,
      vessels,
      overlays: { ...this.overlays },
      reservedZones: this.reservedZones,
      containerLods: { lod0: c.lod0, lod1: c.lod1 },
      containerAssets: c.assets,
    }
  }

  /** Livery, size and LOD drawn per container id at the last update. */
  renderedLiveries(): Record<string, RenderedLivery> {
    const out: Record<string, RenderedLivery> = {}
    this.model.containerIds.forEach((id, i) => {
      const r = this.containers.renderedContainer(i)
      if (r) out[id] = { index: r.livery, size: r.size, lod: r.lod }
    })
    return out
  }

  dispose(): void {
    this.disposed = true
    for (const d of this.disposables) d.dispose()
    this.containers.dispose()
    this.disposables = []
  }
}
