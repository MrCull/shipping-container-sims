// ---------------------------------------------------------------------------
// Box Empire — Equipment mesh management
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Equipment } from '../types'

export class EquipmentRenderer {
  private meshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private createReachStacker(): THREE.Group {
    const group = new THREE.Group()
    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.5, metalness: 0.3 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.4 })
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.4 })
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111 })

    // Main body / chassis
    const bodyGeo = new THREE.BoxGeometry(3.2, 1.8, 4.5)
    const body = new THREE.Mesh(bodyGeo, orangeMat)
    body.position.set(0, 1.5, 0)
    body.castShadow = true
    group.add(body)

    // Raised engine hood at rear
    const hoodGeo = new THREE.BoxGeometry(3, 1.5, 1.5)
    const hood = new THREE.Mesh(hoodGeo, orangeMat)
    hood.position.set(0, 2.3, -1.6)
    hood.castShadow = true
    group.add(hood)

    // Cab with glass appearance
    const cabGeo = new THREE.BoxGeometry(1.8, 1.5, 1.5)
    const cab = new THREE.Mesh(cabGeo, darkMat)
    cab.position.set(-0.6, 3, 0.8)
    cab.castShadow = true
    group.add(cab)

    // Cab windows (slightly lighter)
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x4a90d9, roughness: 0.1, metalness: 0.1 })
    const frontWindowGeo = new THREE.BoxGeometry(1.6, 0.9, 0.05)
    const frontWindow = new THREE.Mesh(frontWindowGeo, glassMat)
    frontWindow.position.set(-0.6, 3.1, 1.58)
    group.add(frontWindow)

    // Counter-weight at rear
    const cwGeo = new THREE.BoxGeometry(3, 1.2, 1.2)
    const cwMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 })
    const cw = new THREE.Mesh(cwGeo, cwMat)
    cw.position.set(0, 1.1, -2.6)
    cw.castShadow = true
    group.add(cw)

    // Main boom arm (angled up slightly when unladen)
    const boomGroup = new THREE.Group()
    boomGroup.position.set(0.8, 3.2, 2.1)

    const boomGeo = new THREE.BoxGeometry(0.4, 0.4, 5.5)
    const boom = new THREE.Mesh(boomGeo, orangeMat)
    boom.position.set(0, 0, 2.75)
    boom.castShadow = true
    boomGroup.add(boom)

    // Secondary boom / extension
    const ext1Geo = new THREE.BoxGeometry(0.3, 0.3, 3)
    const ext1 = new THREE.Mesh(ext1Geo, orangeMat)
    ext1.position.set(0, 0, 7)
    boomGroup.add(ext1)

    // Spreader frame at end of boom
    const spreaderGeo = new THREE.BoxGeometry(6.5, 0.2, 0.4)
    const spreaderMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 })
    const spreader = new THREE.Mesh(spreaderGeo, spreaderMat)
    spreader.position.set(0, -0.6, 8.5)
    boomGroup.add(spreader)

    // Spreader side beams
    for (const sx of [-3, 3]) {
      const sideGeo = new THREE.BoxGeometry(0.2, 0.8, 0.3)
      const side = new THREE.Mesh(sideGeo, spreaderMat)
      side.position.set(sx, -0.6, 8.5)
      boomGroup.add(side)
    }

    boomGroup.rotation.x = -0.15
    group.add(boomGroup)

    // Cab warning light
    const lightGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.15, 8)
    const light = new THREE.Mesh(lightGeo, yellowMat)
    light.position.set(-0.6, 3.8, 0.8)
    group.add(light)

    // Large rear wheels (double-axle at rear)
    const rearWheelGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.5, 16)
    for (const sx of [-1.7, 1.7]) {
      for (const sz of [-1.7, -2.5]) {
        const wheel = new THREE.Mesh(rearWheelGeo, blackMat)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(sx, 0.65, sz)
        group.add(wheel)
      }
    }

    // Large front steering wheels
    const frontWheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.45, 16)
    for (const sx of [-1.7, 1.7]) {
      const wheel = new THREE.Mesh(frontWheelGeo, blackMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(sx, 0.6, 1.8)
      group.add(wheel)
    }

    return group
  }

  private createMobileHarborCrane(): THREE.Group {
    const group = new THREE.Group()

    const baseGeo = new THREE.BoxGeometry(4, 1, 4)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.5 })
    const base = new THREE.Mesh(baseGeo, baseMat)
    base.position.y = 0.5
    base.castShadow = true
    group.add(base)

    const towerGeo = new THREE.BoxGeometry(2, 12, 2)
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.5 })
    const tower = new THREE.Mesh(towerGeo, towerMat)
    tower.position.y = 7
    tower.castShadow = true
    group.add(tower)

    const jibGeo = new THREE.BoxGeometry(0.5, 0.5, 15)
    const jibMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.5 })
    const jib = new THREE.Mesh(jibGeo, jibMat)
    jib.position.set(0, 13, -5)
    jib.castShadow = true
    group.add(jib)

    const cabGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5)
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.4 })
    const cab = new THREE.Mesh(cabGeo, cabMat)
    cab.position.set(0, 12, 1)
    cab.castShadow = true
    group.add(cab)

    return group
  }

  update(equipmentList: Equipment[]): void {
    for (const eq of equipmentList) {
      let mesh = this.meshes.get(eq.id)
      if (!mesh) {
        mesh = eq.type === 'reach_stacker'
          ? this.createReachStacker()
          : this.createMobileHarborCrane()
        mesh.name = eq.id
        this.scene.add(mesh)
        this.meshes.set(eq.id, mesh)
      }

      mesh.position.set(eq.position.x, eq.position.y, eq.position.z)

      if (eq.type === 'reach_stacker' && eq.targetPosition) {
        const dx = eq.targetPosition.x - eq.position.x
        const dz = eq.targetPosition.z - eq.position.z
        if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
          mesh.rotation.y = Math.atan2(dx, dz)
        }
      }
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
          else m.material.dispose()
        }
      })
      this.scene.remove(mesh)
    }
    this.meshes.clear()
  }
}
