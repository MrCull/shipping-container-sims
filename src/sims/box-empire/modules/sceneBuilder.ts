// ---------------------------------------------------------------------------
// Box Empire — Scene graph construction (inspired by stowage-master quality)
// ---------------------------------------------------------------------------

import type { Position3D } from '../types'
import * as THREE from 'three'
import {
  TERMINAL_BOUNDS,
  TERMINAL_FENCE_Z,
  YARD_BLOCK_POSITION,
  TUTORIAL_YARD,
  CONTAINER_LENGTH,
  CONTAINER_WIDTH,
  CONTAINER_BAY_GAP,
  CONTAINER_ROW_GAP,
  GATE_INGATE_POSITION,
  GATE_OUTGATE_POSITION,
  GATE_OUTGATE_FENCE_Z,
  GATE_OUTGATE_QUEUE_LENGTH,
} from './config'
import { registerOceanMesh, createFoamParticles } from './oceanAnimation'

export function buildScene(scene: THREE.Scene): void {
  buildSkyAndFog(scene)
  buildLighting(scene)
  buildOcean(scene)
  createFoamParticles(scene)
  buildQuay(scene)
  buildGround(scene)
  buildYardMarkings(scene)
  buildGatehouse(scene)
  buildQuayBufferMarkings(scene)
}

function buildSkyAndFog(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x5ba3d9)
  scene.fog = new THREE.FogExp2(0x9dc8e8, 0.003)

  // Sky dome with gradient
  const geo = new THREE.SphereGeometry(480, 32, 16)
  const colors: number[] = []
  const posAttr = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i)
    const t = Math.max(0, Math.min(1, (y + 50) / 500))
    const top = new THREE.Color(0x1a6faf)
    const horizon = new THREE.Color(0xd4e8f5)
    const mid = top.clone().lerp(horizon, 1 - t)
    colors.push(mid.r, mid.g, mid.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })
  scene.add(new THREE.Mesh(geo, mat))
}

function buildLighting(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight(0x9090c0, 0.50)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xfff0cc, 1.75)
  sun.position.set(60, 90, 40)
  sun.castShadow = true
  sun.shadow.mapSize.width = 4096
  sun.shadow.mapSize.height = 4096
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 300
  sun.shadow.camera.left = -120
  sun.shadow.camera.right = 120
  sun.shadow.camera.top = 120
  sun.shadow.camera.bottom = -120
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.02
  scene.add(sun)

  const fill = new THREE.DirectionalLight(0x88aadd, 0.40)
  fill.position.set(-30, 15, -20)
  scene.add(fill)

  const hemi = new THREE.HemisphereLight(0x8ab9e0, 0x7a6040, 0.52)
  scene.add(hemi)

  const rim = new THREE.DirectionalLight(0xffeebb, 0.28)
  rim.position.set(-40, 30, -60)
  scene.add(rim)
}

function buildOcean(scene: THREE.Scene): void {
  // Large ocean plane visible from shore — extends far out to sea (-Z direction)
  const geometry = new THREE.PlaneGeometry(1200, 400, 120, 60)
  const material = new THREE.MeshPhongMaterial({
    color: 0x0d4f6e,
    emissive: 0x052838,
    emissiveIntensity: 0.16,
    specular: 0x88ccee,
    shininess: 150,
    transparent: true,
    opacity: 0.92,
  })
  const ocean = new THREE.Mesh(geometry, material)
  ocean.rotation.x = -Math.PI / 2
  // Centre at z=-80 so it extends from the quay far out to sea
  ocean.position.set(0, -1.5, -80)
  ocean.receiveShadow = true
  ocean.name = 'ocean'
  scene.add(ocean)
  registerOceanMesh(ocean)
}

function buildQuay(scene: THREE.Scene): void {
  const qW = TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX
  // Quay wall (concrete edge facing water)
  const quayGeo = new THREE.BoxGeometry(qW, 2.2, 5)
  const quayMat = new THREE.MeshPhongMaterial({ color: 0x6a6a62, specular: 0x222222, shininess: 10 })
  const quay = new THREE.Mesh(quayGeo, quayMat)
  quay.position.set(0, -1, -2)
  quay.castShadow = true; quay.receiveShadow = true
  scene.add(quay)

  // Yellow safety kerb
  const kerbGeo = new THREE.BoxGeometry(qW, 0.30, 0.55)
  const kerbMat = new THREE.MeshPhongMaterial({ color: 0xeeee33 })
  const kerb = new THREE.Mesh(kerbGeo, kerbMat)
  kerb.position.set(0, 0.72, 0.25)
  scene.add(kerb)

  // Rubber fenders
  const fenderGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.6, 12)
  const fenderMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 55 })
  for (let x = -56; x <= 56; x += 6) {
    const f = new THREE.Mesh(fenderGeo, fenderMat)
    f.rotation.z = Math.PI / 2
    f.position.set(x, 0.2, -0.2)
    f.castShadow = true
    scene.add(f)
  }

  // Bollards
  const bollardBody = new THREE.CylinderGeometry(0.26, 0.36, 1.05, 10)
  const bollardCap = new THREE.SphereGeometry(0.32, 10, 8)
  const bollardMat = new THREE.MeshPhongMaterial({ color: 0x2b2b2b, shininess: 38 })
  for (let x = -55; x <= 55; x += 5.5) {
    const b = new THREE.Mesh(bollardBody, bollardMat)
    b.position.set(x, 0.82, -1.0)
    b.castShadow = true; scene.add(b)
    const c = new THREE.Mesh(bollardCap, bollardMat)
    c.position.set(x, 1.46, -1.0); scene.add(c)
  }

  // Port light poles
  const poleMat = new THREE.MeshPhongMaterial({ color: 0x444444 })
  const lampMat = new THREE.MeshPhongMaterial({ color: 0xfff5aa, emissive: 0xffd700, emissiveIntensity: 1.2 })
  for (let x = -42; x <= 42; x += 14) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.17, 9, 8), poleMat)
    pole.position.set(x, 4.5, -4)
    pole.castShadow = true; scene.add(pole)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), lampMat)
    lamp.position.set(x, 9.5, -4); scene.add(lamp)
  }
}

function buildGround(scene: THREE.Scene): void {
  const width = TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX
  const depth = TERMINAL_BOUNDS.maxZ - 0
  const geo = new THREE.PlaneGeometry(width, depth)
  const mat = new THREE.MeshPhongMaterial({ color: 0x69665d, specular: 0x0b0b0b, shininess: 4 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, -0.01, depth / 2)
  mesh.receiveShadow = true
  scene.add(mesh)
}

function buildYardMarkings(scene: THREE.Scene): void {
  const bayWidth = CONTAINER_LENGTH + CONTAINER_BAY_GAP
  const rowWidth = CONTAINER_WIDTH + CONTAINER_ROW_GAP
  const totalBayWidth = TUTORIAL_YARD.bays * bayWidth
  const totalRowWidth = TUTORIAL_YARD.rows * rowWidth

  // Faded boundary outline
  const outlineGeo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(totalBayWidth + 1.2, 0.02, totalRowWidth + 1.2),
  )
  const outline = new THREE.LineSegments(outlineGeo, new THREE.LineBasicMaterial({ color: 0xa18f49, transparent: true, opacity: 0.55 }))
  outline.position.set(
    YARD_BLOCK_POSITION.x + totalBayWidth / 2 - bayWidth / 2,
    0.03,
    YARD_BLOCK_POSITION.z + totalRowWidth / 2 - rowWidth / 2,
  )
  scene.add(outline)

  // Slot footprints
  const slotMat = new THREE.MeshPhongMaterial({ color: 0x48453f, transparent: true, opacity: 0.92, shininess: 3 })
  for (let bay = 0; bay < TUTORIAL_YARD.bays; bay++) {
    const slotMesh = new THREE.Mesh(new THREE.PlaneGeometry(CONTAINER_LENGTH, CONTAINER_WIDTH), slotMat)
    slotMesh.rotation.x = -Math.PI / 2
    slotMesh.position.set(YARD_BLOCK_POSITION.x + bay * bayWidth, 0.01, YARD_BLOCK_POSITION.z)
    slotMesh.receiveShadow = true
    scene.add(slotMesh)
  }

  // Yard block label strip
  const stripMat = new THREE.MeshPhongMaterial({ color: 0x8a6730, transparent: true, opacity: 0.34 })
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(totalBayWidth + 1, 0.8), stripMat)
  strip.rotation.x = -Math.PI / 2
  strip.position.set(YARD_BLOCK_POSITION.x + totalBayWidth / 2 - bayWidth / 2, 0.02, YARD_BLOCK_POSITION.z - rowWidth / 2 - 0.7)
  scene.add(strip)
}

function buildGatehouse(scene: THREE.Scene): void {
  const boothMat = new THREE.MeshPhongMaterial({ color: 0xe3d3b3, shininess: 16 })
  const trimMat = new THREE.MeshPhongMaterial({ color: 0x40515f, shininess: 24 })
  const canopyMat = new THREE.MeshPhongMaterial({ color: 0x6e7f89, shininess: 18 })
  const curbMat = new THREE.MeshPhongMaterial({ color: 0xd8d0be, shininess: 10 })
  const winMat = new THREE.MeshPhongMaterial({ color: 0x98c4de, emissive: 0x224466, emissiveIntensity: 0.45, transparent: true, opacity: 0.84 })
  const lampMat = new THREE.MeshPhongMaterial({ color: 0xfff2ba, emissive: 0x665500, emissiveIntensity: 0.8 })
  const orangeMat = new THREE.MeshPhongMaterial({ color: 0xf47d20, shininess: 35 })
  const blueMat = new THREE.MeshPhongMaterial({ color: 0x1d62b3, shininess: 35 })
  const stripeLight = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60 })
  const bollardMat = new THREE.MeshPhongMaterial({ color: 0x2e3236, shininess: 40 })
  const fencePostMat = new THREE.MeshPhongMaterial({ color: 0x50504a, shininess: 14 })
  const fenceRailMat = new THREE.MeshPhongMaterial({ color: 0x6c6b64, shininess: 18 })
  const fenceMeshMat = new THREE.MeshBasicMaterial({
    color: 0x8a8c82,
    transparent: true,
    opacity: 0.32,
    wireframe: true,
  })
  const frontFenceZ = TERMINAL_FENCE_Z + CONTAINER_LENGTH * 2

  function addBarrierAcrossLane(name: string, laneX: number, fenceZ: number, mat: THREE.MeshPhongMaterial): void {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.3, 10), trimMat)
    mast.position.set(laneX - 2.65, 1.65, fenceZ)
    mast.castShadow = true
    scene.add(mast)

    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.7), trimMat)
    motor.position.set(laneX - 2.65, 2.6, fenceZ)
    motor.castShadow = true
    scene.add(motor)

    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(laneX - 2.35, 2.65, fenceZ)

    const arm = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.14, 0.16), mat)
    arm.position.x = 2.45
    arm.castShadow = true
    pivot.add(arm)

    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.18), i % 2 === 0 ? stripeLight : mat)
      stripe.position.set(0.5 + i * 0.75, 0, 0)
      pivot.add(stripe)
    }

    const tipLamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lampMat)
    tipLamp.position.set(4.85, 0.02, 0)
    pivot.add(tipLamp)
    scene.add(pivot)
  }

  function addChainLinkFenceRun(
    start: Position3D,
    end: Position3D,
    options: { postSpacing?: number; height?: number } = {},
  ): void {
    const dx = end.x - start.x
    const dz = end.z - start.z
    const runLength = Math.sqrt(dx * dx + dz * dz)
    if (runLength < 0.5) return

    const height = options.height ?? 3.2
    const postSpacing = options.postSpacing ?? 4.8
    const heading = Math.atan2(dx, dz)
    const midX = (start.x + end.x) / 2
    const midZ = (start.z + end.z) / 2

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(runLength, height, Math.max(1, Math.floor(runLength * 2)), 10),
      fenceMeshMat,
    )
    mesh.position.set(midX, height / 2, midZ)
    mesh.rotation.y = heading + Math.PI / 2
    scene.add(mesh)

    const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, runLength, 8), fenceRailMat)
    topRail.rotation.z = Math.PI / 2
    topRail.rotation.y = heading + Math.PI / 2
    topRail.position.set(midX, height - 0.12, midZ)
    topRail.castShadow = true
    scene.add(topRail)

    const bottomRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, runLength, 8), fenceRailMat)
    bottomRail.rotation.z = Math.PI / 2
    bottomRail.rotation.y = heading + Math.PI / 2
    bottomRail.position.set(midX, 0.28, midZ)
    bottomRail.castShadow = true
    scene.add(bottomRail)

    const postCount = Math.max(2, Math.floor(runLength / postSpacing) + 1)
    for (let i = 0; i <= postCount; i++) {
      const t = i / postCount
      const px = start.x + dx * t
      const pz = start.z + dz * t
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, height, 8), fencePostMat)
      post.position.set(px, height / 2, pz)
      post.castShadow = true
      scene.add(post)

      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), fenceRailMat)
      cap.position.set(px, height + 0.04, pz)
      scene.add(cap)
    }
  }

  interface GatehouseBuildingOptions {
    facing?: 1 | -1
    includeCanopyPosts?: boolean
    includeBollards?: boolean
    includeRoofLamps?: boolean
    includeSignPlate?: boolean
  }

  function addBuilding(
    x: number,
    z: number,
    accentMat: THREE.MeshPhongMaterial,
    selectName: string,
    options: GatehouseBuildingOptions = {},
  ): void {
    const facing = options.facing ?? 1
    const includeCanopyPosts = options.includeCanopyPosts ?? true
    const includeBollards = options.includeBollards ?? true
    const includeRoofLamps = options.includeRoofLamps ?? true
    const includeSignPlate = options.includeSignPlate ?? true

    const island = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.28, 8), curbMat)
    island.name = selectName
    island.position.set(x + 0.4, 0.14, z)
    island.receiveShadow = true
    scene.add(island)

    const booth = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.6, 4.8), boothMat)
    booth.name = selectName
    booth.position.set(x, 1.8, z)
    booth.castShadow = true
    scene.add(booth)

    const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.36, 5.1), trimMat)
    baseTrim.name = selectName
    baseTrim.position.set(x, 0.2, z)
    scene.add(baseTrim)

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.34, 6.4), canopyMat)
    canopy.name = selectName
    canopy.position.set(x + 1.4, 4.35, z)
    canopy.castShadow = true
    scene.add(canopy)

    if (includeCanopyPosts) {
      for (const px of [x - 2.1, x + 4.1]) {
        for (const pz of [z - 2.4, z + 2.4]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.0, 0.22), trimMat)
          post.name = selectName
          post.position.set(px, 2.0, pz)
          post.castShadow = true
          scene.add(post)
        }
      }
    }

    const fascia = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.52, 0.18), accentMat)
    fascia.name = selectName
    fascia.position.set(x + 1.58, 3.65, z + facing * 2.33)
    scene.add(fascia)

    const frontWin = new THREE.Mesh(new THREE.BoxGeometry(2.75, 1.5, 0.07), winMat)
    frontWin.name = selectName
    frontWin.position.set(x, 2.2, z + facing * 2.43)
    scene.add(frontWin)

    for (const sx of [-1, 1]) {
      const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.4, 2.1), winMat)
      sideWin.name = selectName
      sideWin.position.set(x + sx * 1.83, 2.2, z)
      scene.add(sideWin)
    }

    if (includeSignPlate) {
      const signPlate = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.7, 0.08), trimMat)
      signPlate.name = selectName
      signPlate.position.set(x + 1.55, 3.65, z + facing * 2.46)
      scene.add(signPlate)
    }

    const laneMark = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 10.5), new THREE.MeshPhongMaterial({
      color: accentMat === orangeMat ? 0xf39c12 : 0x3d84d6,
      transparent: true,
      opacity: 0.22,
    }))
    laneMark.name = selectName
    laneMark.rotation.x = -Math.PI / 2
    laneMark.position.set(x + 4.15, 0.03, z)
    scene.add(laneMark)

    if (includeBollards) {
      for (const bx of [x + 2.95, x + 5.3]) {
        for (const bz of [z - 2.6, z + 2.6]) {
          const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.0, 10), bollardMat)
          bollard.name = selectName
          bollard.position.set(bx, 0.5, bz)
          bollard.castShadow = true
          scene.add(bollard)
        }
      }
    }

    if (includeRoofLamps) {
      const roofLampLeft = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.14), lampMat)
      roofLampLeft.name = selectName
      roofLampLeft.position.set(x - 1.4, 4.2, z + facing * 2.15)
      scene.add(roofLampLeft)
      const roofLampRight = roofLampLeft.clone()
      roofLampRight.position.x = x + 4.2
      scene.add(roofLampRight)
    }
  }

  // ---- IN-GATE (at TERMINAL_FENCE_Z) ----
  // Lane is at x=GATE_INGATE_POSITION.x; gatehouse building is beside it at x-4
  const inBuildX = GATE_INGATE_POSITION.x - 5
  addBuilding(inBuildX, TERMINAL_FENCE_Z + 2, orangeMat, 'gatehouse-ingate', {
    facing: -1,
    includeCanopyPosts: false,
    includeBollards: false,
  })
  addBarrierAcrossLane('ingate-barrier', GATE_INGATE_POSITION.x, TERMINAL_FENCE_Z - CONTAINER_LENGTH * 0.5, orangeMat)
  addChainLinkFenceRun(
    { x: GATE_INGATE_POSITION.x + 3.2, y: 0, z: frontFenceZ },
    { x: GATE_OUTGATE_POSITION.x - 2.6, y: 0, z: frontFenceZ },
  )

  // Queue lane strip outside terminal (parallel to fence, along Z)
  const queueLen = 60
  const inQueueStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(3, queueLen),
    new THREE.MeshPhongMaterial({ color: 0xff6600, transparent: true, opacity: 0.28 }),
  )
  inQueueStrip.rotation.x = -Math.PI / 2
  inQueueStrip.position.set(GATE_INGATE_POSITION.x, 0.02, TERMINAL_FENCE_Z + queueLen / 2)
  scene.add(inQueueStrip)

  // ---- OUT-GATE (right fence at +X) ----
  // Same footprint as in-gate but on maxX: long axis ∥ Z (fence), trucks exit +Z (landward, away from berth)
  const outBuildX = GATE_OUTGATE_POSITION.x + 5.1
  const outBuildZ = GATE_OUTGATE_POSITION.z - 5
  addBuilding(outBuildX, outBuildZ, blueMat, 'gatehouse-outgate', {
    facing: 1,
    includeCanopyPosts: false,
    includeBollards: false,
    includeRoofLamps: false,
    includeSignPlate: false,
  })
  addBarrierAcrossLane('outgate-barrier', GATE_OUTGATE_POSITION.x, GATE_OUTGATE_FENCE_Z, blueMat)

  // Queue inside terminal (hold positions are z < boom; then trucks exit +Z through boom)
  const outQueueLen = GATE_OUTGATE_QUEUE_LENGTH
  const outQueueStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(3, outQueueLen),
    new THREE.MeshPhongMaterial({ color: 0x2266cc, transparent: true, opacity: 0.28 }),
  )
  outQueueStrip.rotation.x = -Math.PI / 2
  outQueueStrip.position.set(
    GATE_OUTGATE_POSITION.x,
    0.02,
    GATE_OUTGATE_FENCE_Z - outQueueLen / 2,
  )
  scene.add(outQueueStrip)

  // In-gate internal connector strip
  const internalRoadLen = GATE_OUTGATE_FENCE_Z - TERMINAL_FENCE_Z
  const internalRoadMat = new THREE.MeshPhongMaterial({ color: 0x606060, transparent: true, opacity: 0.45 })
  const internalRoadL = new THREE.Mesh(new THREE.PlaneGeometry(4, internalRoadLen), internalRoadMat)
  internalRoadL.rotation.x = -Math.PI / 2
  internalRoadL.position.set(GATE_INGATE_POSITION.x, 0.02, TERMINAL_FENCE_Z + internalRoadLen / 2)
  scene.add(internalRoadL)
}

function buildQuayBufferMarkings(scene: THREE.Scene): void {
  const laneMat = new THREE.MeshPhongMaterial({ color: 0x2d3436, transparent: true, opacity: 0.22 })
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX, CONTAINER_WIDTH + 1.2),
    laneMat,
  )
  lane.rotation.x = -Math.PI / 2
  lane.position.set(0, 0.015, 3)
  scene.add(lane)
}
