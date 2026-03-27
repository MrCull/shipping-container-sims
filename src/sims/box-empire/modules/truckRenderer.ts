// ---------------------------------------------------------------------------
// Box Empire — Road truck mesh (fully procedural, vivid colors)
// ---------------------------------------------------------------------------
// We deliberately skip GLB loading: the model's PBR materials need a specific
// lighting/environment setup that is not guaranteed. The procedural truck gives
// predictable, readable visuals at terminal scale.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { TruckVisit } from '../types'

const TRUCK_COLORS = [0xe74c3c, 0x27ae60, 0x2980b9, 0xf39c12, 0x8e44ad]
let colorIndex = 0

export class TruckRenderer {
  private meshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private createTruckMesh(visitType: 'import_pickup' | 'export_delivery'): THREE.Group {
    const group = new THREE.Group()

    // Pick a distinct color per truck; export=warm, import=cool
    const bodyColor = visitType === 'export_delivery'
      ? TRUCK_COLORS[colorIndex++ % 3]         // reds/greens/blues (warm)
      : TRUCK_COLORS[2 + (colorIndex++ % 3)]   // blues/yellows/purples
    colorIndex = colorIndex % TRUCK_COLORS.length

    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.2 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 })
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.7 })
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 0.9 })
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, roughness: 0.1, emissive: 0x886600, emissiveIntensity: 0.5 })

    // ---- Chassis / frame -------------------------------------------------
    const chassisGeo = new THREE.BoxGeometry(2.4, 0.3, 7)
    const chassis = new THREE.Mesh(chassisGeo, darkMat)
    chassis.position.set(0, 0.55, -0.5)
    chassis.castShadow = true
    group.add(chassis)

    // ---- Cab body --------------------------------------------------------
    const cabGeo = new THREE.BoxGeometry(2.3, 2.0, 2.6)
    const cab = new THREE.Mesh(cabGeo, bodyMat)
    cab.position.set(0, 1.7, 2.0)
    cab.castShadow = true
    group.add(cab)

    // Cab roof (slightly narrower, rounded feel)
    const roofGeo = new THREE.BoxGeometry(2.1, 0.5, 2.2)
    const roofMat = new THREE.MeshStandardMaterial({ color: darken(bodyColor, 0.15), roughness: 0.5 })
    const roof = new THREE.Mesh(roofGeo, roofMat)
    roof.position.set(0, 2.95, 1.9)
    roof.castShadow = true
    group.add(roof)

    // Front windscreen
    const windscreenGeo = new THREE.BoxGeometry(1.9, 1.0, 0.06)
    const windscreen = new THREE.Mesh(windscreenGeo, glassMat)
    windscreen.position.set(0, 2.2, 3.33)
    group.add(windscreen)

    // Side windows
    for (const sx of [-1, 1]) {
      const sideWinGeo = new THREE.BoxGeometry(0.06, 0.7, 1.0)
      const sideWin = new THREE.Mesh(sideWinGeo, glassMat)
      sideWin.position.set(sx * 1.18, 2.2, 1.8)
      group.add(sideWin)
    }

    // Front grille / bumper
    const grilleGeo = new THREE.BoxGeometry(2.2, 0.6, 0.15)
    const grille = new THREE.Mesh(grilleGeo, darkMat)
    grille.position.set(0, 1.1, 3.3)
    group.add(grille)

    const bumperGeo = new THREE.BoxGeometry(2.4, 0.25, 0.2)
    const bumper = new THREE.Mesh(bumperGeo, chromeMat)
    bumper.position.set(0, 0.55, 3.3)
    group.add(bumper)

    // Headlights
    for (const sx of [-0.7, 0.7]) {
      const lightGeo = new THREE.BoxGeometry(0.5, 0.28, 0.06)
      const headlight = new THREE.Mesh(lightGeo, lightMat)
      headlight.position.set(sx, 1.1, 3.38)
      group.add(headlight)
    }

    // Air stack (exhaust pipe, export trucks) / aerial (import trucks)
    if (visitType === 'export_delivery') {
      const stackGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.2, 8)
      const stackMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.6 })
      const stack = new THREE.Mesh(stackGeo, stackMat)
      stack.position.set(-0.9, 3.7, 1.5)
      group.add(stack)
    }

    // ---- Saddle / fifth wheel (coupling) ---------------------------------
    const saddleGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.2, 12)
    const saddleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.5 })
    const saddle = new THREE.Mesh(saddleGeo, saddleMat)
    saddle.position.set(0, 0.82, 0.3)
    group.add(saddle)

    // ---- Wheels ----------------------------------------------------------
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 16)
    const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.38, 8)
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.7 })
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })

    // Front steer axle (single wheels)
    for (const sx of [-1.25, 1.25]) {
      const tire = new THREE.Mesh(wheelGeo, tireMat)
      tire.rotation.z = Math.PI / 2
      tire.position.set(sx, 0.42, 2.4)
      tire.castShadow = true
      group.add(tire)
      const rim = new THREE.Mesh(rimGeo, rimMat)
      rim.rotation.z = Math.PI / 2
      rim.position.set(sx, 0.42, 2.4)
      group.add(rim)
    }

    // Rear drive axles (dual wheels)
    for (const sz of [-0.8, -2.0]) {
      for (const sx of [-1.3, 1.3]) {
        const tire = new THREE.Mesh(wheelGeo, tireMat)
        tire.rotation.z = Math.PI / 2
        tire.position.set(sx, 0.42, sz)
        tire.castShadow = true
        group.add(tire)
        const rim = new THREE.Mesh(rimGeo, rimMat)
        rim.rotation.z = Math.PI / 2
        rim.position.set(sx, 0.42, sz)
        group.add(rim)
      }
    }

    return group
  }

  update(trucks: TruckVisit[]): void {
    const activeTrucks = trucks.filter(t => t.state !== 'departed')
    const activeTruckIds = new Set(activeTrucks.map(t => t.id))

    // Remove departed
    for (const [id, mesh] of this.meshes) {
      if (!activeTruckIds.has(id)) {
        mesh.traverse(obj => {
          const m = obj as THREE.Mesh
          if (m.geometry) m.geometry.dispose()
          if (m.material) {
            if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
            else m.material.dispose()
          }
        })
        this.scene.remove(mesh)
        this.meshes.delete(id)
      }
    }

    for (const truck of activeTrucks) {
      let mesh = this.meshes.get(truck.id)
      if (!mesh) {
        mesh = this.createTruckMesh(truck.visitType)
        mesh.name = truck.id
        this.scene.add(mesh)
        this.meshes.set(truck.id, mesh)
      }

      mesh.position.set(truck.position.x, 0, truck.position.z)

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

function darken(hex: number, amount: number): number {
  const r = Math.max(0, ((hex >> 16) & 0xff) * (1 - amount))
  const g = Math.max(0, ((hex >> 8) & 0xff) * (1 - amount))
  const b = Math.max(0, (hex & 0xff) * (1 - amount))
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}
