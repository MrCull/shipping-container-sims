import * as THREE from 'three'

export interface SceneBuildResult {
  ground: THREE.Mesh
  towerPivot: THREE.Group
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  spot: THREE.SpotLight
}

export function buildScene(scene: THREE.Scene): SceneBuildResult {
  scene.background = new THREE.Color(0x0d1117)
  scene.fog = new THREE.FogExp2(0x0d1117, 0.012)

  const groundGeo = new THREE.PlaneGeometry(200, 200, 40, 40)
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a32,
    roughness: 0.92,
    metalness: 0.08,
  })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(120, 60, 0x3d4450, 0x252830)
  grid.position.y = 0.02
  scene.add(grid)

  const towerPivot = new THREE.Group()
  towerPivot.position.set(0, 0, 0)
  scene.add(towerPivot)

  const ambient = new THREE.AmbientLight(0x6b7280, 0.45)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xfff5e6, 1.05)
  sun.position.set(28, 48, 22)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 2
  sun.shadow.camera.far = 120
  sun.shadow.camera.left = -40
  sun.shadow.camera.right = 40
  sun.shadow.camera.top = 40
  sun.shadow.camera.bottom = -40
  scene.add(sun)

  const spot = new THREE.SpotLight(0xffe0c2, 0.55, 80, Math.PI / 5, 0.4, 1)
  spot.position.set(-12, 36, 18)
  spot.target.position.set(0, 8, 0)
  spot.castShadow = true
  scene.add(spot)
  scene.add(spot.target)

  return { ground, towerPivot, ambient, sun, spot }
}
