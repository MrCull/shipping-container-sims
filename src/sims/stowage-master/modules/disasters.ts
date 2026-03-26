import * as THREE from 'three'
import type { DisasterType, DisasterAnimation } from '../types'

export function createDisasterAnimation(
  type: DisasterType,
  shipGroup: THREE.Group,
  scene: THREE.Scene,
  onComplete: () => void
): DisasterAnimation {
  const containerMeshes: THREE.Object3D[] = []
  shipGroup.traverse(child => {
    if (child.userData && child.userData['isContainer']) {
      containerMeshes.push(child)
    }
  })

  let elapsed = 0
  let completed = false
  const duration = getDuration(type)

  const velocities = new Map<THREE.Object3D, {
    x: number; y: number; z: number
    rotX: number; rotY: number; rotZ: number
  }>()

  containerMeshes.forEach(mesh => {
    velocities.set(mesh, {
      x: (Math.random() - 0.5) * 8,
      y: Math.random() * 6 + 2,
      z: (Math.random() - 0.5) * 8,
      rotX: (Math.random() - 0.5) * 5,
      rotY: (Math.random() - 0.5) * 5,
      rotZ: (Math.random() - 0.5) * 5,
    })
  })

  let fireball: THREE.Mesh | null = null
  if (type === 'explosion') {
    fireball = createFireball(scene)
  }

  function update(deltaTime: number): boolean {
    if (completed) return true
    elapsed += deltaTime

    switch (type) {
      case 'capsize':
        animateCapsize(shipGroup, elapsed, duration)
        break
      case 'founder':
        animateFounder(shipGroup, elapsed, duration)
        break
      case 'collapse':
        animateCollapse(containerMeshes, velocities, elapsed, deltaTime)
        break
      case 'explosion':
        animateExplosion(shipGroup, containerMeshes, velocities, fireball, elapsed, deltaTime, duration)
        break
    }

    if (elapsed >= duration) {
      completed = true
      onComplete()
      return true
    }
    return false
  }

  function cleanup(): void {
    if (fireball) {
      scene.remove(fireball)
      fireball.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
          else mesh.material.dispose()
        }
      })
    }
  }

  return { update, cleanup }
}

function getDuration(type: DisasterType): number {
  switch (type) {
    case 'capsize': return 4
    case 'founder': return 4
    case 'collapse': return 3
    case 'explosion': return 5
  }
}

function animateCapsize(shipGroup: THREE.Group, elapsed: number, duration: number): void {
  const progress = Math.min(elapsed / duration, 1)
  const targetAngle = (60 * Math.PI) / 180
  shipGroup.rotation.z = easeInQuad(progress) * targetAngle
  shipGroup.position.y = -easeInQuad(progress) * 8
}

function animateFounder(shipGroup: THREE.Group, elapsed: number, duration: number): void {
  const progress = Math.min(elapsed / duration, 1)
  const targetAngle = (45 * Math.PI) / 180
  shipGroup.rotation.x = easeInQuad(progress) * targetAngle
  shipGroup.position.y = -easeInQuad(progress) * 10
}

function animateCollapse(
  containerMeshes: THREE.Object3D[],
  velocities: Map<THREE.Object3D, { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>,
  elapsed: number,
  deltaTime: number
): void {
  const gravity = -15
  for (const mesh of containerMeshes) {
    const vel = velocities.get(mesh)
    if (!vel) continue
    if (elapsed > 0.5) {
      vel.y += gravity * deltaTime
      mesh.position.x += vel.x * deltaTime
      mesh.position.y += vel.y * deltaTime
      mesh.position.z += vel.z * deltaTime
      mesh.rotation.x += vel.rotX * deltaTime
      mesh.rotation.y += vel.rotY * deltaTime
      mesh.rotation.z += vel.rotZ * deltaTime
    }
  }
}

function animateExplosion(
  shipGroup: THREE.Group,
  containerMeshes: THREE.Object3D[],
  velocities: Map<THREE.Object3D, { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>,
  fireball: THREE.Mesh | null,
  elapsed: number,
  deltaTime: number,
  duration: number
): void {
  if (fireball) {
    if (elapsed < 1.5) {
      const scale = easeOutQuad(elapsed / 1.5) * 8
      fireball.scale.setScalar(scale)
      ;(fireball.material as THREE.MeshBasicMaterial).opacity = 1 - elapsed / 1.5
    } else {
      fireball.visible = false
    }
  }

  if (elapsed > 0.3) {
    animateCollapse(containerMeshes, velocities, elapsed - 0.3, deltaTime)
  }

  if (elapsed > 1.5) {
    const sinkProgress = (elapsed - 1.5) / (duration - 1.5)
    shipGroup.position.y = -easeInQuad(sinkProgress) * 10
    shipGroup.rotation.z = easeInQuad(sinkProgress) * 0.3
  }
}

function createFireball(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 16, 16)
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 1 })
  const fireball = new THREE.Mesh(geo, mat)
  fireball.position.set(0, 5, 0)
  scene.add(fireball)

  const glowGeo = new THREE.SphereGeometry(1.5, 16, 16)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 })
  const glow = new THREE.Mesh(glowGeo, glowMat)
  fireball.add(glow)

  return fireball
}

function easeInQuad(t: number): number { return t * t }
function easeOutQuad(t: number): number { return 1 - (1 - t) * (1 - t) }
