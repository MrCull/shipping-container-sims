// ---------------------------------------------------------------------------
// Box Empire — Container rendering with canvas-texture materials
// Each container is a THREE.Group with textured BoxGeometry + corner posts.
// Uses the same approach as stowage-master for realistic container appearance.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Container, TruckVisit } from '../types'
import {
  CONTAINER_LENGTH,
  CONTAINER_WIDTH,
  CONTAINER_HEIGHT,
} from './config'
import { createContainerMaterials, disposeContainerMaterials } from './containerMaterials'

const POST_SIZE = 0.10
const POST_COLOR = 0x2c313a

function addCornerPostsAndRails(group: THREE.Group, L: number, H: number, W: number): void {
  const postMat = new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: 0.65, metalness: 0.55 })
  const postGeo = new THREE.BoxGeometry(POST_SIZE, H * 0.97, POST_SIZE)
  const hL = L / 2 - POST_SIZE / 2
  const hW = W / 2 - POST_SIZE / 2
  for (const [px, pz] of [[hL, hW], [hL, -hW], [-hL, hW], [-hL, -hW]] as [number, number][]) {
    const p = new THREE.Mesh(postGeo, postMat)
    p.position.set(px, 0, pz)
    p.castShadow = true
    group.add(p)
  }

  const railT = 0.055
  const railMat = new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: 0.65, metalness: 0.55 })
  const railXGeo = new THREE.BoxGeometry(L * 0.984, railT, POST_SIZE * 0.88)
  const railZGeo = new THREE.BoxGeometry(POST_SIZE * 0.88, railT, W * 0.984)
  for (const y of [H / 2 - railT / 2, -H / 2 + railT / 2]) {
    for (const zSign of [-1, 1]) {
      const rx = new THREE.Mesh(railXGeo, railMat)
      rx.position.set(0, y, zSign * (W / 2 - POST_SIZE / 2))
      rx.castShadow = true
      group.add(rx)
    }
    for (const xSign of [-1, 1]) {
      const rz = new THREE.Mesh(railZGeo, railMat)
      rz.position.set(xSign * (L / 2 - POST_SIZE / 2), y, 0)
      rz.castShadow = true
      group.add(rz)
    }
  }
}

export function createContainerGroup(container: Container): THREE.Group {
  const L = CONTAINER_LENGTH
  const H = CONTAINER_HEIGHT
  const W = CONTAINER_WIDTH

  const group = new THREE.Group()
  group.name = `container-${container.id}`
  group.userData['containerId'] = container.id
  group.userData['isContainer'] = true

  const materials = createContainerMaterials(container.ownerColor, container.id, container.shippingLine)
  const geo = new THREE.BoxGeometry(L, H, W)
  const mesh = new THREE.Mesh(geo, materials)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData['bodyMaterials'] = materials
  group.add(mesh)

  // Subtle edge lines
  const edges = new THREE.EdgesGeometry(geo)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x08080c, transparent: true, opacity: 0.40 }),
  )
  group.add(line)

  addCornerPostsAndRails(group, L, H, W)
  return group
}

export class ContainerRenderer {
  private scene: THREE.Scene
  private groups = new Map<string, THREE.Group>()
  private containerIds: string[] = []

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  update(containers: Container[], trucks?: TruckVisit[]): void {
    const visibleContainers = containers.filter(c => {
      if (c.lifecycleState === 'departed') return false
      if (c.lifecycleState === 'on_vessel') return false
      if (c.lifecycleState === 'loaded_on_vessel') return false
      // Containers on trucks are rendered by TruckRenderer as children of the truck mesh
      if (c.currentLocation.type === 'truck') return false
      // Containers on equipment are rendered by EquipmentRenderer as children of the equipment mesh
      if (c.currentLocation.type === 'equipment') return false
      if (c.lifecycleState === 'returning_to_gate') return false
      if (c.lifecycleState === 'at_gate' && c.visitType === 'import') return false
      return true
    })

    const visibleIds = new Set(visibleContainers.map(c => c.id))
    this.containerIds = []

    // Remove departed containers
    for (const [id, group] of this.groups) {
      if (!visibleIds.has(id)) {
        this.disposeGroup(group)
        this.scene.remove(group)
        this.groups.delete(id)
      }
    }

    for (const c of visibleContainers) {
      this.containerIds.push(c.id)

      let group = this.groups.get(c.id)
      if (!group) {
        group = createContainerGroup(c)
        this.scene.add(group)
        this.groups.set(c.id, group)
      }

      // Position
      group.position.set(
        c.currentLocation.position.x,
        c.currentLocation.position.y,
        c.currentLocation.position.z,
      )

      // Rotation — align with truck heading when on a truck
      const onTruck = c.currentLocation.type === 'truck' ||
        c.lifecycleState === 'returning_to_gate' ||
        c.lifecycleState === 'at_gate'
      let rotY = 0
      if (onTruck && trucks) {
        const truckId = c.currentLocation.type === 'truck'
          ? c.currentLocation.id
          : trucks.find(t => t.containerId === c.id)?.id
        const truck = truckId ? trucks.find(t => t.id === truckId) : null
        rotY = truck ? truck.headingY + Math.PI / 2 : Math.PI / 2
      }
      group.rotation.y = rotY
    }
  }

  // Returns container ID closest to the given screen-space click
  getContainerIdNearScreen(
    clickX: number,
    clickY: number,
    canvasW: number,
    canvasH: number,
    camera: THREE.Camera,
    radiusPx: number = 45,
  ): string | null {
    const projected = new THREE.Vector3()
    let bestId: string | null = null
    let bestDist = radiusPx

    for (const [id, group] of this.groups) {
      projected.copy(group.position)
      projected.project(camera)

      if (projected.z > 1) continue

      const sx = (projected.x * 0.5 + 0.5) * canvasW
      const sy = (1 - (projected.y * 0.5 + 0.5)) * canvasH
      const dist = Math.sqrt((sx - clickX) ** 2 + (sy - clickY) ** 2)

      if (dist < bestDist) {
        bestDist = dist
        bestId = id
      }
    }

    return bestId
  }

  // Legacy compat for useThreeScene
  getMesh(): null { return null }
  getContainerIdAtIndex(): string | null { return null }

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
    for (const group of this.groups.values()) {
      this.disposeGroup(group)
      this.scene.remove(group)
    }
    this.groups.clear()
    this.containerIds = []
  }
}
