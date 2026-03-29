// ---------------------------------------------------------------------------
// Box Empire — Ocean mesh registration + vertex animation (used by render loop)
// ---------------------------------------------------------------------------

import * as THREE from 'three'

let oceanMesh: THREE.Mesh | null = null
let foamPoints: THREE.Points | null = null

export function registerOceanMesh(mesh: THREE.Mesh): void {
  oceanMesh = mesh
}

export function getOcean(): THREE.Mesh | null {
  return oceanMesh
}

// ---- Foam particle system --------------------------------------------------

export function createFoamParticles(scene: THREE.Scene): void {
  const count = 350
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 160   // x spread
    positions[i * 3 + 1] = -0.15 + Math.random() * 0.25  // y near surface
    positions[i * 3 + 2] = -20 - Math.random() * 140     // z: out to sea
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xddeeff,
    size: 0.40,
    transparent: true,
    opacity: 0.50,
    sizeAttenuation: true,
  })
  foamPoints = new THREE.Points(geo, mat)
  foamPoints.name = 'foam'
  scene.add(foamPoints)
}

export function animateFoam(time: number): void {
  if (!foamPoints) return
  const pos = foamPoints.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, -0.15 + Math.abs(Math.sin(x * 0.28 + time * 1.1) * Math.cos(z * 0.35 + time * 0.85)) * 0.42)
  }
  pos.needsUpdate = true
}

// ---- Ocean wave animation --------------------------------------------------

export function animateOcean(time: number): void {
  if (!oceanMesh) return
  const pos = oceanMesh.geometry.attributes.position as THREE.BufferAttribute
  // PlaneGeometry rotated flat (rotation.x = -π/2):
  //   local X  →  world X   (unchanged)
  //   local Y  →  world -Z  (the depth/spread of the plane)
  //   local Z  →  world Y   (vertical height — this is what we animate)
  // So we read local X and local Y for wave sampling, and write local Z for height.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)   // local X = world X
    const z = pos.getY(i)   // local Y = world -Z (depth)
    const wave =
      Math.sin(x * 0.04 + time * 0.70) * 0.45 +
      Math.cos(z * 0.05 + time * 0.55) * 0.30 +
      Math.sin(x * 0.09 - z * 0.06 + time * 1.10) * 0.18 +
      Math.cos(x * 0.02 + z * 0.03 + time * 0.35) * 0.22   // gentle long swell
    pos.setZ(i, wave)        // local Z = world Y (vertical displacement)
  }
  pos.needsUpdate = true
  oceanMesh.geometry.computeVertexNormals()
}
