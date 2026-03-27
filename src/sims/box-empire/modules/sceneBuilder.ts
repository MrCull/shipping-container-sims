// ---------------------------------------------------------------------------
// Box Empire — Scene graph construction (inspired by stowage-master quality)
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

// Ocean mesh stored for animation
let oceanMesh: THREE.Mesh | null = null

export function getOcean(): THREE.Mesh | null { return oceanMesh }

export function animateOcean(time: number): void {
  if (!oceanMesh) return
  const pos = oceanMesh.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const wave =
      Math.sin(x * 0.04 + time * 0.7) * 0.40 +
      Math.cos(z * 0.05 + time * 0.55) * 0.28 +
      Math.sin(x * 0.09 - z * 0.06 + time * 1.1) * 0.16
    pos.setY(i, wave)
  }
  pos.needsUpdate = true
  oceanMesh.geometry.computeVertexNormals()
}

export function buildScene(scene: THREE.Scene): void {
  buildSkyAndFog(scene)
  buildLighting(scene)
  buildOcean(scene)
  buildQuay(scene)
  buildGround(scene)
  buildYardMarkings(scene)
  buildTerminalBoundary(scene)
  buildGatehouse(scene)
  buildQuayBufferMarkings(scene)
  buildTerminalBuildings(scene)
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
  const geometry = new THREE.PlaneGeometry(800, 200, 100, 50)
  const material = new THREE.MeshPhongMaterial({
    color: 0x0d4f6e,
    emissive: 0x052838,
    emissiveIntensity: 0.14,
    specular: 0xaaddff,
    shininess: 160,
    transparent: true,
    opacity: 0.88,
  })
  const ocean = new THREE.Mesh(geometry, material)
  ocean.rotation.x = -Math.PI / 2
  ocean.position.set(0, -0.5, -50)
  ocean.receiveShadow = true
  ocean.name = 'ocean'
  scene.add(ocean)
  oceanMesh = ocean
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
  const mat = new THREE.MeshPhongMaterial({ color: 0x787870, specular: 0x111111, shininess: 6 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, -0.01, depth / 2)
  mesh.receiveShadow = true
  scene.add(mesh)

  // Road lane lines
  const lineMat = new THREE.MeshPhongMaterial({ color: 0xd0c060, transparent: true, opacity: 0.5 })
  for (let x = TERMINAL_BOUNDS.minX + 8; x < TERMINAL_BOUNDS.maxX; x += 16) {
    const roadLine = new THREE.Mesh(new THREE.PlaneGeometry(0.25, depth), lineMat)
    roadLine.rotation.x = -Math.PI / 2
    roadLine.position.set(x, 0.01, depth / 2)
    scene.add(roadLine)
  }
}

function buildYardMarkings(scene: THREE.Scene): void {
  const bayWidth = CONTAINER_LENGTH + CONTAINER_BAY_GAP
  const rowWidth = CONTAINER_WIDTH + CONTAINER_ROW_GAP
  const totalBayWidth = TUTORIAL_YARD.bays * bayWidth
  const totalRowWidth = TUTORIAL_YARD.rows * rowWidth

  // Yellow outline
  const outlineGeo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(totalBayWidth + 1.2, 0.02, totalRowWidth + 1.2),
  )
  const outline = new THREE.LineSegments(outlineGeo, new THREE.LineBasicMaterial({ color: 0xffee00 }))
  outline.position.set(
    YARD_BLOCK_POSITION.x + totalBayWidth / 2 - bayWidth / 2,
    0.03,
    YARD_BLOCK_POSITION.z + totalRowWidth / 2 - rowWidth / 2,
  )
  scene.add(outline)

  // Slot footprints
  const slotMat = new THREE.MeshPhongMaterial({ color: 0x454540, shininess: 5 })
  for (let bay = 0; bay < TUTORIAL_YARD.bays; bay++) {
    const slotMesh = new THREE.Mesh(new THREE.PlaneGeometry(CONTAINER_LENGTH, CONTAINER_WIDTH), slotMat)
    slotMesh.rotation.x = -Math.PI / 2
    slotMesh.position.set(YARD_BLOCK_POSITION.x + bay * bayWidth, 0.01, YARD_BLOCK_POSITION.z)
    slotMesh.receiveShadow = true
    scene.add(slotMesh)
  }

  // Yard block label strip
  const stripMat = new THREE.MeshPhongMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 })
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(totalBayWidth + 1, 0.8), stripMat)
  strip.rotation.x = -Math.PI / 2
  strip.position.set(YARD_BLOCK_POSITION.x + totalBayWidth / 2 - bayWidth / 2, 0.02, YARD_BLOCK_POSITION.z - rowWidth / 2 - 0.7)
  scene.add(strip)
}

function buildTerminalBoundary(scene: THREE.Scene): void {
  const fenceW = TERMINAL_BOUNDS.maxX - TERMINAL_BOUNDS.minX
  const fenceMat = new THREE.MeshPhongMaterial({ color: 0x999999, shininess: 15 })
  const pillarMat = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 10 })

  // Front fence rails at z=TERMINAL_FENCE_Z
  for (const ry of [0.9, 2.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(fenceW, 0.14, 0.14), fenceMat)
    rail.position.set((TERMINAL_BOUNDS.maxX + TERMINAL_BOUNDS.minX) / 2, ry, TERMINAL_FENCE_Z)
    scene.add(rail)
  }

  // Pillars with gap at in-gate
  for (let x = TERMINAL_BOUNDS.minX; x <= TERMINAL_BOUNDS.maxX; x += 8) {
    if (Math.abs(x - GATE_INGATE_POSITION.x) < 6) continue
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3, 0.18), pillarMat)
    pillar.position.set(x, 1.5, TERMINAL_FENCE_Z)
    pillar.castShadow = true; scene.add(pillar)
  }

  // Side fences (Z-running)
  const sideFenceD = TERMINAL_FENCE_Z
  for (const xPos of [TERMINAL_BOUNDS.minX, TERMINAL_BOUNDS.maxX]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, sideFenceD), fenceMat)
    side.position.set(xPos, 1.1, sideFenceD / 2)
    scene.add(side)
  }
}

function buildGatehouse(scene: THREE.Scene): void {
  const houseMat = new THREE.MeshPhongMaterial({ color: 0xcc9933, shininess: 12 })
  const roofMat  = new THREE.MeshPhongMaterial({ color: 0x8b4513, shininess: 10 })
  const barMat   = new THREE.MeshPhongMaterial({ color: 0xff5500 })
  const barMat2  = new THREE.MeshPhongMaterial({ color: 0x1166cc })

  function addBarrier(x: number, z: number, mat: THREE.Material): void {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 3), mat)
    p.position.set(x, 1.5, z); scene.add(p)
    const b = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 0.12), mat)
    b.position.set(x + 2.25, 2.65, z); scene.add(b)
  }

  function addBuilding(x: number, z: number): void {
    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3.5, 4), houseMat)
    body.position.set(x, 1.75, z); body.castShadow = true; scene.add(body)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 4.6), roofMat)
    roof.position.set(x, 3.66, z); scene.add(roof)
    // Window
    const winMat = new THREE.MeshPhongMaterial({ color: 0x88aacc, emissive: 0x224466, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 })
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 2.4), winMat)
    win.position.set(x + 1.55, 2.0, z); scene.add(win)
  }

  // IN-GATE: at fence (z=TERMINAL_FENCE_Z), outside terminal
  addBuilding(GATE_INGATE_POSITION.x, TERMINAL_FENCE_Z + 3.5)
  addBarrier(GATE_INGATE_POSITION.x - 0.5, TERMINAL_FENCE_Z, barMat)

  // IN-GATE road approach strip (orange, outside terminal)
  const inStrip = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 40), new THREE.MeshPhongMaterial({ color: 0xff6600, transparent: true, opacity: 0.30 }))
  inStrip.rotation.x = -Math.PI / 2
  inStrip.position.set(GATE_INGATE_POSITION.x, 0.02, TERMINAL_FENCE_Z + 20)
  scene.add(inStrip)

  // OUT-GATE: at bottom of terminal (z=GATE_OUTGATE_POSITION.z)
  addBuilding(GATE_OUTGATE_POSITION.x, GATE_OUTGATE_POSITION.z - 3.5)
  addBarrier(GATE_OUTGATE_POSITION.x - 0.5, GATE_OUTGATE_POSITION.z, barMat2)

  // OUT-GATE road exit strip (blue, outside out-gate)
  const outStrip = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 40), new THREE.MeshPhongMaterial({ color: 0x2266cc, transparent: true, opacity: 0.30 }))
  outStrip.rotation.x = -Math.PI / 2
  outStrip.position.set(GATE_OUTGATE_POSITION.x, 0.02, GATE_OUTGATE_POSITION.z + 20)
  scene.add(outStrip)

  // Internal road connecting in-gate to yard area
  const roadLen = GATE_OUTGATE_POSITION.z - TERMINAL_FENCE_Z
  const road = new THREE.Mesh(new THREE.PlaneGeometry(5.5, roadLen), new THREE.MeshPhongMaterial({ color: 0x606060, transparent: true, opacity: 0.50 }))
  road.rotation.x = -Math.PI / 2
  road.position.set(GATE_INGATE_POSITION.x, 0.02, TERMINAL_FENCE_Z + roadLen / 2)
  scene.add(road)
}

function buildQuayBufferMarkings(scene: THREE.Scene): void {
  // Discharge buffer (blue)
  const dischMat = new THREE.MeshPhongMaterial({ color: 0x2980b9, transparent: true, opacity: 0.55 })
  const disch = new THREE.Mesh(new THREE.PlaneGeometry(CONTAINER_LENGTH + 0.6, CONTAINER_WIDTH + 0.6), dischMat)
  disch.rotation.x = -Math.PI / 2
  disch.position.set(QUAY_BUFFER_DISCHARGE_POSITION.x, 0.02, QUAY_BUFFER_DISCHARGE_POSITION.z)
  scene.add(disch)

  // Load buffer (orange)
  const loadMat = new THREE.MeshPhongMaterial({ color: 0xff6600, transparent: true, opacity: 0.55 })
  const load = new THREE.Mesh(new THREE.PlaneGeometry(CONTAINER_LENGTH + 0.6, CONTAINER_WIDTH + 0.6), loadMat)
  load.rotation.x = -Math.PI / 2
  load.position.set(QUAY_BUFFER_LOAD_POSITION.x, 0.02, QUAY_BUFFER_LOAD_POSITION.z)
  scene.add(load)
}

function buildTerminalBuildings(scene: THREE.Scene): void {
  // Terminal operations building (back of yard)
  const bldgMat = new THREE.MeshPhongMaterial({ color: 0xc0b8a8, shininess: 8 })
  const roofMat = new THREE.MeshPhongMaterial({ color: 0x8090a0, shininess: 5 })

  const bldg = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 10), bldgMat)
  bldg.position.set(35, 4, 12); bldg.castShadow = true; bldg.receiveShadow = true
  scene.add(bldg)

  const shed = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 14), roofMat)
  shed.position.set(-45, 2.5, 12); shed.castShadow = true
  scene.add(shed)

  // Window strip
  const winMat = new THREE.MeshPhongMaterial({ color: 0x88aacc, emissive: 0x224466, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 })
  for (let i = -2; i <= 2; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 0.1), winMat)
    win.position.set(35 + i * 4, 5.5, 7.1); scene.add(win)
  }
}
