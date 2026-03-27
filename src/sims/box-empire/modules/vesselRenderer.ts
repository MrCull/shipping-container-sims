// ---------------------------------------------------------------------------
// Box Empire — Vessel mesh management (procedural only)
// ---------------------------------------------------------------------------
// The GLB model is far too large for the terminal scale. We use a clean
// procedural hull that exactly matches the tutorial vessel's LOA/beam.
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

    const L = vessel.loa      // ~50 m, runs along X
    const B = vessel.beam     // ~12 m, runs along Z
    const hullH = 5           // hull freeboard height

    // ---- Hull body (dark navy) -------------------------------------------
    const hullGeo = new THREE.BoxGeometry(L, hullH, B)
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.7, metalness: 0.3 })
    const hull = new THREE.Mesh(hullGeo, hullMat)
    hull.position.y = hullH / 2
    hull.castShadow = true
    hull.receiveShadow = true
    group.add(hull)

    // ---- Bow wedge (+X end, painted red below waterline) -----------------
    const bowGeo = new THREE.CylinderGeometry(0, B / 2, hullH, 4, 1)
    const bowMat = new THREE.MeshStandardMaterial({ color: 0xaa2222, roughness: 0.6 })
    const bow = new THREE.Mesh(bowGeo, bowMat)
    bow.rotation.y = Math.PI / 4
    bow.rotation.z = Math.PI / 2
    bow.position.set(L / 2, hullH / 2, 0)
    bow.castShadow = true
    group.add(bow)

    // ---- Deck (light grey) -----------------------------------------------
    const deckGeo = new THREE.BoxGeometry(L * 0.88, 0.4, B * 0.85)
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.85 })
    const deck = new THREE.Mesh(deckGeo, deckMat)
    deck.position.y = hullH + 0.2
    deck.castShadow = true
    group.add(deck)

    // ---- Hatch covers (lighter, evenly spaced on deck) -------------------
    const numHatches = 4
    const hatchW = (L * 0.7) / numHatches - 1
    const hatchMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.7 })
    for (let i = 0; i < numHatches; i++) {
      const hx = -L * 0.3 + i * (hatchW + 1) + hatchW / 2
      const hatchGeo = new THREE.BoxGeometry(hatchW, 0.25, B * 0.65)
      const hatch = new THREE.Mesh(hatchGeo, hatchMat)
      hatch.position.set(hx, hullH + 0.55, 0)
      group.add(hatch)
    }

    // ---- Bridge superstructure (white, at stern / -X end) ----------------
    const bridgeW = 8
    const bridgeH = 10
    const bridgeGeo = new THREE.BoxGeometry(bridgeW, bridgeH, B * 0.75)
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 })
    const bridge = new THREE.Mesh(bridgeGeo, bridgeMat)
    bridge.position.set(-L / 2 + bridgeW / 2 + 1, hullH + bridgeH / 2, 0)
    bridge.castShadow = true
    group.add(bridge)

    // Windows on bridge
    const winMat = new THREE.MeshStandardMaterial({ color: 0x4a90d9, roughness: 0.1, metalness: 0.1 })
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const winGeo = new THREE.BoxGeometry(0.05, 0.8, 0.9)
        const win = new THREE.Mesh(winGeo, winMat)
        win.position.set(
          -L / 2 + bridgeW + 0.1,
          hullH + 5 + row * 2,
          -B * 0.28 + col * B * 0.19,
        )
        group.add(win)
      }
    }

    // ---- Funnel (yellow/black) at stern ----------------------------------
    const funnelGeo = new THREE.CylinderGeometry(1.2, 1.5, 5, 12)
    const funnelMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.5 })
    const funnel = new THREE.Mesh(funnelGeo, funnelMat)
    funnel.position.set(-L / 2 + 3, hullH + bridgeH + 2, 0)
    funnel.castShadow = true
    group.add(funnel)

    const funnelTopGeo = new THREE.CylinderGeometry(1.2, 1.2, 1, 12)
    const funnelTopMat = new THREE.MeshStandardMaterial({ color: 0x111111 })
    const funnelTop = new THREE.Mesh(funnelTopGeo, funnelTopMat)
    funnelTop.position.set(-L / 2 + 3, hullH + bridgeH + 5, 0)
    group.add(funnelTop)

    // ---- Railing strip along deck edge ----------------------------------
    const railMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
    for (const zSide of [-1, 1]) {
      const railGeo = new THREE.BoxGeometry(L * 0.85, 0.5, 0.1)
      const rail = new THREE.Mesh(railGeo, railMat)
      rail.position.set(0, hullH + 0.85, zSide * (B / 2 - 0.1))
      group.add(rail)
    }

    // Rotate 180° so bow (+X wedge) faces -X — the direction of travel when arriving
    group.rotation.y = Math.PI
    return group
  }

  update(vessels: VesselVisit[]): void {
    for (const vessel of vessels) {
      // Clean up fully departed vessels
      if (vessel.state === 'departed' && vessel.position.x < -80) {
        const mesh = this.meshes.get(vessel.id)
        if (mesh) {
          this.scene.remove(mesh)
          mesh.traverse(obj => {
            const m = obj as THREE.Mesh
            if (m.geometry) m.geometry.dispose()
            if (m.material) {
              if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
              else m.material.dispose()
            }
          })
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
