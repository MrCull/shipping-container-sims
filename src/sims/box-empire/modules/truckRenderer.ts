// ---------------------------------------------------------------------------
// Box Empire — Road truck mesh (improved quality, inspired by stowage-master)
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { TruckVisit } from '../types'

export class TruckRenderer {
  private meshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private createTruckMesh(visitType: 'import_pickup' | 'export_delivery'): THREE.Group {
    const group = new THREE.Group()

    // Colour palette by visit type
    const cabColors = visitType === 'export_delivery'
      ? [0xe74c3c, 0x27ae60, 0x2980b9, 0xe67e22, 0x8e44ad]
      : [0x1a6ba0, 0x1a9060, 0x8e44ad, 0x16a085, 0x2c3e50]
    const cabColor = cabColors[Math.floor(Math.random() * cabColors.length)]

    const cabMat    = new THREE.MeshPhongMaterial({ color: cabColor, specular: 0x442211, shininess: 55 })
    const darkMat   = new THREE.MeshPhongMaterial({ color: 0x1a1c20, specular: 0x222222, shininess: 18 })
    const glassMat  = new THREE.MeshPhongMaterial({ color: 0x88ccff, emissive: 0x224466, emissiveIntensity: 0.35, specular: 0xaaddff, shininess: 180, transparent: true, opacity: 0.72 })
    const chromeMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, specular: 0xffffff, shininess: 140 })
    const tireMat   = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 10 })
    const rimMat    = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, specular: 0xffffff, shininess: 100 })
    const lightMat  = new THREE.MeshPhongMaterial({ color: 0xffffaa, emissive: 0x886600, emissiveIntensity: 0.6 })

    // ---- Chassis frame -----------------------------------------------
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.28, 7.5), darkMat)
    chassis.position.set(0, 0.56, -0.5); chassis.castShadow = true; group.add(chassis)

    // Side rails
    for (const sign of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.48, 0.12), darkMat)
      rail.position.set(0, 0.58, sign * 1.22); group.add(rail)
    }

    // Fifth-wheel / saddle coupling
    const saddle = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.20, 12), new THREE.MeshPhongMaterial({ color: 0x555555, specular: 0x888888, shininess: 60 }))
    saddle.position.set(0, 0.82, 0.35); group.add(saddle)

    // ---- Cab body -------------------------------------------------------
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.36, 2.2, 2.8), cabMat)
    cab.position.set(0, 1.78, 2.1); cab.castShadow = true; group.add(cab)

    // Cab roof with slight overhang
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.45, 2.55), new THREE.MeshPhongMaterial({ color: darken(cabColor, 0.15), shininess: 45 }))
    roof.position.set(0, 3.05, 2.0); roof.castShadow = true; group.add(roof)

    // Windscreen
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.07), glassMat)
    windscreen.position.set(0, 2.25, 3.53); group.add(windscreen)

    // Side windows
    for (const sx of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 1.1), glassMat)
      sw.position.set(sx * 1.2, 2.20, 1.8); group.add(sw)
    }

    // Front grille panel
    const grille = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.62, 0.15), darkMat)
    grille.position.set(0, 1.14, 3.52); group.add(grille)

    // Bumper
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.26, 0.22), chromeMat)
    bumper.position.set(0, 0.56, 3.52); group.add(bumper)

    // Headlights
    for (const sx of [-0.72, 0.72]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.30, 0.07), lightMat)
      hl.position.set(sx, 1.14, 3.60); group.add(hl)
    }

    // Exhaust stack (export trucks)
    if (visitType === 'export_delivery') {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 1.3, 8), chromeMat)
      stack.position.set(-0.95, 3.85, 1.5); group.add(stack)
    }

    // ---- Wheels (4 axles) -----------------------------------------------
    const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.36, 16)
    const rimGeo   = new THREE.CylinderGeometry(0.23, 0.23, 0.39, 8)

    // Front steer axle
    for (const sx of [-1.27, 1.27]) {
      const t = new THREE.Mesh(wheelGeo, tireMat); t.rotation.z = Math.PI / 2
      t.position.set(sx, 0.44, 2.4); t.castShadow = true; group.add(t)
      const r = new THREE.Mesh(rimGeo, rimMat); r.rotation.z = Math.PI / 2
      r.position.set(sx, 0.44, 2.4); group.add(r)
    }

    // Rear drive axles (dual-wheel)
    for (const sz of [-0.9, -2.0]) {
      for (const sx of [-1.32, 1.32]) {
        const t = new THREE.Mesh(wheelGeo, tireMat); t.rotation.z = Math.PI / 2
        t.position.set(sx, 0.44, sz); t.castShadow = true; group.add(t)
        const r = new THREE.Mesh(rimGeo, rimMat); r.rotation.z = Math.PI / 2
        r.position.set(sx, 0.44, sz); group.add(r)
      }
    }

    return group
  }

  update(trucks: TruckVisit[]): void {
    const activeTrucks = trucks.filter(t => t.state !== 'departed')
    const activeTruckIds = new Set(activeTrucks.map(t => t.id))

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
      mesh.rotation.y = truck.headingY
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
