import * as THREE from 'three'
import { BLOCK } from './config'
import type { PlacementCandidate } from './towerBuilder'

export interface PlacementMarkerUserData {
  isPlacementMarker: true
  slotIndex: number
}

export function createPlacementMarker(
  candidate: PlacementCandidate,
  highlight: boolean
): THREE.Group {
  const group = new THREE.Group()
  const w = BLOCK.width
  const h = BLOCK.height * 0.08
  const len = BLOCK.length

  const geo =
    candidate.orientation === 'alongX'
      ? new THREE.BoxGeometry(w * 0.92, h, len * 0.92)
      : new THREE.BoxGeometry(len * 0.92, h, w * 0.92)

  const mat = new THREE.MeshStandardMaterial({
    color: highlight ? 0x4ade80 : 0x22c55e,
    emissive: highlight ? 0x14532d : 0x052e16,
    emissiveIntensity: highlight ? 0.55 : 0.25,
    transparent: true,
    opacity: highlight ? 0.92 : 0.55,
    metalness: 0.2,
    roughness: 0.45,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = h / 2
  mesh.userData = {
    isPlacementMarker: true,
    slotIndex: candidate.slotIndex,
  } satisfies PlacementMarkerUserData

  group.add(mesh)
  group.position.copy(candidate.position)
  group.userData = mesh.userData
  return group
}
