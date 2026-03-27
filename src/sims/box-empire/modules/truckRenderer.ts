// ---------------------------------------------------------------------------
// Box Empire — Truck mesh management (GLB with procedural fallback)
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { TruckVisit } from '../types'
import { loadModel, disposeModel } from './modelLoader'

const TRUCK_GLB_URL = new URL('../assets/models/truck-no-trailer.glb', import.meta.url).href

// Scale the truck GLB to roughly match a terminal tractor (~5m long, ~2m wide)
const TRUCK_MODEL_SCALE = 0.014

export class TruckRenderer {
  private meshes = new Map<string, THREE.Group>()
  private glbMeshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene
  private glbLoaded = false
  private glbTemplate: THREE.Group | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
    loadModel(TRUCK_GLB_URL)
      .then(model => {
        this.glbLoaded = true
        this.glbTemplate = model
        // Upgrade any trucks already rendered
        for (const [truckId, procMesh] of this.meshes) {
          this.attachGlb(truckId, procMesh)
        }
      })
      .catch((err: unknown) => {
        console.warn('[TruckRenderer] Failed to load truck GLB, using procedural fallback:', err)
      })
  }

  private attachGlb(truckId: string, procMesh: THREE.Group): void {
    if (!this.glbTemplate) return
    const existingGlb = this.glbMeshes.get(truckId)
    if (existingGlb) {
      procMesh.remove(existingGlb)
      disposeModel(existingGlb)
    }

    const glb = this.glbTemplate.clone(true)
    glb.scale.setScalar(TRUCK_MODEL_SCALE)
    // GLB cab faces +X by default; rotate so cab faces +Z (our forward direction)
    glb.rotation.y = -Math.PI / 2
    glb.position.set(0, 0, 0)

    // Hide procedural parts
    procMesh.traverse(obj => {
      if (obj !== procMesh) obj.visible = false
    })

    procMesh.add(glb)
    this.glbMeshes.set(truckId, glb)
  }

  private createTruckMesh(): THREE.Group {
    const group = new THREE.Group()

    // Cab — positioned at front (+Z)
    const cabGeo = new THREE.BoxGeometry(2.5, 2, 2.2)
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.5 })
    const cab = new THREE.Mesh(cabGeo, cabMat)
    cab.position.set(0, 1.2, 1.5)
    cab.castShadow = true
    group.add(cab)

    // Chassis / bed behind cab
    const bedGeo = new THREE.BoxGeometry(2.5, 0.3, 4)
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 })
    const bed = new THREE.Mesh(bedGeo, bedMat)
    bed.position.set(0, 0.6, -0.5)
    bed.castShadow = true
    group.add(bed)

    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 8)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 })
    // Front wheels under cab
    for (const sx of [-1.2, 1.2]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(sx, 0.35, 1.5)
      group.add(wheel)
    }
    // Rear wheels
    for (const sx of [-1.2, 1.2]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(sx, 0.35, -1.2)
      group.add(wheel)
    }

    return group
  }

  update(trucks: TruckVisit[]): void {
    const activeTrucks = trucks.filter(t => t.state !== 'departed')
    const activeTruckIds = new Set(activeTrucks.map(t => t.id))

    for (const [id, mesh] of this.meshes) {
      if (!activeTruckIds.has(id)) {
        const glb = this.glbMeshes.get(id)
        if (glb) {
          disposeModel(glb)
          this.glbMeshes.delete(id)
        }
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

        if (this.glbLoaded) {
          this.attachGlb(truck.id, mesh)
        }
      }

      mesh.position.set(truck.position.x, truck.position.y, truck.position.z)

      if (truck.targetPosition) {
        const dx = truck.targetPosition.x - truck.position.x
        const dz = truck.targetPosition.z - truck.position.z
        if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
          // Procedural model's cab is at +Z, so atan2(dx, dz) faces forward correctly
          mesh.rotation.y = Math.atan2(dx, dz)
        }
      }
    }
  }

  dispose(): void {
    for (const [id, mesh] of this.meshes) {
      const glb = this.glbMeshes.get(id)
      if (glb) {
        disposeModel(glb)
        this.glbMeshes.delete(id)
      }
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
    if (this.glbTemplate) {
      disposeModel(this.glbTemplate)
      this.glbTemplate = null
    }
  }
}
