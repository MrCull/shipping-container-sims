import * as THREE from 'three'
import type { JengaContainer, LayerOrientation } from '../types'
import { BLOCK } from './config'

export interface ContainerMeshUserData {
  containerId: string
  layerIndex: number
  slotIndex: number
  isJengaBlock: true
}

export function createContainerMesh(
  container: JengaContainer,
  orientation: LayerOrientation
): THREE.Group {
  const group = new THREE.Group()
  const w = BLOCK.width
  const h = BLOCK.height
  const len = BLOCK.length

  const geo =
    orientation === 'alongX'
      ? new THREE.BoxGeometry(w, h, len)
      : new THREE.BoxGeometry(len, h, w)

  const mat = new THREE.MeshStandardMaterial({
    color: container.color,
    roughness: 0.42,
    metalness: 0.32,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData = {
    containerId: container.id,
    layerIndex: container.layerIndex,
    slotIndex: container.slotIndex,
    isJengaBlock: true,
  } satisfies ContainerMeshUserData

  const edges = new THREE.EdgesGeometry(geo)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
  )
  group.add(mesh)
  group.add(line)

  group.userData = mesh.userData
  return group
}

export function setContainerHighlight(group: THREE.Group, on: boolean): void {
  const mesh = group.children[0] as THREE.Mesh | undefined
  if (!mesh || !mesh.material || Array.isArray(mesh.material)) return
  const m = mesh.material as THREE.MeshStandardMaterial
  if (on) {
    m.emissive.setHex(0x444444)
    m.emissiveIntensity = 0.45
  } else {
    m.emissive.setHex(0x000000)
    m.emissiveIntensity = 0
  }
}
