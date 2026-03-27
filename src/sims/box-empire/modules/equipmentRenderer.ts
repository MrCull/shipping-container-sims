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

    const bodyGeo = new THREE.BoxGeometry(3, 2, 2.5)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.5 })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 1.5
    body.castShadow = true
    group.add(body)

    const cabGeo = new THREE.BoxGeometry(1.5, 1.2, 2)
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.4 })
    const cab = new THREE.Mesh(cabGeo, cabMat)
    cab.position.set(-0.5, 3, 0)
    cab.castShadow = true
    group.add(cab)

    const boomGeo = new THREE.BoxGeometry(0.3, 0.3, 6)
    const boomMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.5 })
    const boom = new THREE.Mesh(boomGeo, boomMat)
    boom.position.set(0, 3.5, 3)
    boom.castShadow = true
    group.add(boom)

    for (let i = -1; i <= 1; i += 2) {
      const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12)
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 })
      const frontWheel = new THREE.Mesh(wheelGeo, wheelMat)
      frontWheel.rotation.z = Math.PI / 2
      frontWheel.position.set(i * 1.3, 0.5, 1)
      group.add(frontWheel)

      const rearWheel = new THREE.Mesh(wheelGeo, wheelMat)
      rearWheel.rotation.z = Math.PI / 2
      rearWheel.position.set(i * 1.3, 0.5, -1)
      group.add(rearWheel)
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
