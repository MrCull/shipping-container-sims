import * as THREE from 'three'
import type { CraneObject } from '../types'
import { CRANE, CONTAINER } from './config'

// More realistic STS (ship-to-shore) quay crane
export function createCrane(scene: THREE.Scene, shipConfig: { width: number; length: number }): CraneObject {
  const group = new THREE.Group()
  group.name = 'crane'

  const towerHeight = CRANE.towerHeight
  const craneYellow = 0xe8c200
  const steelGrey = 0x778899
  const darkMetal = 0x3a3a42

  // ── Portal frame (A-frame legs on rails) ────────────────────────────────────
  const seaLegZ = -(shipConfig.width / 2 + CRANE.dockOffset + 1)
  const landLegZ = seaLegZ - 8

  // Sea-side A-frame (two legs converging)
  addAFrameLegs(group, seaLegZ, towerHeight, craneYellow, 3.5)
  // Land-side A-frame
  addAFrameLegs(group, landLegZ, towerHeight * 0.85, craneYellow, 2.8)

  // Cross-bracing between sea-legs and land-legs
  addCrossBracing(group, seaLegZ, landLegZ, towerHeight, steelGrey)

  // ── Operator cab ─────────────────────────────────────────────────────────────
  const cabGeo = new THREE.BoxGeometry(3.5, 2.2, 2.5)
  const cabMat = new THREE.MeshPhongMaterial({ color: craneYellow, shininess: 40 })
  const cab = new THREE.Mesh(cabGeo, cabMat)
  cab.position.set(0, towerHeight + 1.0, seaLegZ - 0.5)
  cab.castShadow = true
  group.add(cab)

  // Cab windows
  const winGeo = new THREE.BoxGeometry(0.1, 1.2, 2.0)
  const winMat = new THREE.MeshPhongMaterial({
    color: 0x88bbdd,
    emissive: 0x224466,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.8,
    shininess: 150,
  })
  const win = new THREE.Mesh(winGeo, winMat)
  win.position.set(1.8, towerHeight + 1.0, seaLegZ - 0.5)
  group.add(win)

  // ── Main boom (extends over ship) ─────────────────────────────────────────────
  const boomLength = shipConfig.width + CRANE.boomOverhang * 2 + 10
  const boomGeo = new THREE.BoxGeometry(boomLength, 1.1, 1.5)
  const boomMat = new THREE.MeshPhongMaterial({ color: steelGrey, shininess: 55 })
  const boom = new THREE.Mesh(boomGeo, boomMat)
  boom.position.set(0, towerHeight + 2.0, seaLegZ - boomLength * 0.0)
  boom.rotation.y = Math.PI / 2
  boom.castShadow = true
  group.add(boom)

  // ── Backstay boom (landward) ────────────────────────────────────────────────
  const backstayLen = boomLength * 0.5
  const backstayGeo = new THREE.BoxGeometry(backstayLen, 0.9, 1.2)
  const backstay = new THREE.Mesh(backstayGeo, boomMat)
  backstay.rotation.y = Math.PI / 2
  backstay.position.set(0, towerHeight + 1.5, landLegZ - backstayLen * 0.0)
  group.add(backstay)

  // ── Topping rope from top of mast to end of boom ─────────────────────────────
  addToppingRope(group, towerHeight, seaLegZ)

  // ── Trolley ──────────────────────────────────────────────────────────────────
  const trolleyGeo = new THREE.BoxGeometry(1.8, 0.8, 1.8)
  const trolleyMat = new THREE.MeshPhongMaterial({ color: darkMetal, shininess: 45 })
  const trolley = new THREE.Mesh(trolleyGeo, trolleyMat)
  trolley.position.set(0, towerHeight + 1.0, seaLegZ)
  trolley.name = 'trolley'
  group.add(trolley)

  // ── Spreader ──────────────────────────────────────────────────────────────────
  const spreaderGeo = new THREE.BoxGeometry(CRANE.spreaderWidth * 1.4, 0.2, CRANE.spreaderWidth + 0.3)
  const spreaderMat = new THREE.MeshPhongMaterial({
    color: 0xcc2200,
    emissive: 0x660000,
    emissiveIntensity: 0.25,
    shininess: 55,
  })
  const spreader = new THREE.Mesh(spreaderGeo, spreaderMat)
  spreader.position.set(0, towerHeight - 2.5, seaLegZ)
  spreader.name = 'spreader'
  group.add(spreader)

  // Spreader twist-locks (corner pins)
  const lockGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.35, 8)
  const lockMat = new THREE.MeshPhongMaterial({ color: 0xffaa00, shininess: 80 })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lock = new THREE.Mesh(lockGeo, lockMat)
      lock.position.set(
        spreader.position.x + sx * CRANE.spreaderWidth * 0.65,
        spreader.position.y - 0.26,
        spreader.position.z + sz * CRANE.spreaderWidth * 0.5
      )
      lock.name = 'twist-lock'
      group.add(lock)
    }
  }

  // ── Hoist cables ─────────────────────────────────────────────────────────────
  const cables: THREE.Mesh[] = []
  const cableOffsets: [number, number][] = [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]]
  for (const [dx, dz] of cableOffsets) {
    const cableGeo = new THREE.CylinderGeometry(0.025, 0.025, 3.0, 6)
    const cableMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 30 })
    const cable = new THREE.Mesh(cableGeo, cableMat)
    cable.position.set(
      trolley.position.x + dx,
      towerHeight - 1.5,
      trolley.position.z + dz
    )
    cable.name = 'cable'
    cables.push(cable)
    group.add(cable)
  }

  // ── Warning light on top of mast ─────────────────────────────────────────────
  const lightGeo = new THREE.SphereGeometry(0.35, 10, 8)
  const lightMat = new THREE.MeshPhongMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 1.5,
  })
  const warningLight = new THREE.Mesh(lightGeo, lightMat)
  warningLight.position.set(0, towerHeight + 8, seaLegZ - 4)
  warningLight.name = 'warning-light'
  group.add(warningLight)

  scene.add(group)

  return {
    group,
    trolley,
    spreader,
    cables,
    dockZ: seaLegZ,
    towerHeight,
  }
}

function addAFrameLegs(
  parent: THREE.Group,
  centerZ: number,
  height: number,
  color: number,
  spread: number
): void {
  const legMat = new THREE.MeshPhongMaterial({ color, shininess: 30 })

  for (const sign of [-1, 1]) {
    // Outer leg — inclined
    const legGeo = new THREE.BoxGeometry(1.1, height, 1.1)
    const leg = new THREE.Mesh(legGeo, legMat)
    leg.position.set(0, height / 2, centerZ + sign * spread * 0.5)
    // Slight inward lean
    leg.rotation.z = sign * 0.05
    leg.castShadow = true
    parent.add(leg)

    // Rail truck at base
    const truckGeo = new THREE.BoxGeometry(3, 0.7, 2)
    const truckMat = new THREE.MeshPhongMaterial({ color: 0x333333 })
    const truck = new THREE.Mesh(truckGeo, truckMat)
    truck.position.set(0, 0.35, centerZ + sign * spread * 0.5)
    parent.add(truck)
  }

  // Cross-brace at top
  const braceGeo = new THREE.BoxGeometry(1.3, 1.3, spread + 1)
  const braceMat = new THREE.MeshPhongMaterial({ color, shininess: 30 })
  const brace = new THREE.Mesh(braceGeo, braceMat)
  brace.position.set(0, height, centerZ)
  brace.castShadow = true
  parent.add(brace)
}

function addCrossBracing(
  parent: THREE.Group,
  seaZ: number,
  landZ: number,
  height: number,
  color: number
): void {
  const mat = new THREE.MeshPhongMaterial({ color, shininess: 40 })

  // Diagonal cross-bracing (X shape) between sea and land sides
  for (let h = 0; h < 3; h++) {
    const y0 = height * 0.25 + h * height * 0.25
    const y1 = y0 + height * 0.25
    const dx = seaZ - landZ
    const dy = y1 - y0
    const diagLen = Math.sqrt(dx * dx + dy * dy)

    const diagGeo = new THREE.BoxGeometry(0.5, diagLen, 0.5)
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx))

    const diag1 = new THREE.Mesh(diagGeo, mat)
    diag1.position.set(0, (y0 + y1) / 2, (seaZ + landZ) / 2)
    diag1.rotation.x = (Math.PI / 2) - angle
    parent.add(diag1)
  }
}

function addToppingRope(
  parent: THREE.Group,
  height: number,
  seaZ: number
): void {
  const ropeMat = new THREE.MeshPhongMaterial({ color: 0x444444 })
  const ropeGeo = new THREE.CylinderGeometry(0.08, 0.08, height * 0.9, 6)
  const rope = new THREE.Mesh(ropeGeo, ropeMat)
  rope.position.set(0, height * 0.5 + 2, seaZ - 3)
  rope.rotation.x = -0.3
  parent.add(rope)
}

export function getDockPosition(crane: CraneObject): THREE.Vector3 {
  return new THREE.Vector3(0, crane.towerHeight - 3.5, crane.dockZ)
}

export function createPlacementAnimation(
  crane: CraneObject,
  containerMesh: THREE.Group,
  targetPosition: THREE.Vector3,
  shipGroup: THREE.Group,
  onComplete: () => void
): (deltaTime: number) => boolean {
  let currentPhase = 0
  const speed = 12 * CRANE.animationSpeed

  const startPos = new THREE.Vector3().copy(containerMesh.position)
  const travelHeight = crane.towerHeight - 2
  const liftPos = new THREE.Vector3(startPos.x, travelHeight, startPos.z)
  const aboveTarget = new THREE.Vector3(targetPosition.x, travelHeight, targetPosition.z)
  const finalTarget = new THREE.Vector3().copy(targetPosition)

  // Initialise spreader/trolley at the pickup column
  crane.trolley.position.x = startPos.x
  crane.trolley.position.z = crane.dockZ
  crane.spreader.position.x = startPos.x
  crane.spreader.position.z = crane.dockZ
  crane.spreader.position.y = startPos.y + CONTAINER.size.y + 0.15
  updateCables(crane)

  let t = 0

  function update(deltaTime: number): boolean {
    t += deltaTime * speed

    if (currentPhase === 0) {
      // Phase 0: Hoist container up from truck to travel height
      const progress = Math.min(t / 0.8, 1)
      const eased = easeInOutCubic(progress)
      containerMesh.position.lerpVectors(startPos, liftPos, eased)
      crane.spreader.position.y = THREE.MathUtils.lerp(
        startPos.y + CONTAINER.size.y + 0.15,
        travelHeight - 0.5,
        eased
      )
      updateCables(crane)
      if (progress >= 1) { currentPhase = 1; t = 0 }

    } else if (currentPhase === 1) {
      // Phase 1: Trolley travels over target slot (container follows at travel height)
      const progress = Math.min(t / Math.max(getDistance(liftPos, aboveTarget), 0.4), 1)
      const eased = easeInOutCubic(progress)
      containerMesh.position.lerpVectors(liftPos, aboveTarget, eased)

      crane.trolley.position.z = THREE.MathUtils.lerp(crane.dockZ, targetPosition.z, eased)
      crane.trolley.position.x = THREE.MathUtils.lerp(startPos.x, targetPosition.x, eased)
      crane.spreader.position.z = crane.trolley.position.z
      crane.spreader.position.x = crane.trolley.position.x

      updateCables(crane)

      if (progress >= 1) { currentPhase = 2; t = 0 }

    } else if (currentPhase === 2) {
      // Phase 2: Lower container onto slot
      const dist = aboveTarget.y - finalTarget.y
      const progress = Math.min(t / Math.max(dist * 0.08, 0.4), 1)
      const eased = easeInOutQuad(progress)
      containerMesh.position.y = THREE.MathUtils.lerp(aboveTarget.y, finalTarget.y, eased)
      containerMesh.position.x = finalTarget.x
      containerMesh.position.z = finalTarget.z

      crane.spreader.position.y = THREE.MathUtils.lerp(
        travelHeight - 0.5,
        finalTarget.y + CONTAINER.size.y + 0.15,
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

        currentPhase = 3
        t = 0
      }

    } else if (currentPhase === 3) {
      // Phase 3: Return crane to dock position (above front truck)
      const progress = Math.min(t / 7, 1)
      const eased = easeInOutCubic(progress)
      crane.trolley.position.z = THREE.MathUtils.lerp(targetPosition.z, crane.dockZ, eased)
      crane.trolley.position.x = THREE.MathUtils.lerp(targetPosition.x, 0, eased)
      crane.spreader.position.z = crane.trolley.position.z
      crane.spreader.position.x = crane.trolley.position.x
      crane.spreader.position.y = THREE.MathUtils.lerp(
        finalTarget.y + CONTAINER.size.y + 0.15,
        crane.towerHeight - 2.5,
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
  const cableOffsets: [number, number][] = [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]]

  crane.cables.forEach((cable, i) => {
    const [dx, dz] = cableOffsets[i]
    const midY = (trolleyPos.y + spreaderPos.y) / 2
    const rawLength = trolleyPos.y - spreaderPos.y
    const length = Math.max(0.3, rawLength)
    cable.position.set(trolleyPos.x + dx, midY, trolleyPos.z + dz)
    cable.scale.y = length / 3.0
  })
}

function getDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.max(a.distanceTo(b) * 0.12, 0.8)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/**
 * Discharge animation: reverse of createPlacementAnimation.
 * Lifts a container from a ship slot and lowers it onto the outbound truck dock position.
 *
 * @param crane         The crane object
 * @param containerMesh Container mesh already positioned at worldSlotPos (in scene space)
 * @param worldSlotPos  World-space position of the container on the ship
 * @param outboundDockPos World-space position of the outbound truck dock (where container lands)
 * @param onComplete    Called when the container has been set down and crane returns
 */
export function createDischargeAnimation(
  crane: CraneObject,
  containerMesh: THREE.Group,
  worldSlotPos: THREE.Vector3,
  outboundDockPos: THREE.Vector3,
  onComplete: () => void
): (deltaTime: number) => boolean {
  let currentPhase = 0
  const speed = 12 * CRANE.animationSpeed

  const startPos = new THREE.Vector3().copy(worldSlotPos)
  const travelHeight = crane.towerHeight - 2
  const liftPos = new THREE.Vector3(startPos.x, travelHeight, startPos.z)
  const aboveDock = new THREE.Vector3(outboundDockPos.x, travelHeight, outboundDockPos.z)
  const finalTarget = new THREE.Vector3().copy(outboundDockPos)

  // Start crane trolley/spreader over the ship slot
  crane.trolley.position.x = startPos.x
  crane.trolley.position.z = startPos.z
  crane.spreader.position.x = startPos.x
  crane.spreader.position.z = startPos.z
  crane.spreader.position.y = startPos.y + CONTAINER.size.y + 0.15
  updateCables(crane)

  let t = 0

  function update(deltaTime: number): boolean {
    t += deltaTime * speed

    if (currentPhase === 0) {
      // Lift container up from ship slot to travel height
      const progress = Math.min(t / 0.8, 1)
      const eased = easeInOutCubic(progress)
      containerMesh.position.lerpVectors(startPos, liftPos, eased)
      crane.spreader.position.y = THREE.MathUtils.lerp(
        startPos.y + CONTAINER.size.y + 0.15,
        travelHeight - 0.5,
        eased
      )
      updateCables(crane)
      if (progress >= 1) { currentPhase = 1; t = 0 }

    } else if (currentPhase === 1) {
      // Trolley travels from ship slot to above outbound dock
      const dist = getDistance(liftPos, aboveDock)
      const progress = Math.min(t / Math.max(dist, 0.4), 1)
      const eased = easeInOutCubic(progress)
      containerMesh.position.lerpVectors(liftPos, aboveDock, eased)

      crane.trolley.position.z = THREE.MathUtils.lerp(startPos.z, outboundDockPos.z, eased)
      crane.trolley.position.x = THREE.MathUtils.lerp(startPos.x, outboundDockPos.x, eased)
      crane.spreader.position.z = crane.trolley.position.z
      crane.spreader.position.x = crane.trolley.position.x
      updateCables(crane)

      if (progress >= 1) { currentPhase = 2; t = 0 }

    } else if (currentPhase === 2) {
      // Lower container onto outbound truck
      const dist = aboveDock.y - finalTarget.y
      const progress = Math.min(t / Math.max(dist * 0.08, 0.4), 1)
      const eased = easeInOutQuad(progress)
      containerMesh.position.y = THREE.MathUtils.lerp(aboveDock.y, finalTarget.y, eased)
      containerMesh.position.x = finalTarget.x
      containerMesh.position.z = finalTarget.z

      crane.spreader.position.y = THREE.MathUtils.lerp(
        travelHeight - 0.5,
        finalTarget.y + CONTAINER.size.y + 0.15,
        eased
      )
      updateCables(crane)

      if (progress >= 1) {
        currentPhase = 3
        t = 0
      }

    } else if (currentPhase === 3) {
      // Return crane trolley to dock position (ready for next discharge or load)
      const progress = Math.min(t / 7, 1)
      const eased = easeInOutCubic(progress)
      crane.trolley.position.z = THREE.MathUtils.lerp(outboundDockPos.z, crane.dockZ, eased)
      crane.trolley.position.x = THREE.MathUtils.lerp(outboundDockPos.x, 0, eased)
      crane.spreader.position.z = crane.trolley.position.z
      crane.spreader.position.x = crane.trolley.position.x
      crane.spreader.position.y = THREE.MathUtils.lerp(
        finalTarget.y + CONTAINER.size.y + 0.15,
        crane.towerHeight - 2.5,
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

// Animate warning light blinking
export function animateCraneWarningLight(crane: CraneObject, time: number): void {
  const light = crane.group.getObjectByName('warning-light') as THREE.Mesh | undefined
  if (!light) return
  const mat = light.material as THREE.MeshPhongMaterial
  mat.emissiveIntensity = Math.sin(time * 3.5) > 0.3 ? 1.5 : 0.1
}
