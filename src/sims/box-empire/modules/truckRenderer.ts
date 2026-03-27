// ---------------------------------------------------------------------------
// Box Empire — Truck mesh management
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { TruckVisit } from '../types'

export class TruckRenderer {
  private meshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private createTruckMesh(): THREE.Group {
    const group = new THREE.Group()

    const cabGeo = new THREE.BoxGeometry(2.5, 2, 2.2)
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.5 })
    const cab = new THREE.Mesh(cabGeo, cabMat)
    cab.position.set(0, 1.2, -0.5)
    cab.castShadow = true
    group.add(cab)

    const bedGeo = new THREE.BoxGeometry(2.5, 0.3, 5)
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 })
    const bed = new THREE.Mesh(bedGeo, bedMat)
    bed.position.set(0, 0.6, 1.5)
    bed.castShadow = true
    group.add(bed)

    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 8)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 })
    const positions = [
      [-1.2, 0.35, -0.8],
      [1.2, 0.35, -0.8],
      [-1.2, 0.35, 2.5],
      [1.2, 0.35, 2.5],
    ]
    for (const [x, y, z] of positions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, y, z)
      group.add(wheel)
    }

    return group
  }

  update(trucks: TruckVisit[]): void {
    const activeTrucks = trucks.filter(t => t.state !== 'departed')
    const activeTruckIds = new Set(activeTrucks.map(t => t.id))

    for (const [id, mesh] of this.meshes) {
      if (!activeTruckIds.has(id)) {
        this.scene.remove(mesh)
        this.meshes.delete(id)
      }
    }

    for (const truck of activeTrucks) {
      let mesh = this.meshes.get(truck.id)
      if (!mesh) {
        mesh = this.createTruckMesh()
        mesh.name = truck.id
        this.scene.add(mesh)
        this.meshes.set(truck.id, mesh)
      }

      mesh.position.set(truck.position.x, truck.position.y, truck.position.z)

      if (truck.targetPosition) {
        const dx = truck.targetPosition.x - truck.position.x
        const dz = truck.targetPosition.z - truck.position.z
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
