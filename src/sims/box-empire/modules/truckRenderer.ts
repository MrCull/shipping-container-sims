// ---------------------------------------------------------------------------
// Box Empire — Road truck mesh with GLB swap-in
// Uses truck-no-trailer.glb (pre-warmed at scene init); falls back to
// procedural geometry while the GLB loads, then swaps in automatically.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { TruckVisit, Container } from '../types'
import { CONTAINER_LENGTH, CONTAINER_WIDTH, CONTAINER_HEIGHT, TRUCK_GLB } from './config'
import { createContainerMaterials, disposeContainerMaterials } from './containerMaterials'
import { loadModel, getModelSync } from './modelLoader'

export const TRUCK_GLB_URL = new URL('../assets/models/truck-no-trailer.glb', import.meta.url).href

// Simple container mesh for rendering on truck bed (no corner posts, for performance)
function makeTruckContainerMesh(container: Container): THREE.Group {
  const group = new THREE.Group()
  group.name = 'truck-container'

  const mats = createContainerMaterials(container.ownerColor, container.id, container.shippingLine)
  const geo = new THREE.BoxGeometry(CONTAINER_LENGTH, CONTAINER_HEIGHT, CONTAINER_WIDTH)
  const mesh = new THREE.Mesh(geo, mats)
  mesh.castShadow = true
  mesh.userData['bodyMaterials'] = mats
  group.add(mesh)

  // Subtle edge lines
  const edges = new THREE.EdgesGeometry(geo)
  group.add(new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x08080c, transparent: true, opacity: 0.40 }),
  ))

  return group
}

/** Build a Three.js group from a cloned GLB root: scale, rotate, ground.
 *  Also adds a procedural flatbed chassis behind the cab so the container has a platform. */
function buildTruckGroupFromGLB(glbRoot: THREE.Group): THREE.Group {
  glbRoot.rotation.y = TRUCK_GLB.rotationY

  const box = new THREE.Box3().setFromObject(glbRoot)
  const size = new THREE.Vector3()
  box.getSize(size)
  // Scale so overall height matches target (preserves proportions)
  const scale = TRUCK_GLB.targetHeight / size.y
  glbRoot.scale.setScalar(scale)

  // Ground: shift so min.y sits at y=0
  const groundedBox = new THREE.Box3().setFromObject(glbRoot)
  glbRoot.position.y = -groundedBox.min.y

  const group = new THREE.Group()
  group.userData['isGlb'] = true
  group.add(glbRoot)

  // ── Procedural flatbed chassis (behind cab) ──────────────────────────────
  const chassisMat = new THREE.MeshPhongMaterial({ color: 0x1a1c20, specular: 0x222222, shininess: 20 })
  const deckH = 0.22
  // Main deck plate — slightly wider than container, centered at containerOffsetZ
  const deckPlate = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, deckH, CONTAINER_LENGTH + 1.2),
    chassisMat,
  )
  deckPlate.position.set(0, TRUCK_GLB.containerOffsetY - deckH / 2, TRUCK_GLB.containerOffsetZ)
  deckPlate.castShadow = true
  group.add(deckPlate)

  // Side rails
  for (const sx of [-1.22, 1.22]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.30, CONTAINER_LENGTH + 1.2), chassisMat)
    rail.position.set(sx, TRUCK_GLB.containerOffsetY - 0.04, TRUCK_GLB.containerOffsetZ)
    group.add(rail)
  }

  // Rear axle only (front axle omitted — looks out of proportion next to GLB cab wheels)
  const axleMat = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 10 })
  const rimMat  = new THREE.MeshPhongMaterial({ color: 0x888888, specular: 0xffffff, shininess: 90 })
  const rearSz = TRUCK_GLB.containerOffsetZ - CONTAINER_LENGTH / 2 + 0.8
  const tyreR = 0.66   // 0.88 reduced by half the increase (was 0.44→0.88, so −0.22)
  const tyreW = 0.72
  // sx kept within trailer half-width (1.25m): 0.85 + 0.36 = 1.21 < 1.25 ✓
  for (const sx of [-0.85, 0.85]) {
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(tyreR, tyreR, tyreW, 12), axleMat)
    tyre.rotation.z = Math.PI / 2
    tyre.position.set(sx, tyreR, rearSz)
    tyre.castShadow = true
    group.add(tyre)
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(tyreR * 0.52, tyreR * 0.52, tyreW + 0.04, 8), rimMat)
    rim.rotation.z = Math.PI / 2
    rim.position.set(sx, tyreR, rearSz)
    group.add(rim)
  }

  return group
}

export class TruckRenderer {
  private meshes = new Map<string, THREE.Group>()
  // Maps truckId → current container group attached to truck mesh
  private containerGroups = new Map<string, THREE.Group>()
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  /** Build GLB truck if cached, else fall back to procedural. */
  private createTruckMesh(visitType: 'import_pickup' | 'export_delivery'): THREE.Group {
    const cached = getModelSync(TRUCK_GLB_URL)
    if (cached) {
      return buildTruckGroupFromGLB(cached)
    }
    return this.buildProceduralTruckGroup(visitType)
  }

  /** Original procedural truck — used as fallback while GLB is loading. */
  private buildProceduralTruckGroup(visitType: 'import_pickup' | 'export_delivery'): THREE.Group {
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

  update(trucks: TruckVisit[], containers?: Container[]): void {
    const activeTrucks = trucks.filter(t => t.state !== 'departed')
    const activeTruckIds = new Set(activeTrucks.map(t => t.id))

    // Remove meshes for departed trucks
    for (const [id, mesh] of this.meshes) {
      if (!activeTruckIds.has(id)) {
        // Dispose attached container group
        const cg = this.containerGroups.get(id)
        if (cg) {
          this.disposeGroup(cg)
          this.containerGroups.delete(id)
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

        // Schedule async GLB swap if procedural was used (GLB not yet cached)
        if (!mesh.userData['isGlb']) {
          const truckId = truck.id
          loadModel(TRUCK_GLB_URL).then(glbRoot => {
            const existingMesh = this.meshes.get(truckId)
            if (!existingMesh) return // truck already departed

            // Dispose and remove all current children
            const oldChildren = [...existingMesh.children]
            oldChildren.forEach(c => {
              existingMesh.remove(c)
              c.traverse(obj => {
                const m = obj as THREE.Mesh
                if (m.geometry) m.geometry.dispose()
                if (m.material) {
                  if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
                  else m.material.dispose()
                }
              })
            })

            // Add GLB hull
            const glbGroup = buildTruckGroupFromGLB(glbRoot)
            glbGroup.children.slice().forEach(c => existingMesh.add(c))
            existingMesh.userData['isGlb'] = true

            // Force container to be re-placed at correct GLB deck height next update
            const existingCg = this.containerGroups.get(truckId)
            if (existingCg) {
              existingMesh.remove(existingCg)
              this.disposeGroup(existingCg)
              this.containerGroups.delete(truckId)
            }
          }).catch(e => console.warn('Box Empire: truck GLB swap failed', e))
        }
      }

      mesh.position.set(truck.position.x, 0, truck.position.z)
      mesh.rotation.y = truck.headingY

      // ---- Container attachment ----
      // Find the container this truck is carrying (on-truck or being collected).
      // Exclude containers currently held by equipment (RS picked them up).
      const carriedContainer = containers
        ? containers.find(c =>
          c.id === truck.containerId &&
          c.currentLocation.type !== 'equipment' &&
          (c.currentLocation.type === 'truck' ||
           c.lifecycleState === 'returning_to_gate' ||
           c.lifecycleState === 'at_gate'),
        )
        : null

      const existingCg = this.containerGroups.get(truck.id)

      if (carriedContainer) {
        // Add or update container on truck bed
        if (!existingCg || existingCg.userData['containerId'] !== carriedContainer.id) {
          // Remove old container group
          if (existingCg) {
            mesh.remove(existingCg)
            this.disposeGroup(existingCg)
          }
          const cg = makeTruckContainerMesh(carriedContainer)
          cg.userData['containerId'] = carriedContainer.id
          // Position on truck bed — use GLB deck height if GLB is loaded, else procedural height
          const deckY = mesh.userData['isGlb'] ? TRUCK_GLB.containerOffsetY : 0.72
          cg.position.set(0, deckY + CONTAINER_HEIGHT / 2, TRUCK_GLB.containerOffsetZ)
          // Container length aligns with truck forward (+Z) when rotation.y = 0 on group.
          // BoxGeometry L is along X, so rotate 90° around Y so L faces truck's Z
          cg.rotation.y = Math.PI / 2
          mesh.add(cg)
          this.containerGroups.set(truck.id, cg)
        }
      } else {
        // Remove container from truck if no longer carried
        if (existingCg) {
          mesh.remove(existingCg)
          this.disposeGroup(existingCg)
          this.containerGroups.delete(truck.id)
        }
      }
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse(obj => {
      const m = obj as THREE.Mesh
      if (!m.geometry) return
      const bodyMats = m.userData['bodyMaterials'] as THREE.MeshStandardMaterial[] | undefined
      if (bodyMats) disposeContainerMaterials(bodyMats)
      else if (m.material) {
        const mat = m.material
        if (Array.isArray(mat)) mat.forEach(x => x.dispose())
        else mat.dispose()
      }
      m.geometry.dispose()
    })
  }

  dispose(): void {
    for (const cg of this.containerGroups.values()) {
      this.disposeGroup(cg)
    }
    this.containerGroups.clear()
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
