// ---------------------------------------------------------------------------
// Box Empire — Three.js scene graph construction
// ---------------------------------------------------------------------------

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
  QUAY_BUFFER_DISCHARGE_POSITION,
  QUAY_BUFFER_LOAD_POSITION,
  GATE_INGATE_POSITION,
  GATE_OUTGATE_POSITION,
} from './config'

export function buildScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x87ceeb)
  scene.fog = new THREE.Fog(0x87ceeb, 200, 500)

  buildLighting(scene)
  buildGround(scene)
  buildWater(scene)
  buildQuay(scene)
  buildYardMarkings(scene)
  buildTerminalBoundary(scene)
  buildGatehouse(scene)
  buildQuayBufferMarkings(scene)
}

function buildLighting(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xfff5e6, 1.2)
  sun.position.set(50, 80, 30)
  sun.castShadow = true
  sun.shadow.mapSize.width = 2048
  sun.shadow.mapSize.height = 2048
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 200
  sun.shadow.camera.left = -80
  sun.shadow.camera.right = 80
  sun.shadow.camera.top = 80
  sun.shadow.camera.bottom = -80
  scene.add(sun)

  const fill = new THREE.DirectionalLight(0x8ecbff, 0.3)
  fill.position.set(-30, 40, -20)
  scene.add(fill)
}

function buildGround(scene: THREE.Scene): void {
  const width = TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX
  const depth = TERMINAL_BOUNDS.maxZ
  const geo = new THREE.PlaneGeometry(width, depth)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x808080,
    roughness: 0.9,
    metalness: 0.0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, -0.01, depth / 2)
  mesh.receiveShadow = true
  scene.add(mesh)
}

function buildWater(scene: THREE.Scene): void {
  const width = TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX + 100
  const depth = 80
  const geo = new THREE.PlaneGeometry(width, depth)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a6b8a,
    roughness: 0.3,
    metalness: 0.2,
    transparent: true,
    opacity: 0.85,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, -0.5, -depth / 2)
  mesh.receiveShadow = true
  scene.add(mesh)
}

function buildQuay(scene: THREE.Scene): void {
  const geo = new THREE.BoxGeometry(
    TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX,
    2,
    4,
  )
  const mat = new THREE.MeshStandardMaterial({
    color: 0x606060,
    roughness: 0.85,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(0, -1, 0)
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
}

function buildYardMarkings(scene: THREE.Scene): void {
  const bayWidth = CONTAINER_LENGTH + CONTAINER_BAY_GAP
  const rowWidth = CONTAINER_WIDTH + CONTAINER_ROW_GAP
  const totalBayWidth = TUTORIAL_YARD.bays * bayWidth
  const totalRowWidth = TUTORIAL_YARD.rows * rowWidth

  const outlineGeo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(totalBayWidth + 1, 0.02, totalRowWidth + 1),
  )
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xffff00 })
  const outline = new THREE.LineSegments(outlineGeo, outlineMat)
  outline.position.set(
    YARD_BLOCK_POSITION.x + totalBayWidth / 2 - bayWidth / 2,
    0.02,
    YARD_BLOCK_POSITION.z + totalRowWidth / 2 - rowWidth / 2,
  )
  scene.add(outline)

  for (let bay = 0; bay < TUTORIAL_YARD.bays; bay++) {
    const slotGeo = new THREE.PlaneGeometry(CONTAINER_LENGTH, CONTAINER_WIDTH)
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x505050,
      roughness: 0.95,
    })
    const slotMesh = new THREE.Mesh(slotGeo, slotMat)
    slotMesh.rotation.x = -Math.PI / 2
    slotMesh.position.set(
      YARD_BLOCK_POSITION.x + bay * bayWidth,
      0.01,
      YARD_BLOCK_POSITION.z,
    )
    slotMesh.receiveShadow = true
    scene.add(slotMesh)
  }
}

function buildTerminalBoundary(scene: THREE.Scene): void {
  const fenceW = TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 })
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7 })

  // Front fence (z = TERMINAL_FENCE_Z) with gap at in-gate
  const railGeo = new THREE.BoxGeometry(fenceW, 0.15, 0.15)
  for (const ry of [1, 2.2]) {
    const rail = new THREE.Mesh(railGeo, fenceMat)
    rail.position.set((TERMINAL_BOUNDS.maxX + TERMINAL_BOUNDS.minX) / 2, ry, TERMINAL_FENCE_Z)
    scene.add(rail)
  }

  for (let x = TERMINAL_BOUNDS.minX; x <= TERMINAL_BOUNDS.maxX; x += 8) {
    // Leave gap at in-gate
    if (Math.abs(x - GATE_INGATE_POSITION.x) < 6) continue
    const pillarGeo = new THREE.BoxGeometry(0.2, 3, 0.2)
    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.set(x, 1.5, TERMINAL_FENCE_Z)
    scene.add(pillar)
  }

  // Left side fence
  const sideFenceDepth = TERMINAL_FENCE_Z
  const leftFenceGeo = new THREE.BoxGeometry(0.15, 2.2, sideFenceDepth)
  const leftFence = new THREE.Mesh(leftFenceGeo, fenceMat)
  leftFence.position.set(TERMINAL_BOUNDS.minX, 1.1, sideFenceDepth / 2)
  scene.add(leftFence)

  const rightFence = new THREE.Mesh(leftFenceGeo.clone(), fenceMat)
  rightFence.position.set(TERMINAL_BOUNDS.maxX, 1.1, sideFenceDepth / 2)
  scene.add(rightFence)
}

function buildGatehouse(scene: THREE.Scene): void {
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xcc9933, roughness: 0.7 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.6 })
  const barMat = new THREE.MeshStandardMaterial({ color: 0xff6600 })
  const barMat2 = new THREE.MeshStandardMaterial({ color: 0x2980b9 })

  function addBarrier(x: number, z: number, mat: THREE.Material): void {
    const pGeo = new THREE.CylinderGeometry(0.1, 0.1, 3)
    const p = new THREE.Mesh(pGeo, mat)
    p.position.set(x, 1.5, z)
    scene.add(p)
    const bGeo = new THREE.BoxGeometry(4, 0.12, 0.12)
    const b = new THREE.Mesh(bGeo, mat)
    b.position.set(x + 2, 2.6, z)
    scene.add(b)
  }

  function addGatehouseBuilding(x: number, z: number, label: string): void {
    void label
    const geo = new THREE.BoxGeometry(3, 3.5, 3)
    const m = new THREE.Mesh(geo, houseMat)
    m.position.set(x, 1.75, z)
    m.castShadow = true
    scene.add(m)
    const rGeo = new THREE.BoxGeometry(4, 0.25, 4)
    const r = new THREE.Mesh(rGeo, roofMat)
    r.position.set(x, 3.65, z)
    scene.add(r)
  }

  // IN-GATE: at TERMINAL_FENCE_Z, outside the terminal
  addGatehouseBuilding(GATE_INGATE_POSITION.x, TERMINAL_FENCE_Z + 3, 'IN')
  addBarrier(GATE_INGATE_POSITION.x - 0.5, TERMINAL_FENCE_Z, barMat)

  // Road strip leading into in-gate from outside
  const inStripGeo = new THREE.PlaneGeometry(5, 35)
  const inStripMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.9, opacity: 0.35, transparent: true })
  const inStrip = new THREE.Mesh(inStripGeo, inStripMat)
  inStrip.rotation.x = -Math.PI / 2
  inStrip.position.set(GATE_INGATE_POSITION.x, 0.02, TERMINAL_FENCE_Z + 17)
  scene.add(inStrip)

  // OUT-GATE: at bottom of terminal (GATE_OUTGATE_POSITION.z)
  addGatehouseBuilding(GATE_OUTGATE_POSITION.x, GATE_OUTGATE_POSITION.z - 3, 'OUT')
  addBarrier(GATE_OUTGATE_POSITION.x - 0.5, GATE_OUTGATE_POSITION.z, barMat2)

  // Road strip leading out from out-gate
  const outStripGeo = new THREE.PlaneGeometry(5, 35)
  const outStripMat = new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.9, opacity: 0.35, transparent: true })
  const outStrip = new THREE.Mesh(outStripGeo, outStripMat)
  outStrip.rotation.x = -Math.PI / 2
  outStrip.position.set(GATE_OUTGATE_POSITION.x, 0.02, GATE_OUTGATE_POSITION.z + 17)
  scene.add(outStrip)

  // Road connecting in-gate to yard area (inside terminal)
  const internalRoadGeo = new THREE.PlaneGeometry(5, GATE_OUTGATE_POSITION.z - TERMINAL_FENCE_Z)
  const internalRoadMat = new THREE.MeshStandardMaterial({ color: 0x606060, roughness: 0.95, opacity: 0.5, transparent: true })
  const internalRoad = new THREE.Mesh(internalRoadGeo, internalRoadMat)
  internalRoad.rotation.x = -Math.PI / 2
  internalRoad.position.set(
    GATE_INGATE_POSITION.x,
    0.02,
    TERMINAL_FENCE_Z + (GATE_OUTGATE_POSITION.z - TERMINAL_FENCE_Z) / 2,
  )
  scene.add(internalRoad)
}

function buildQuayBufferMarkings(scene: THREE.Scene): void {
  // Discharge buffer zone (blue)
  const dischargeGeo = new THREE.PlaneGeometry(CONTAINER_LENGTH + 0.5, CONTAINER_WIDTH + 0.5)
  const dischargeMat = new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.9, opacity: 0.6, transparent: true })
  const discharge = new THREE.Mesh(dischargeGeo, dischargeMat)
  discharge.rotation.x = -Math.PI / 2
  discharge.position.set(QUAY_BUFFER_DISCHARGE_POSITION.x, 0.02, QUAY_BUFFER_DISCHARGE_POSITION.z)
  scene.add(discharge)

  // Load buffer zone (orange)
  const loadGeo = new THREE.PlaneGeometry(CONTAINER_LENGTH + 0.5, CONTAINER_WIDTH + 0.5)
  const loadMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.9, opacity: 0.6, transparent: true })
  const load = new THREE.Mesh(loadGeo, loadMat)
  load.rotation.x = -Math.PI / 2
  load.position.set(QUAY_BUFFER_LOAD_POSITION.x, 0.02, QUAY_BUFFER_LOAD_POSITION.z)
  scene.add(load)
}
