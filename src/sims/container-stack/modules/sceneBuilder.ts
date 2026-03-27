import * as THREE from 'three'

export interface SceneBuildResult {
  ground: THREE.Mesh
  towerPivot: THREE.Group
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  spot: THREE.SpotLight
  fill: THREE.DirectionalLight
}

export function buildScene(scene: THREE.Scene): SceneBuildResult {
  scene.background = new THREE.Color(0x1a1f2e)
  scene.fog = new THREE.FogExp2(0x1a1f2e, 0.006)

  const groundGeo = new THREE.PlaneGeometry(200, 200, 40, 40)
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f5c,
    roughness: 0.88,
    metalness: 0.06,
  })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(120, 60, 0x6b7280, 0x3d4450)
  grid.position.y = 0.02
  scene.add(grid)

  const towerPivot = new THREE.Group()
  towerPivot.position.set(0, 0, 0)
  scene.add(towerPivot)

  const ambient = new THREE.AmbientLight(0xffffff, 0.72)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xfff8f0, 1.65)
  sun.position.set(32, 52, 26)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 2
  sun.shadow.camera.far = 120
  sun.shadow.camera.left = -40
  sun.shadow.camera.right = 40
  sun.shadow.camera.top = 40
  sun.shadow.camera.bottom = -40
  scene.add(sun)

  const fill = new THREE.DirectionalLight(0xb8c5ff, 0.55)
  fill.position.set(-28, 28, -20)
  scene.add(fill)

  const spot = new THREE.SpotLight(0xffeedd, 1.1, 100, Math.PI / 4, 0.45, 1)
  spot.position.set(-8, 42, 22)
  spot.target.position.set(0, 10, 0)
  spot.castShadow = true
  scene.add(spot)
  scene.add(spot.target)

  return { ground, towerPivot, ambient, sun, spot, fill }
}
