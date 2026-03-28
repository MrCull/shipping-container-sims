// ---------------------------------------------------------------------------
// Box Empire — Ocean mesh registration + vertex animation (used by render loop)
// ---------------------------------------------------------------------------

import * as THREE from 'three'

let oceanMesh: THREE.Mesh | null = null

export function registerOceanMesh(mesh: THREE.Mesh): void {
  oceanMesh = mesh
}

export function getOcean(): THREE.Mesh | null {
  return oceanMesh
}

export function animateOcean(time: number): void {
  if (!oceanMesh) return
  const pos = oceanMesh.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const wave =
      Math.sin(x * 0.04 + time * 0.7) * 0.40 +
      Math.cos(z * 0.05 + time * 0.55) * 0.28 +
      Math.sin(x * 0.09 - z * 0.06 + time * 1.1) * 0.16
    pos.setY(i, wave)
  }
  pos.needsUpdate = true
  oceanMesh.geometry.computeVertexNormals()
}
