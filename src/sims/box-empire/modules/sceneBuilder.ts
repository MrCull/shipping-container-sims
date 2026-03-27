// ---------------------------------------------------------------------------
// Box Empire — Three.js scene graph construction
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import {
  TERMINAL_BOUNDS,
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
  scene.fog = new THREE.Fog(0x87ceeb, 150, 350)

  buildLighting(scene)
  buildGround(scene)
  buildWater(scene)
  buildQuay(scene)
  buildYardMarkings(scene)
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

function buildGatehouse(scene: THREE.Scene): void {
  // Gatehouse building between the two lanes
  const houseGeo = new THREE.BoxGeometry(4, 4, 3)
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xcc9933, roughness: 0.7 })
  const house = new THREE.Mesh(houseGeo, houseMat)
  house.position.set(-40, 2, 50)
  house.castShadow = true
  scene.add(house)

  const roofGeo = new THREE.BoxGeometry(5, 0.3, 4)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.6 })
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.position.set(-40, 4.15, 50)
  roof.castShadow = true
  scene.add(roof)

  // Export lane barrier pole (orange)
  const exportPoleGeo = new THREE.CylinderGeometry(0.1, 0.1, 3)
  const exportPoleMat = new THREE.MeshStandardMaterial({ color: 0xff6600 })
  const exportPole = new THREE.Mesh(exportPoleGeo, exportPoleMat)
  exportPole.position.set(GATE_EXPORT_LANE_POSITION.x, 1.5, GATE_EXPORT_LANE_POSITION.z)
  scene.add(exportPole)

  // Import lane barrier pole (blue)
  const importPoleGeo = new THREE.CylinderGeometry(0.1, 0.1, 3)
  const importPoleMat = new THREE.MeshStandardMaterial({ color: 0x2980b9 })
  const importPole = new THREE.Mesh(importPoleGeo, importPoleMat)
  importPole.position.set(GATE_IMPORT_LANE_POSITION.x, 1.5, GATE_IMPORT_LANE_POSITION.z)
  scene.add(importPole)

  // Road marking for export lane (orange strip)
  const exportRoadGeo = new THREE.PlaneGeometry(2, 20)
  const exportRoadMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.9, opacity: 0.5, transparent: true })
  const exportRoad = new THREE.Mesh(exportRoadGeo, exportRoadMat)
  exportRoad.rotation.x = -Math.PI / 2
  exportRoad.position.set(GATE_EXPORT_LANE_POSITION.x, 0.02, GATE_EXPORT_LANE_POSITION.z - 10)
  scene.add(exportRoad)

  // Road marking for import lane (blue strip)
  const importRoadGeo = new THREE.PlaneGeometry(2, 20)
  const importRoadMat = new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.9, opacity: 0.5, transparent: true })
  const importRoad = new THREE.Mesh(importRoadGeo, importRoadMat)
  importRoad.rotation.x = -Math.PI / 2
  importRoad.position.set(GATE_IMPORT_LANE_POSITION.x, 0.02, GATE_IMPORT_LANE_POSITION.z - 10)
  scene.add(importRoad)
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
