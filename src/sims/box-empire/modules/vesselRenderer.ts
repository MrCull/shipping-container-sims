// ---------------------------------------------------------------------------
// Box Empire — Vessel mesh management
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { VesselVisit } from '../types'

export class VesselRenderer {
  private meshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private createVesselMesh(vessel: VesselVisit): THREE.Group {
    const group = new THREE.Group()
    const halfLength = vessel.loa / 2
    const halfBeam = vessel.beam / 2
    const hullHeight = 4

    const hullShape = new THREE.Shape()
    hullShape.moveTo(-halfLength, -halfBeam * 0.6)
    hullShape.lineTo(-halfLength * 0.3, -halfBeam)
    hullShape.lineTo(halfLength * 0.5, -halfBeam)
    hullShape.lineTo(halfLength, -halfBeam * 0.3)
    hullShape.lineTo(halfLength, halfBeam * 0.3)
    hullShape.lineTo(halfLength * 0.5, halfBeam)
    hullShape.lineTo(-halfLength * 0.3, halfBeam)
    hullShape.lineTo(-halfLength, halfBeam * 0.6)
    hullShape.closePath()

    const extrudeSettings = { depth: hullHeight, bevelEnabled: false }
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, extrudeSettings)
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.6, metalness: 0.2 })
    const hull = new THREE.Mesh(hullGeo, hullMat)
    hull.rotation.x = -Math.PI / 2
    hull.position.y = 0
    hull.castShadow = true
    hull.receiveShadow = true
    group.add(hull)

    const deckGeo = new THREE.BoxGeometry(vessel.loa * 0.8, 0.3, vessel.beam * 0.9)
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.8 })
    const deck = new THREE.Mesh(deckGeo, deckMat)
    deck.position.y = hullHeight + 0.15
    deck.castShadow = true
    group.add(deck)

    const bridgeGeo = new THREE.BoxGeometry(6, 5, 5)
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xecf0f1, roughness: 0.5 })
    const bridge = new THREE.Mesh(bridgeGeo, bridgeMat)
    bridge.position.set(-halfLength * 0.6, hullHeight + 2.8, 0)
    bridge.castShadow = true
    group.add(bridge)

    return group
  }

  update(vessels: VesselVisit[]): void {
    for (const vessel of vessels) {
      if (vessel.state === 'departed' && vessel.position.z < -60) {
        const mesh = this.meshes.get(vessel.id)
        if (mesh) {
          this.scene.remove(mesh)
          this.meshes.delete(vessel.id)
        }
        continue
      }

      if (vessel.state === 'announced') continue

      let mesh = this.meshes.get(vessel.id)
      if (!mesh) {
        mesh = this.createVesselMesh(vessel)
        mesh.name = vessel.id
        this.scene.add(mesh)
        this.meshes.set(vessel.id, mesh)
      }

      mesh.position.set(vessel.position.x, vessel.position.y, vessel.position.z)
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
