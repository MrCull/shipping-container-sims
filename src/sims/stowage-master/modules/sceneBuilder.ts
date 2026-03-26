import * as THREE from 'three'

export function createOcean(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(400, 400, 80, 80)
  const material = new THREE.MeshPhongMaterial({
    color: 0x1a6b8a,
    transparent: true,
    opacity: 0.85,
    shininess: 100,
    side: THREE.DoubleSide,
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
    const wave =
      Math.sin(x * 0.05 + time * 0.8) * 0.3 +
      Math.cos(z * 0.07 + time * 0.6) * 0.2
    pos.setZ(i, wave)
  }
  pos.needsUpdate = true
  ocean.geometry.computeVertexNormals()
}

export function createDock(scene: THREE.Scene): THREE.Group {
  const dockGroup = new THREE.Group()
  dockGroup.name = 'dock'

  const platformGeo = new THREE.BoxGeometry(50, 1, 15)
  const platformMat = new THREE.MeshLambertMaterial({ color: 0x808080 })
  const platform = new THREE.Mesh(platformGeo, platformMat)
  platform.position.set(0, 0, -15)
  platform.receiveShadow = true
  platform.castShadow = true
  dockGroup.add(platform)

  const bollardGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.0, 8)
  const bollardMat = new THREE.MeshLambertMaterial({ color: 0x333333 })
  for (let i = 0; i < 10; i++) {
    const bollard = new THREE.Mesh(bollardGeo, bollardMat)
    bollard.position.set(-22 + i * 5, 0.8, -8)
    bollard.castShadow = true
    dockGroup.add(bollard)
  }

  scene.add(dockGroup)
  return dockGroup
}

export function createLighting(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight(0x404060, 0.6)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xffeedd, 1.2)
  sun.position.set(30, 40, 20)
  sun.castShadow = true
  sun.shadow.mapSize.width = 2048
  sun.shadow.mapSize.height = 2048
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 120
  sun.shadow.camera.left = -60
  sun.shadow.camera.right = 60
  sun.shadow.camera.top = 60
  sun.shadow.camera.bottom = -60
  sun.shadow.bias = -0.001
  scene.add(sun)

  const fill = new THREE.DirectionalLight(0x8888ff, 0.3)
  fill.position.set(-20, 10, -20)
  scene.add(fill)

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4)
  scene.add(hemi)
}

export function createSkybox(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x87ceeb)
  scene.fog = new THREE.Fog(0x87ceeb, 100, 300)
}
