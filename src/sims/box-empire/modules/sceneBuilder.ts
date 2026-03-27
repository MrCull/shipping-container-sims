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
  const houseGeo = new THREE.BoxGeometry(6, 4, 3)
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xcc9933, roughness: 0.7 })
  const house = new THREE.Mesh(houseGeo, houseMat)
  house.position.set(-40, 2, 50)
  house.castShadow = true
  scene.add(house)

  const roofGeo = new THREE.BoxGeometry(7, 0.3, 4)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.6 })
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.position.set(-40, 4.15, 50)
  roof.castShadow = true
  scene.add(roof)

  const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 3)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xff0000 })
  const pole = new THREE.Mesh(poleGeo, poleMat)
  pole.position.set(-37, 1.5, 50)
  scene.add(pole)
}
