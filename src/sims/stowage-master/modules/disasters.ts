import * as THREE from 'three'
import type { DisasterType, DisasterAnimation } from '../types'

interface ParticleSystem {
  points: THREE.Points
  velocities: Float32Array
  lifetimes: Float32Array
}

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
    const spread = type === 'explosion' ? 14 : 8
    velocities.set(mesh, {
      x: (Math.random() - 0.5) * spread,
      y: Math.random() * 7 + 2,
      z: (Math.random() - 0.5) * spread,
      rotX: (Math.random() - 0.5) * 6,
      rotY: (Math.random() - 0.5) * 6,
      rotZ: (Math.random() - 0.5) * 6,
    })
  })

  // Visual effects objects
  let fireball: THREE.Group | null = null
  let smokeCloud: THREE.Points | null = null
  let splashParticles: ParticleSystem | null = null
  let shockwave: THREE.Mesh | null = null

  if (type === 'explosion') {
    fireball = createFireballGroup(scene)
    smokeCloud = createSmokeCloud(scene)
    shockwave = createShockwave(scene)
  }

  if (type === 'capsize' || type === 'founder') {
    splashParticles = createSplashParticles(scene)
  }

  function update(deltaTime: number): boolean {
    if (completed) return true
    elapsed += deltaTime

    switch (type) {
      case 'capsize':
        animateCapsize(shipGroup, elapsed, duration, splashParticles, deltaTime)
        break
      case 'founder':
        animateFounder(shipGroup, elapsed, duration, splashParticles, deltaTime)
        break
      case 'collapse':
        animateCollapse(containerMeshes, velocities, elapsed, deltaTime)
        break
      case 'explosion':
        animateExplosion(
          shipGroup, containerMeshes, velocities,
          fireball, smokeCloud, shockwave,
          elapsed, deltaTime, duration
        )
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
    [fireball, shockwave].forEach(obj => {
      if (!obj) return
      scene.remove(obj)
      obj.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
          else mesh.material.dispose()
        }
      })
    })
    ;[smokeCloud, splashParticles?.points].forEach(obj => {
      if (!obj) return
      scene.remove(obj)
      obj.geometry.dispose()
      ;(obj.material as THREE.Material).dispose()
    })
  }

  return { update, cleanup }
}

function getDuration(type: DisasterType): number {
  switch (type) {
    case 'capsize': return 5
    case 'founder': return 5
    case 'collapse': return 4
    case 'explosion': return 6
  }
}

function animateCapsize(
  shipGroup: THREE.Group,
  elapsed: number,
  duration: number,
  splash: ParticleSystem | null,
  deltaTime: number
): void {
  const progress = Math.min(elapsed / duration, 1)
  const targetAngle = (75 * Math.PI) / 180
  // Acceleration: starts slow then tips fast
  const eased = easeInCubic(progress)
  shipGroup.rotation.z = eased * targetAngle
  shipGroup.position.y = -easeInQuad(progress) * 10

  if (splash && elapsed < 2) {
    animateSplashParticles(splash, deltaTime, elapsed)
  }
}

function animateFounder(
  shipGroup: THREE.Group,
  elapsed: number,
  duration: number,
  splash: ParticleSystem | null,
  deltaTime: number
): void {
  const progress = Math.min(elapsed / duration, 1)
  const eased = easeInCubic(progress)
  shipGroup.rotation.x = eased * (50 * Math.PI) / 180
  shipGroup.position.y = -eased * 12

  if (splash && elapsed < 2.5) {
    animateSplashParticles(splash, deltaTime, elapsed)
  }
}

function animateCollapse(
  containerMeshes: THREE.Object3D[],
  velocities: Map<THREE.Object3D, { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>,
  elapsed: number,
  deltaTime: number
): void {
  const gravity = -18
  for (const mesh of containerMeshes) {
    const vel = velocities.get(mesh)
    if (!vel) continue
    if (elapsed > 0.3) {
      vel.y += gravity * deltaTime
      mesh.position.x += vel.x * deltaTime
      mesh.position.y += vel.y * deltaTime
      mesh.position.z += vel.z * deltaTime
      mesh.rotation.x += vel.rotX * deltaTime
      mesh.rotation.y += vel.rotY * deltaTime
      mesh.rotation.z += vel.rotZ * deltaTime
      // Drag
      vel.x *= 0.98
      vel.z *= 0.98
    }
  }
}

function animateExplosion(
  shipGroup: THREE.Group,
  containerMeshes: THREE.Object3D[],
  velocities: Map<THREE.Object3D, { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>,
  fireball: THREE.Group | null,
  smokeCloud: THREE.Points | null,
  shockwave: THREE.Mesh | null,
  elapsed: number,
  deltaTime: number,
  duration: number
): void {
  // Phase 1: Explosion flash + fireball expand (0-0.8s)
  if (fireball) {
    const core = fireball.getObjectByName('fireball-core') as THREE.Mesh | undefined
    const outer = fireball.getObjectByName('fireball-outer') as THREE.Mesh | undefined
    if (elapsed < 0.8) {
      const scale = easeOutCubic(elapsed / 0.8) * 12
      if (core) {
        core.scale.setScalar(scale)
        ;(core.material as THREE.MeshBasicMaterial).opacity = 1 - elapsed / 0.8
      }
      if (outer) {
        outer.scale.setScalar(scale * 1.4)
        ;(outer.material as THREE.MeshBasicMaterial).opacity = 0.6 - elapsed / 0.8 * 0.6
      }
    } else {
      fireball.visible = false
    }
  }

  // Shockwave ring expands and fades
  if (shockwave && elapsed < 1.2) {
    const sp = elapsed / 1.2
    shockwave.scale.setScalar(1 + easeOutQuad(sp) * 25)
    ;(shockwave.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - sp)
  } else if (shockwave) {
    shockwave.visible = false
  }

  // Smoke cloud rises and expands (0.2s onward)
  if (smokeCloud && elapsed > 0.15) {
    const age = elapsed - 0.15
    smokeCloud.position.y = age * 4
    const sp = smokeCloud.material as THREE.PointsMaterial
    sp.size = 0.5 + age * 1.5
    sp.opacity = Math.max(0, 0.7 - age * 0.12)
  }

  // Containers fly starting at 0.15s
  if (elapsed > 0.15) {
    animateCollapse(containerMeshes, velocities, elapsed - 0.15, deltaTime)
  }

  // Ship sinks/lists after 1.8s
  if (elapsed > 1.8) {
    const sinkProgress = (elapsed - 1.8) / (duration - 1.8)
    shipGroup.position.y = -easeInQuad(sinkProgress) * 12
    shipGroup.rotation.z = easeInQuad(sinkProgress) * 0.4
  }
}

// ── Visual effect factories ────────────────────────────────────────────────────

function createFireballGroup(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group()
  group.position.set(0, 6, 0)

  // Core fireball
  const coreGeo = new THREE.SphereGeometry(1, 16, 16)
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 1,
  })
  const core = new THREE.Mesh(coreGeo, coreMat)
  core.name = 'fireball-core'
  group.add(core)

  // Outer bloom
  const outerGeo = new THREE.SphereGeometry(1.5, 16, 16)
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.6,
  })
  const outer = new THREE.Mesh(outerGeo, outerMat)
  outer.name = 'fireball-outer'
  group.add(outer)

  // White-hot center flash
  const flashGeo = new THREE.SphereGeometry(0.6, 12, 12)
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  })
  const flash = new THREE.Mesh(flashGeo, flashMat)
  flash.name = 'fireball-flash'
  group.add(flash)

  scene.add(group)
  return group
}

function createSmokeCloud(scene: THREE.Scene): THREE.Points {
  const count = 180
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = Math.random() * 5
    const theta = Math.random() * Math.PI * 2
    positions[i * 3] = Math.cos(theta) * r
    positions[i * 3 + 1] = Math.random() * 6
    positions[i * 3 + 2] = Math.sin(theta) * r
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0x333333,
    size: 0.8,
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: true,
  })
  const cloud = new THREE.Points(geo, mat)
  cloud.position.set(0, 3, 0)
  scene.add(cloud)
  return cloud
}

function createShockwave(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.5, 1.5, 32)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  })
  const ring = new THREE.Mesh(geo, mat)
  ring.rotation.x = -Math.PI / 2
  ring.position.set(0, 0.5, 0)
  scene.add(ring)
  return ring
}

function createSplashParticles(scene: THREE.Scene): ParticleSystem {
  const count = 200
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const lifetimes = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const r = 3 + Math.random() * 10
    positions[i * 3] = Math.cos(theta) * r
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = Math.sin(theta) * r
    velocities[i * 3] = Math.cos(theta) * (1 + Math.random() * 3)
    velocities[i * 3 + 1] = 3 + Math.random() * 5
    velocities[i * 3 + 2] = Math.sin(theta) * (1 + Math.random() * 3)
    lifetimes[i] = 0.3 + Math.random() * 1.5
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xaaddff,
    size: 0.45,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geo, mat)
  scene.add(points)
  return { points, velocities, lifetimes }
}

function animateSplashParticles(sys: ParticleSystem, dt: number, elapsed: number): void {
  const pos = sys.points.geometry.attributes.position as THREE.BufferAttribute
  const gravity = -12
  let anyAlive = false

  for (let i = 0; i < pos.count; i++) {
    sys.lifetimes[i] -= dt
    if (sys.lifetimes[i] > 0) {
      anyAlive = true
      sys.velocities[i * 3 + 1] += gravity * dt
      pos.setX(i, pos.getX(i) + sys.velocities[i * 3] * dt)
      pos.setY(i, pos.getY(i) + sys.velocities[i * 3 + 1] * dt)
      pos.setZ(i, pos.getZ(i) + sys.velocities[i * 3 + 2] * dt)
    } else {
      pos.setY(i, -999) // park off-screen
    }
  }
  pos.needsUpdate = true

  const mat = sys.points.material as THREE.PointsMaterial
  mat.opacity = Math.max(0, 0.8 - elapsed * 0.4)

  if (!anyAlive) {
    mat.opacity = 0
  }
}

// ── Easing helpers ─────────────────────────────────────────────────────────────

function easeInCubic(t: number): number { return t * t * t }
function easeInQuad(t: number): number { return t * t }
function easeOutQuad(t: number): number { return 1 - (1 - t) * (1 - t) }
function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3) }
