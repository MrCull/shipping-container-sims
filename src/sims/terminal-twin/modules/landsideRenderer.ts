/**
 * Landside scene (TT-13): the truck roads, the gate complex (lanes, kiosks, canopy, barriers, the unused
 * out-of-gauge lane), the transfer stalls and the trucks. Procedural low-poly. The phase 2 gate modules (TT-28,
 * `infrastructureRenderer.ts`) replace the gate furniture: the procedural gate stays in `gatePlaceholder` until they
 * have loaded (`useGateModels`); the road asphalt, queue approach and stall spurs stay procedural. Trucks use the phase 2 GLBs (TT-26: `truckAssets.ts`, LOD switching, articulation) once they have
 * loaded; until then (and if loading fails) a truck is a handful of merged procedural meshes (skeletal chassis, tractor,
 * cab, glass, wheels). The box on the chassis is drawn by the ContainerInstancer. Nothing here is reactive.
 */
import * as THREE from 'three'
import { GROUND_ROTATION_X, StaticBatch } from './staticBatch'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { STALL_LENGTH_M, TRUCK_DECK_M } from '../engine'
import { TRUCK } from './equipmentDims'
import type { SceneModel } from './sceneModel'
import { TruckRig, type TruckModels, type TruckRigState } from './truckAssets'

export interface LandsideStats {
  /** Trucks drawn at the last update. */
  trucks: number
  /** Trucks standing in the gate queue (status queued). */
  queued: number
  /** Holding positions drawn (TT-R16; zero without `config.landside.holding`). */
  holdingPositions: number
  /** Trucks standing in a holding position at the last update. */
  holding: number
  /** Trucks drawn from the GLB models per LOD (zero until they load). */
  lods: { lod0: number; lod1: number; lod2: number }
  assets: 'placeholder' | 'loaded'
}

/** [A] Cab colours (haulier fleets). */
const CAB_COLOURS = ['#c0392b', '#2471a3', '#f4f4f4', '#d4ac0d', '#1e8449', '#5d6d7e']

interface TruckMeshes {
  group: THREE.Group
  front?: THREE.Mesh
  /** Set when the GLB model draws this truck (the procedural group is then unused). */
  rig?: TruckRig
}

export class LandsideScene {
  readonly group = new THREE.Group()
  private disposables: { dispose(): void }[] = []
  private trucks = new Map<string, TruckMeshes>()
  private cabMats: THREE.MeshStandardMaterial[]
  private bodyGeo: THREE.BufferGeometry
  private cabGeo: THREE.BufferGeometry
  private glassGeo: THREE.BufferGeometry
  private wheelGeo: THREE.BufferGeometry
  private frontGeo: THREE.BufferGeometry
  private darkMat: THREE.MeshStandardMaterial
  private glassMat: THREE.MeshStandardMaterial
  private wheelMat: THREE.MeshStandardMaterial
  private current: LandsideStats = { trucks: 0, queued: 0, holdingPositions: 0, holding: 0, lods: { lod0: 0, lod1: 0, lod2: 0 }, assets: 'placeholder' }
  private models: TruckModels | null = null
  /** Procedural gate furniture (lane lines, islands, kiosks, canopy, barriers, office, OOG lane); hidden once the phase 2 gate models draw. */
  readonly gatePlaceholder = new THREE.Group()

  constructor(private model: SceneModel) {
    this.group.name = 'landside'
    this.gatePlaceholder.name = 'gate-placeholder'
    this.group.add(this.gatePlaceholder)
    this.darkMat = this.track(new THREE.MeshStandardMaterial({ color: '#30353c', roughness: 0.7, metalness: 0.3 }))
    this.glassMat = this.track(new THREE.MeshStandardMaterial({ color: '#7fb3d5', roughness: 0.2, metalness: 0.4 }))
    this.wheelMat = this.track(new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.9 }))
    this.cabMats = CAB_COLOURS.map((c) => this.track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2 })))
    this.bodyGeo = this.track(this.buildBody())
    this.cabGeo = this.track(this.box(TRUCK.cabX1 - TRUCK.cabX0, TRUCK.cabHeight, TRUCK.width, (TRUCK.cabX0 + TRUCK.cabX1) / 2, 1.2 + TRUCK.cabHeight / 2, 0))
    this.glassGeo = this.track(this.box(0.08, 1.2, TRUCK.width - 0.3, TRUCK.cabX1 + 0.02, 3.1, 0))
    this.wheelGeo = this.track(this.buildWheels(false))
    this.frontGeo = this.track(this.buildWheels(true))
    if (model.landside) this.buildStatic()
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing)
    return thing
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
    return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
  }

  /** Skeletal chassis (two longitudinal beams, cross members, twist-lock pins, landing legs) plus the tractor frame, fifth wheel and bumper. */
  private buildBody(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    const y = TRUCK_DECK_M - 0.25
    const len = TRUCK.couplingX + 0.4 - TRUCK.rearX
    const mid = (TRUCK.couplingX + 0.4 + TRUCK.rearX) / 2
    for (const z of [-0.9, 0.9]) parts.push(this.box(len, 0.32, 0.22, mid, y, z))
    for (let x = TRUCK.rearX + 0.3; x < TRUCK.couplingX; x += 1.5) parts.push(this.box(0.18, 0.2, 2.2, x, y, 0))
    for (const x of [TRUCK.rearX + 0.5, -2.9 + 0.0, 2.9, 5.5])
      for (const z of [-1.0, 1.0]) parts.push(this.box(0.25, 0.14, 0.25, x, TRUCK_DECK_M + 0.07, z)) // twist-lock pins
    parts.push(this.box(0.2, 0.6, 0.2, 3.8, 0.75, -0.9), this.box(0.2, 0.6, 0.2, 3.8, 0.75, 0.9)) // landing legs
    parts.push(this.box(TRUCK.frontX - TRUCK.couplingX + 0.4, 0.4, 1.1, (TRUCK.frontX + TRUCK.couplingX - 0.4) / 2, 1.0, 0)) // tractor frame
    parts.push(this.box(1.6, 0.25, 2.0, TRUCK.couplingX, 1.3, 0)) // fifth wheel
    parts.push(this.box(0.3, 0.5, TRUCK.width, TRUCK.frontX, 0.8, 0)) // bumper
    return mergeGeometries(parts) as THREE.BufferGeometry
  }

  /** Wheels (axis along Z): the front steering pair, or the six trailer and four drive wheels. */
  private buildWheels(front: boolean): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    const wheel = (x: number, z: number) =>
      parts.push(new THREE.CylinderGeometry(TRUCK.wheelRadius, TRUCK.wheelRadius, 0.32, 12).rotateX(Math.PI / 2).translate(x, TRUCK.wheelRadius, z))
    if (front) for (const z of [-1.05, 1.05]) wheel(0, z)
    else {
      for (const x of [-4.6, -3.3, -2.0, 4.6, 5.9]) for (const z of [-1.05, 1.05]) wheel(x, z)
    }
    return mergeGeometries(parts) as THREE.BufferGeometry
  }

  private static readonly FRONT_AXLE_X = 9.6

  /** The phase 2 gate modules draw the gate: hide the procedural gate furniture. */
  useGateModels(): void {
    this.gatePlaceholder.visible = false
  }

  /** The GLB models have loaded: trucks are drawn from them from the next update on. */
  setTruckModels(models: TruckModels): void {
    this.models = models
    for (const meshes of this.trucks.values()) this.group.remove(meshes.group)
    this.trucks.clear() // rebuilt on the next update
  }

  private makeTruck(id: string): TruckMeshes {
    if (this.models) {
      const rig = new TruckRig(this.models, id)
      this.group.add(rig.root)
      return { group: rig.root, rig }
    }
    const group = new THREE.Group()
    group.name = id
    const n = Number(id.slice(1)) || 0
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.Mesh(geo, mat)
      m.castShadow = shadow
      group.add(m)
      return m
    }
    put(this.bodyGeo, this.darkMat)
    put(this.cabGeo, this.cabMats[n % this.cabMats.length])
    put(this.glassGeo, this.glassMat, false)
    put(this.wheelGeo, this.wheelMat)
    const front = put(this.frontGeo, this.wheelMat)
    front.position.x = LandsideScene.FRONT_AXLE_X
    this.group.add(group)
    return { group, front }
  }

  /** Road surfaces, spurs, lane markings, kiosks, canopy, barriers and the out-of-gauge lane. */
  private buildStatic(): void {
    const g = this.model.landside
    if (!g) return
    const asphalt = this.track(new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 0.95 }))
    const line = this.track(new THREE.MeshBasicMaterial({ color: '#e8e8e8' }))
    const yellow = this.track(new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.8 }))
    // static scenery is merged per material (StaticBatch): a handful of draw calls instead of hundreds
    const batch = new StaticBatch()
    const gate = new StaticBatch() // gate furniture: separate so the phase 2 gate models can hide it
    const plane = (w: number, d: number, x: number, z: number, mat: THREE.Material, y: number, shadow = false, into: StaticBatch = batch) => {
      const geo = new THREE.PlaneGeometry(w, d)
      into.add(geo, mat, { x, y, z }, { rotationX: GROUND_ROTATION_X, receiveShadow: shadow })
      geo.dispose()
    }
    const slab = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, into: StaticBatch = batch) => {
      const geo = new THREE.BoxGeometry(w, h, d)
      into.add(geo, mat, { x, y, z }, { castShadow: true })
      geo.dispose()
    }
    const { roadInZ, roadOutZ, eastX, westX, kioskZ, entryZ } = g.gate
    const w = 7
    // inbound (eastbound) and outbound (westbound) roads and the end connector
    const inX0 = g.inLanes[0].x
    plane(eastX - inX0 + w, w, (eastX + inX0) / 2, roadInZ, asphalt, 0.05, true)
    const outX0 = g.outLanes[0].x
    plane(eastX - outX0 + w, w, (eastX + outX0) / 2, roadOutZ, asphalt, 0.05, true)
    plane(w, roadOutZ - roadInZ + w, eastX, (roadInZ + roadOutZ) / 2, asphalt, 0.05, true)
    plane(eastX - inX0, 0.15, (eastX + inX0) / 2, roadInZ, line, 0.06) // centre lines
    plane(eastX - outX0, 0.15, (eastX + outX0) / 2, roadOutZ, line, 0.06)
    // stall spurs
    for (const s of g.stalls) {
      plane(3.6, g.gate.roadInZ - s.z + 1, s.x, (s.z + g.gate.roadInZ) / 2, asphalt, 0.05, true)
      plane(3.6, STALL_LENGTH_M, s.x, s.z, yellow, 0.07)
      plane(3.2, STALL_LENGTH_M - 0.5, s.x, s.z, asphalt, 0.075)
    }
    // holding positions (TT-R16): a spur off the inbound road with a blue-edged bay at its end, well clear of the roads
    const blue = this.track(new THREE.MeshStandardMaterial({ color: '#2e86c1', roughness: 0.8 }))
    for (const h of g.holding) {
      plane(3.6, g.gate.roadInZ - h.z + 1, h.x, (h.z + g.gate.roadInZ) / 2, asphalt, 0.05, true)
      plane(3.6, STALL_LENGTH_M, h.x, h.z, blue, 0.07)
      plane(3.2, STALL_LENGTH_M - 0.5, h.x, h.z, asphalt, 0.075)
      plane(2.4, 0.5, h.x, h.z + STALL_LENGTH_M / 2 - 1.5, blue, 0.08) // stop bar at the end of the bay
    }
    // gate: lane pavement from the roads to the queue, lane lines, kiosks and a canopy over the kiosk row
    const laneW = 3.6 // placeholder lane pitch (the engine pitch is GATE_LANE_W_M plus islands; the placeholder is only an approximation)
    const lanes = [...g.inLanes, ...g.outLanes]
    const x0 = Math.min(...lanes.map((l) => l.x), g.oogX ?? Infinity) - 3 // 3 m: the end islands of the phase 2 gate sit on this pavement
    const x1 = Math.max(...lanes.map((l) => l.x), g.oogX ?? -Infinity) + 3
    const depth = entryZ + 8 - roadInZ
    plane(x1 - x0, depth, (x0 + x1) / 2, roadInZ + depth / 2, asphalt, 0.05, true)
    const inXs = g.inLanes.map((l) => l.x)
    plane(Math.max(...inXs) - Math.min(...inXs) + 4.7, 70, g.gate.queueX, entryZ + 8 + 35, asphalt, 0.05, true) // approach (the queue)
    const edges = [...lanes.map((l) => l.x - laneW / 2), x1]
    if (g.oogX !== null) edges.push(g.oogX - laneW / 2, g.oogX + laneW / 2)
    for (const x of new Set(edges)) plane(0.12, depth, x, roadInZ + depth / 2, line, 0.06, false, gate)
    const red = this.track(new THREE.MeshStandardMaterial({ color: '#b03a2e', roughness: 0.8 }))
    const hatch = this.track(new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.8 }))
    if (g.oogX !== null) {
      plane(laneW - 0.4, depth, g.oogX, roadInZ + depth / 2, red, 0.065, false, gate) // out-of-gauge lane: drawn, never routed
      for (let z = roadOutZ + 2; z < entryZ + 6; z += 4) plane(laneW - 0.4, 1, g.oogX, z, hatch, 0.07, false, gate)
      slab(laneW - 0.6, 1.1, 0.25, g.oogX, 0.6, kioskZ - 3.5, red, gate) // closed barrier
    }
    const concrete = this.track(new THREE.MeshStandardMaterial({ color: '#c9c9c4', roughness: 0.9 }))
    const glass = this.track(new THREE.MeshStandardMaterial({ color: '#7fb3d5', roughness: 0.2, metalness: 0.4 }))
    const arm = this.track(new THREE.MeshStandardMaterial({ color: '#d35400', roughness: 0.6 }))
    const kioskX: number[] = []
    for (let i = 0; i + 1 < lanes.length; i++) {
      if (g.oogX !== null && Math.abs((lanes[i].x + lanes[i + 1].x) / 2 - g.oogX) < laneW) continue
      if (lanes[i].direction !== lanes[i + 1].direction) continue
      kioskX.push((lanes[i].x + lanes[i + 1].x) / 2)
    }
    for (const x of kioskX) {
      slab(1.6, 0.3, 4.5, x, 0.15, kioskZ, concrete, gate) // island
      slab(1.4, 2.6, 3.4, x, 1.6, kioskZ, concrete, gate) // kiosk
      slab(1.46, 0.9, 2.4, x, 2.0, kioskZ, glass, gate)
    }
    for (const l of lanes) slab(laneW - 0.6, 0.15, 0.15, l.x, 1.2, kioskZ - 2.6, arm, gate) // barrier arms
    const width = x1 - x0
    slab(width + 2, 0.5, 12, (x0 + x1) / 2, 6, kioskZ, concrete, gate) // canopy
    for (const x of [x0 - 1, x1 + 1]) for (const dz of [-5, 5]) slab(0.5, 6, 0.5, x, 3, kioskZ + dz, concrete, gate)
    slab(14, 4, 8, westX - 14, 2, kioskZ + 6, concrete, gate) // gatehouse office
    slab(14.2, 1, 0.1, westX - 14, 2.6, kioskZ + 1.95, glass, gate)
    for (const m of batch.build((x) => this.track(x))) this.group.add(m)
    for (const m of gate.build((x) => this.track(x))) this.gatePlaceholder.add(m)
  }

  update(t: number, cameraPosition: THREE.Vector3): void {
    const model = this.model
    let drawn = 0
    let queued = 0
    let holding = 0
    const lods = { lod0: 0, lod1: 0, lod2: 0 }
    const seen = new Set<string>()
    for (const id of model.truckIds) {
      const pose = model.truckPose(id, t)
      let meshes = this.trucks.get(id)
      if (!meshes) {
        meshes = this.makeTruck(id)
        this.trucks.set(id, meshes)
      }
      seen.add(id)
      meshes.group.visible = pose.visible
      if (!pose.visible) continue
      drawn++
      const status = model.statusAt('truck', id, t)
      if (status === 'queued') queued++
      else if (status === 'holding') holding++
      if (meshes.rig) {
        meshes.rig.pose(pose)
        const lod = meshes.rig.chooseLod(Math.hypot(pose.x - cameraPosition.x, cameraPosition.y, pose.z - cameraPosition.z))
        lods[`lod${lod}` as keyof typeof lods]++
        continue
      }
      meshes.group.position.set(pose.x, 0, pose.z)
      meshes.group.rotation.y = pose.yaw
      if (meshes.front) meshes.front.rotation.y = pose.steerRad
    }
    for (const [id, meshes] of this.trucks)
      if (!seen.has(id)) {
        this.group.remove(meshes.group)
        this.trucks.delete(id)
      }
    this.current = { trucks: drawn, queued, holdingPositions: this.model.landside?.holding.length ?? 0, holding, lods, assets: this.models ? 'loaded' : 'placeholder' }
  }

  /** Rig state per truck drawn from the GLB models at the last update (empty until they have loaded). */
  rigStates(): Record<string, TruckRigState> {
    const out: Record<string, TruckRigState> = {}
    for (const [id, m] of this.trucks) if (m.rig && m.group.visible) out[id] = { ...m.rig.rigState }
    return out
  }

  stats(): LandsideStats {
    return { ...this.current }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
