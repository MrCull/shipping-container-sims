import * as THREE from 'three'

// Build gradient sky using a large sphere with vertex colors
export function createSkybox(scene: THREE.Scene): void {
  // Deep ocean-horizon gradient sky
  scene.background = new THREE.Color(0x5ba3d9)
  scene.fog = new THREE.FogExp2(0x9dc8e8, 0.004)
}

export function createSkyDome(scene: THREE.Scene): THREE.Mesh {
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
  const dome = new THREE.Mesh(geo, mat)
  dome.name = 'sky-dome'
  scene.add(dome)
  return dome
}

// Ocean with animated waves - improved with better color and normals
export function createOcean(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(600, 600, 120, 120)
  const material = new THREE.MeshPhongMaterial({
    color: 0x0d4f6e,
    emissive: 0x052838,
    emissiveIntensity: 0.15,
    specular: 0xaaddff,
    shininess: 160,
    transparent: true,
    opacity: 0.88,
    side: THREE.FrontSide,
  })
  const ocean = new THREE.Mesh(geometry, material)
  ocean.rotation.x = -Math.PI / 2
  ocean.position.y = -0.5
  ocean.receiveShadow = true
  ocean.name = 'ocean'
  scene.add(ocean)
  return ocean
}

export function animateOcean(ocean: THREE.Mesh | null, time: number): void {
  if (!ocean) return
  const pos = ocean.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getY(i)
    // Two overlapping wave patterns for more natural look
    const wave =
      Math.sin(x * 0.04 + time * 0.7) * 0.45 +
      Math.cos(z * 0.05 + time * 0.55) * 0.30 +
      Math.sin(x * 0.09 - z * 0.06 + time * 1.1) * 0.18 +
      Math.cos(x * 0.02 + z * 0.03 + time * 0.35) * 0.22
    pos.setZ(i, wave)
  }
  pos.needsUpdate = true
  ocean.geometry.computeVertexNormals()
}

// Dock / quay wall — proper concrete quay with fenders, bollards, road markings
export function createDock(scene: THREE.Scene): THREE.Group {
  const dockGroup = new THREE.Group()
  dockGroup.name = 'dock'

  // Main quay platform — wider and longer
  const platformGeo = new THREE.BoxGeometry(80, 1.2, 22)
  const platformMat = new THREE.MeshPhongMaterial({
    color: 0x7a7a72,
    specular: 0x222222,
    shininess: 12,
  })
  const platform = new THREE.Mesh(platformGeo, platformMat)
  platform.position.set(0, 0, -20)
  platform.receiveShadow = true
  platform.castShadow = true
  dockGroup.add(platform)

  // Quay edge lip (raised edge safety kerb)
  const lipGeo = new THREE.BoxGeometry(80, 0.35, 0.6)
  const lipMat = new THREE.MeshPhongMaterial({ color: 0xeeee33 })
  const lip = new THREE.Mesh(lipGeo, lipMat)
  lip.position.set(0, 0.77, -10.2)
  dockGroup.add(lip)

  // Road surface stripes
  const stripeGeo = new THREE.BoxGeometry(3, 0.02, 1)
  const stripeMat = new THREE.MeshPhongMaterial({ color: 0xffffff })
  for (let i = -5; i <= 5; i++) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat)
    stripe.position.set(i * 6, 0.62, -20)
    dockGroup.add(stripe)
  }

  // Rubber fenders along quay edge
  const fenderGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.8, 12)
  const fenderMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 60 })
  for (let i = -6; i <= 6; i++) {
    const fender = new THREE.Mesh(fenderGeo, fenderMat)
    fender.rotation.z = Math.PI / 2
    fender.position.set(i * 6, 0.2, -10.6)
    fender.castShadow = true
    dockGroup.add(fender)
  }

  // Bollards — larger and more realistic
  const bollardCapGeo = new THREE.SphereGeometry(0.35, 10, 8)
  const bollardBodyGeo = new THREE.CylinderGeometry(0.28, 0.38, 1.1, 10)
  const bollardMat = new THREE.MeshPhongMaterial({ color: 0x2b2b2b, shininess: 40 })
  for (let i = -7; i <= 7; i++) {
    const bollardBody = new THREE.Mesh(bollardBodyGeo, bollardMat)
    bollardBody.position.set(i * 5.5, 0.9, -11)
    bollardBody.castShadow = true
    dockGroup.add(bollardBody)

    const cap = new THREE.Mesh(bollardCapGeo, bollardMat)
    cap.position.set(i * 5.5, 1.55, -11)
    dockGroup.add(cap)
  }

  // Mooring lines (decorative ropes)
  const lineMat = new THREE.MeshPhongMaterial({ color: 0x8b7355 })
  const lineGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6)
  for (let i = -3; i <= 3; i += 2) {
    const line = new THREE.Mesh(lineGeo, lineMat)
    line.position.set(i * 8, 1.2, -11)
    line.rotation.z = 0.5
    dockGroup.add(line)
  }

  // Port light poles
  const poleMat = new THREE.MeshPhongMaterial({ color: 0x444444 })
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 9, 8)
  const lampGeo = new THREE.SphereGeometry(0.4, 10, 8)
  const lampMat = new THREE.MeshPhongMaterial({
    color: 0xfff5aa,
    emissive: 0xffd700,
    emissiveIntensity: 1.2,
  })

  for (let i = -3; i <= 3; i++) {
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.set(i * 14, 4.5, -28)
    pole.castShadow = true
    dockGroup.add(pole)

    const lamp = new THREE.Mesh(lampGeo, lampMat)
    lamp.position.set(i * 14, 9.5, -28)
    dockGroup.add(lamp)
  }

  // Terminal building in background
  addTerminalBuilding(dockGroup)

  scene.add(dockGroup)
  return dockGroup
}

function addTerminalBuilding(parent: THREE.Group): void {
  // Main terminal building
  const buildingGeo = new THREE.BoxGeometry(30, 8, 12)
  const buildingMat = new THREE.MeshPhongMaterial({ color: 0xc8c0b0, shininess: 8 })
  const building = new THREE.Mesh(buildingGeo, buildingMat)
  building.position.set(-30, 4, -40)
  building.castShadow = true
  building.receiveShadow = true
  parent.add(building)

  // Windows row
  const windowMat = new THREE.MeshPhongMaterial({
    color: 0x88aacc,
    emissive: 0x224466,
    emissiveIntensity: 0.6,
    shininess: 120,
  })
  for (let i = -3; i <= 3; i++) {
    const winGeo = new THREE.BoxGeometry(2, 1.5, 0.1)
    const win = new THREE.Mesh(winGeo, windowMat)
    win.position.set(-30 + i * 4, 5.5, -34.1)
    parent.add(win)
  }

  // Warehouse shed
  const shedGeo = new THREE.BoxGeometry(25, 6, 18)
  const shedMat = new THREE.MeshPhongMaterial({ color: 0x8090a0, shininess: 5 })
  const shed = new THREE.Mesh(shedGeo, shedMat)
  shed.position.set(28, 3, -46)
  shed.castShadow = true
  parent.add(shed)

  // Shed roof
  const roofGeo = new THREE.CylinderGeometry(0.1, 13.5, 3, 4)
  const roofMat = new THREE.MeshPhongMaterial({ color: 0x607080, shininess: 15 })
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.rotation.y = Math.PI / 4
  roof.position.set(28, 7.5, -46)
  parent.add(roof)
}

// Improved lighting setup — warm sunlight from proper direction
export function createLighting(scene: THREE.Scene): void {
  // Soft ambient — slightly warm
  const ambient = new THREE.AmbientLight(0x9090c0, 0.55)
  scene.add(ambient)

  // Main sun — warm afternoon light
  const sun = new THREE.DirectionalLight(0xfff0cc, 1.8)
  sun.position.set(60, 70, 30)
  sun.castShadow = true
  sun.shadow.mapSize.width = 4096
  sun.shadow.mapSize.height = 4096
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 250
  sun.shadow.camera.left = -100
  sun.shadow.camera.right = 100
  sun.shadow.camera.top = 100
  sun.shadow.camera.bottom = -100
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.02
  scene.add(sun)

  // Cool fill from opposite side (sky reflection)
  const fill = new THREE.DirectionalLight(0x88aadd, 0.45)
  fill.position.set(-30, 15, -20)
  scene.add(fill)

  // Hemisphere — sky blue top, warm concrete bottom
  const hemi = new THREE.HemisphereLight(0x8ab9e0, 0x7a6040, 0.55)
  scene.add(hemi)

  // Rim light to highlight ship outline
  const rim = new THREE.DirectionalLight(0xffeebb, 0.3)
  rim.position.set(-40, 30, -60)
  scene.add(rim)
}

// Particle system for foam/spray (lightweight)
export function createFoamParticles(scene: THREE.Scene): THREE.Points {
  const count = 300
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 120
    positions[i * 3 + 1] = -0.2 + Math.random() * 0.3
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.35,
    transparent: true,
    opacity: 0.55,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geo, mat)
  points.name = 'foam'
  scene.add(points)
  return points
}

export function animateFoam(foam: THREE.Points | null, time: number): void {
  if (!foam) return
  const pos = foam.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, -0.2 + Math.abs(Math.sin(x * 0.3 + time * 1.1) * Math.cos(z * 0.4 + time * 0.9)) * 0.4)
  }
  pos.needsUpdate = true
}
