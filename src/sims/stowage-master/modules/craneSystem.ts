import * as THREE from 'three'
import type { CraneObject } from '../types'
import { CRANE, CONTAINER } from './config'

export function createCrane(scene: THREE.Scene, shipConfig: { width: number; length: number }): CraneObject {
  const group = new THREE.Group()
  group.name = 'crane'

  const towerHeight = CRANE.towerHeight
  const towerColor = 0xddaa00
  const metalColor = 0x888888

  const legGeo = new THREE.BoxGeometry(1, towerHeight, 1)
  const legMat = new THREE.MeshPhongMaterial({ color: towerColor })
  const leftLeg = new THREE.Mesh(legGeo, legMat)
  leftLeg.position.set(0, towerHeight / 2, -shipConfig.width / 2 - CRANE.dockOffset)
  leftLeg.castShadow = true
  group.add(leftLeg)

  const rightLeg = new THREE.Mesh(legGeo, legMat)
  rightLeg.position.set(0, towerHeight / 2, shipConfig.width / 2 + CRANE.dockOffset)
  rightLeg.castShadow = true
  group.add(rightLeg)

  const boomLength = shipConfig.width + CRANE.boomOverhang * 2
  const braceGeo = new THREE.BoxGeometry(1.5, 1.5, boomLength + CRANE.dockOffset * 2)
  const brace = new THREE.Mesh(braceGeo, legMat)
  brace.position.set(0, towerHeight, 0)
  brace.castShadow = true
  group.add(brace)

  const boomGeo = new THREE.BoxGeometry(boomLength, 0.8, 1.2)
  const boomMat = new THREE.MeshPhongMaterial({ color: metalColor })
  const boom = new THREE.Mesh(boomGeo, boomMat)
  boom.position.set(0, towerHeight + 1.5, 0)
  boom.rotation.y = Math.PI / 2
  boom.castShadow = true
  group.add(boom)

  const trolleyGeo = new THREE.BoxGeometry(1.5, 0.6, 1.5)
  const trolleyMat = new THREE.MeshPhongMaterial({ color: 0x555555 })
  const trolley = new THREE.Mesh(trolleyGeo, trolleyMat)
  trolley.position.set(0, towerHeight + 0.5, -shipConfig.width / 2 - CRANE.dockOffset)
  trolley.name = 'trolley'
  group.add(trolley)

  const spreaderGeo = new THREE.BoxGeometry(CRANE.spreaderWidth, 0.15, CRANE.spreaderWidth)
  const spreaderMat = new THREE.MeshPhongMaterial({ color: 0xcc0000, emissive: 0x440000 })
  const spreader = new THREE.Mesh(spreaderGeo, spreaderMat)
  spreader.position.set(0, towerHeight - 2, -shipConfig.width / 2 - CRANE.dockOffset)
  spreader.name = 'spreader'
  group.add(spreader)

  const cableOffsets: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
  const cables: THREE.Mesh[] = []
  for (const [dx, dz] of cableOffsets) {
    const cableGeo = new THREE.CylinderGeometry(0.02, 0.02, 2.5, 4)
    const cableMat = new THREE.MeshPhongMaterial({ color: 0x222222 })
    const cable = new THREE.Mesh(cableGeo, cableMat)
    cable.position.set(
      trolley.position.x + dx,
      towerHeight - 0.75,
      trolley.position.z + dz
    )
    cable.name = 'cable'
    cables.push(cable)
    group.add(cable)
  }

  scene.add(group)

  return {
    group,
    trolley,
    spreader,
    cables,
    dockZ: -shipConfig.width / 2 - CRANE.dockOffset,
    towerHeight,
  }
}

export function getDockPosition(crane: CraneObject): THREE.Vector3 {
  return new THREE.Vector3(0, crane.towerHeight - 3, crane.dockZ)
}

export function createPlacementAnimation(
  crane: CraneObject,
  containerMesh: THREE.Group,
  targetPosition: THREE.Vector3,
  shipGroup: THREE.Group,
  onComplete: () => void
): (deltaTime: number) => boolean {
  let currentPhase = 0
  const speed = 15 * CRANE.animationSpeed

  const startPos = new THREE.Vector3().copy(containerMesh.position)
  const aboveTarget = new THREE.Vector3(
    targetPosition.x,
    crane.towerHeight - 3,
    targetPosition.z
  )
  const finalTarget = new THREE.Vector3().copy(targetPosition)

  let t = 0

  function update(deltaTime: number): boolean {
    t += deltaTime * speed

    if (currentPhase === 0) {
      const progress = Math.min(t / getDistance(startPos, aboveTarget), 1)
      const eased = easeInOutCubic(progress)
      containerMesh.position.lerpVectors(startPos, aboveTarget, eased)

      crane.trolley.position.z = THREE.MathUtils.lerp(crane.dockZ, targetPosition.z, eased)
      crane.trolley.position.x = THREE.MathUtils.lerp(0, targetPosition.x, eased)
      crane.spreader.position.z = crane.trolley.position.z
      crane.spreader.position.x = crane.trolley.position.x

      updateCables(crane)

      if (progress >= 1) { currentPhase = 1; t = 0 }

    } else if (currentPhase === 1) {
      const dist = aboveTarget.y - finalTarget.y
      const progress = Math.min(t / dist, 1)
      const eased = easeInOutQuad(progress)
      containerMesh.position.y = THREE.MathUtils.lerp(aboveTarget.y, finalTarget.y, eased)
      containerMesh.position.x = finalTarget.x
      containerMesh.position.z = finalTarget.z

      crane.spreader.position.y = THREE.MathUtils.lerp(
        crane.towerHeight - 2,
        finalTarget.y + CONTAINER.size.y,
        eased
      )
      updateCables(crane)

      if (progress >= 1) {
        const worldPos = new THREE.Vector3()
        containerMesh.getWorldPosition(worldPos)
        containerMesh.removeFromParent()
        shipGroup.add(containerMesh)
        shipGroup.worldToLocal(worldPos)
        containerMesh.position.copy(worldPos)

        currentPhase = 2
        t = 0
      }

    } else if (currentPhase === 2) {
      const progress = Math.min(t / 8, 1)
      const eased = easeInOutCubic(progress)
      crane.trolley.position.z = THREE.MathUtils.lerp(targetPosition.z, crane.dockZ, eased)
      crane.trolley.position.x = THREE.MathUtils.lerp(targetPosition.x, 0, eased)
      crane.spreader.position.z = crane.trolley.position.z
      crane.spreader.position.x = crane.trolley.position.x
      crane.spreader.position.y = THREE.MathUtils.lerp(
        finalTarget.y + CONTAINER.size.y,
        crane.towerHeight - 2,
        eased
      )
      updateCables(crane)

      if (progress >= 1) {
        onComplete()
        return true
      }
    }

    return false
  }

  return update
}

function updateCables(crane: CraneObject): void {
  const trolleyPos = crane.trolley.position
  const spreaderPos = crane.spreader.position
  const cableOffsets: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]

  crane.cables.forEach((cable, i) => {
    const [dx, dz] = cableOffsets[i]
    const midY = (trolleyPos.y + spreaderPos.y) / 2
    const length = trolleyPos.y - spreaderPos.y
    cable.position.set(trolleyPos.x + dx, midY, trolleyPos.z + dz)
    cable.scale.y = Math.max(0.1, length / 2.5)
  })
}

function getDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.max(a.distanceTo(b) * 0.15, 1)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
