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
  GATE_EXPORT_LANE_POSITION,
  GATE_IMPORT_LANE_POSITION,
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
  // Perimeter fence along the terminal boundary (z = TERMINAL_FENCE_Z)
  const fenceW = TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 })
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7 })

  // Main fence rail
  const railGeo = new THREE.BoxGeometry(fenceW, 0.15, 0.15)
  for (const ry of [1, 2.2]) {
    const rail = new THREE.Mesh(railGeo, fenceMat)
    rail.position.set((TERMINAL_BOUNDS.maxX + TERMINAL_BOUNDS.minX) / 2, ry, TERMINAL_FENCE_Z)
    scene.add(rail)
  }

  // Fence pillars every 8m
  for (let x = TERMINAL_BOUNDS.minX; x <= TERMINAL_BOUNDS.maxX; x += 8) {
    // Skip the gate gap
    if (x > GATE_EXPORT_LANE_POSITION.x - 6 && x < GATE_IMPORT_LANE_POSITION.x + 6) continue
    const pillarGeo = new THREE.BoxGeometry(0.2, 3, 0.2)
    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.set(x, 1.5, TERMINAL_FENCE_Z)
    scene.add(pillar)
  }

  // Left side fence (x = TERMINAL_BOUNDS.minX)
  const sideFenceDepth = TERMINAL_FENCE_Z - 0
  const leftFenceGeo = new THREE.BoxGeometry(0.15, 2.2, sideFenceDepth)
  const leftFence = new THREE.Mesh(leftFenceGeo, fenceMat)
  leftFence.position.set(TERMINAL_BOUNDS.minX, 1.1, sideFenceDepth / 2)
  scene.add(leftFence)

  // Right side fence (x = TERMINAL_BOUNDS.maxX)
  const rightFence = new THREE.Mesh(leftFenceGeo.clone(), fenceMat)
  rightFence.position.set(TERMINAL_BOUNDS.maxX, 1.1, sideFenceDepth / 2)
  scene.add(rightFence)
}

function buildGatehouse(scene: THREE.Scene): void {
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xcc9933, roughness: 0.7 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.6 })

  // IN-gate building (export trucks enter here, on outside of fence)
  const inGateGeo = new THREE.BoxGeometry(3, 3.5, 3)
  const inGate = new THREE.Mesh(inGateGeo, houseMat)
  inGate.position.set(GATE_EXPORT_LANE_POSITION.x, 1.75, TERMINAL_FENCE_Z + 3)
  inGate.castShadow = true
  scene.add(inGate)

  const inRoofGeo = new THREE.BoxGeometry(4, 0.25, 4)
  const inRoof = new THREE.Mesh(inRoofGeo, roofMat)
  inRoof.position.set(GATE_EXPORT_LANE_POSITION.x, 3.65, TERMINAL_FENCE_Z + 3)
  scene.add(inRoof)

  // OUT-gate building (import trucks exit here, on inside of fence)
  const outGateGeo = new THREE.BoxGeometry(3, 3.5, 3)
  const outGate = new THREE.Mesh(outGateGeo, houseMat)
  outGate.position.set(GATE_IMPORT_LANE_POSITION.x, 1.75, TERMINAL_FENCE_Z - 3)
  outGate.castShadow = true
  scene.add(outGate)

  const outRoofGeo = new THREE.BoxGeometry(4, 0.25, 4)
  const outRoof = new THREE.Mesh(outRoofGeo, roofMat)
  outRoof.position.set(GATE_IMPORT_LANE_POSITION.x, 3.65, TERMINAL_FENCE_Z - 3)
  scene.add(outRoof)

  // Barrier poles at both gates
  const barMat = new THREE.MeshStandardMaterial({ color: 0xff6600 })
  const barMat2 = new THREE.MeshStandardMaterial({ color: 0x2980b9 })

  function addBarrier(x: number, z: number, mat: THREE.Material): void {
    const pGeo = new THREE.CylinderGeometry(0.1, 0.1, 3)
    const p = new THREE.Mesh(pGeo, mat)
    p.position.set(x, 1.5, z)
    scene.add(p)
    const bGeo = new THREE.BoxGeometry(3.5, 0.12, 0.12)
    const b = new THREE.Mesh(bGeo, mat)
    b.position.set(x + 1.75, 2.5, z)
    scene.add(b)
  }

  addBarrier(GATE_EXPORT_LANE_POSITION.x - 0.5, TERMINAL_FENCE_Z, barMat)
  addBarrier(GATE_IMPORT_LANE_POSITION.x - 0.5, TERMINAL_FENCE_Z, barMat2)

  // Road markings
  const stripLen = 30
  const exportRoadGeo = new THREE.PlaneGeometry(4, stripLen)
  const exportRoadMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.9, opacity: 0.35, transparent: true })
  const exportRoad = new THREE.Mesh(exportRoadGeo, exportRoadMat)
  exportRoad.rotation.x = -Math.PI / 2
  // Strip extends OUTSIDE (positive z from fence)
  exportRoad.position.set(GATE_EXPORT_LANE_POSITION.x, 0.02, TERMINAL_FENCE_Z + stripLen / 2)
  scene.add(exportRoad)

  const importRoadGeo = new THREE.PlaneGeometry(4, stripLen)
  const importRoadMat = new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.9, opacity: 0.35, transparent: true })
  const importRoad = new THREE.Mesh(importRoadGeo, importRoadMat)
  importRoad.rotation.x = -Math.PI / 2
  // Strip extends INSIDE (negative z from fence)
  importRoad.position.set(GATE_IMPORT_LANE_POSITION.x, 0.02, TERMINAL_FENCE_Z - stripLen / 2)
  scene.add(importRoad)

  // Labels (simple flat signs)
  const signMat = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const inSignGeo = new THREE.BoxGeometry(2, 1, 0.1)
  const inSign = new THREE.Mesh(inSignGeo, signMat)
  inSign.position.set(GATE_EXPORT_LANE_POSITION.x, 4.5, TERMINAL_FENCE_Z + 1)
  scene.add(inSign)

  const outSignGeo = new THREE.BoxGeometry(2, 1, 0.1)
  const outSign = new THREE.Mesh(outSignGeo, signMat)
  outSign.position.set(GATE_IMPORT_LANE_POSITION.x, 4.5, TERMINAL_FENCE_Z - 1)
  scene.add(outSign)
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
