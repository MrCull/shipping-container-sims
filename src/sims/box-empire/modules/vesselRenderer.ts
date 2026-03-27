// ---------------------------------------------------------------------------
// Box Empire — Vessel mesh management (GLB with procedural fallback)
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { VesselVisit } from '../types'
import { loadModel, disposeModel } from './modelLoader'

const VESSEL_GLB_URL = new URL('../assets/models/container-ship-large-empty-no-containers.glb', import.meta.url).href

// Target scale for the container ship GLB so it matches LOA ≈ 50m
const VESSEL_MODEL_SCALE = 0.035

export class VesselRenderer {
  private meshes = new Map<string, THREE.Group>()
  private glbMeshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene
  private glbLoaded = false

  constructor(scene: THREE.Scene) {
    this.scene = scene
    // Pre-load the GLB
    loadModel(VESSEL_GLB_URL)
      .then(model => {
        this.glbLoaded = true
        // Swap any existing procedural meshes to GLB
        for (const [vesselId, procMesh] of this.meshes) {
          const glb = model.clone ? model.clone(true) : model
          this.applyGlbMesh(vesselId, procMesh, glb)
        }
      })
      .catch(() => {
        // Falls back to procedural — no action needed
      })
  }

  private applyGlbMesh(vesselId: string, procMesh: THREE.Group, glb: THREE.Group): void {
    // Remove existing GLB if present
    const existingGlb = this.glbMeshes.get(vesselId)
    if (existingGlb) {
      procMesh.remove(existingGlb)
      disposeModel(existingGlb)
    }

    glb.scale.setScalar(VESSEL_MODEL_SCALE)
    // Rotate so bow points along -Z (away from camera / toward water)
    glb.rotation.y = Math.PI
    glb.position.set(0, 0, 0)

    // Hide procedural sub-meshes
    procMesh.traverse(obj => {
      if (obj !== procMesh) obj.visible = false
    })

    procMesh.add(glb)
    this.glbMeshes.set(vesselId, glb)
  }

  private createVesselMesh(vessel: VesselVisit): THREE.Group {
    const group = new THREE.Group()
    const halfLength = vessel.loa / 2
    const halfBeam = vessel.beam / 2
    const hullHeight = 4

    // Hull: shape in XZ plane → vessel length runs along Z axis
    const hullShape = new THREE.Shape()
    hullShape.moveTo(-halfBeam * 0.6, -halfLength)
    hullShape.lineTo(-halfBeam, -halfLength * 0.3)
    hullShape.lineTo(-halfBeam, halfLength * 0.5)
    hullShape.lineTo(-halfBeam * 0.3, halfLength)
    hullShape.lineTo(halfBeam * 0.3, halfLength)
    hullShape.lineTo(halfBeam, halfLength * 0.5)
    hullShape.lineTo(halfBeam, -halfLength * 0.3)
    hullShape.lineTo(halfBeam * 0.6, -halfLength)
    hullShape.closePath()

    const extrudeSettings = { depth: hullHeight, bevelEnabled: false }
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, extrudeSettings)
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.6, metalness: 0.2 })
    const hull = new THREE.Mesh(hullGeo, hullMat)
    hull.rotation.x = -Math.PI / 2
    hull.castShadow = true
    hull.receiveShadow = true
    group.add(hull)

    const deckGeo = new THREE.BoxGeometry(vessel.beam * 0.9, 0.3, vessel.loa * 0.8)
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.8 })
    const deck = new THREE.Mesh(deckGeo, deckMat)
    deck.position.y = hullHeight + 0.15
    deck.castShadow = true
    group.add(deck)

    const bridgeGeo = new THREE.BoxGeometry(6, 5, 5)
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xecf0f1, roughness: 0.5 })
    const bridge = new THREE.Mesh(bridgeGeo, bridgeMat)
    bridge.position.set(0, hullHeight + 2.8, -halfLength * 0.6)
    bridge.castShadow = true
    group.add(bridge)

    return group
  }

  update(vessels: VesselVisit[]): void {
    for (const vessel of vessels) {
      if (vessel.state === 'departed' && vessel.position.z < -60) {
        const mesh = this.meshes.get(vessel.id)
        if (mesh) {
          const glb = this.glbMeshes.get(vessel.id)
          if (glb) disposeModel(glb)
          this.glbMeshes.delete(vessel.id)
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

        // If GLB already loaded, attach immediately
        if (this.glbLoaded) {
          loadModel(VESSEL_GLB_URL).then(glb => {
            if (this.meshes.has(vessel.id)) {
              this.applyGlbMesh(vessel.id, this.meshes.get(vessel.id)!, glb)
            }
          }).catch(() => {/* keep procedural */})
        }
      }

      mesh.position.set(vessel.position.x, vessel.position.y, vessel.position.z)
    }
  }

  dispose(): void {
    for (const [id, mesh] of this.meshes) {
      const glb = this.glbMeshes.get(id)
      if (glb) disposeModel(glb)
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
    this.glbMeshes.clear()
  }
}
