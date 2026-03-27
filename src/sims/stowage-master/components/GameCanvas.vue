<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { useGameThreeScene } from '../composables/useThreeScene'
import { useGameLoop } from '../composables/useGameLoop'
import { useSlotPicking } from '../composables/useSlotPicking'
import { useAudio } from '../composables/useAudio'
import {
  createOcean, animateOcean,
  createDock, createLighting, createSkybox, createSkyDome,
  createFoamParticles, animateFoam, createTerminalTruck,
} from '../modules/sceneBuilder'
import { createShip, updateShipTilt } from '../modules/shipRenderer'
import {
  createContainerMesh,
  createSlotIndicators, removeSlotIndicators, animateSlotIndicators,
} from '../modules/containerRenderer'
import {
  createCrane, getDockPosition, createPlacementAnimation, animateCraneWarningLight,
} from '../modules/craneSystem'
import { createDisasterAnimation } from '../modules/disasters'
import { CONTAINER } from '../modules/config'
import type { Container, CraneObject, DisasterAnimation } from '../types'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const store = useGameStore()

const { getScene, getCamera, isReady, render, setCameraForShip } = useGameThreeScene(canvasRef)
const { onClick: pickSlot, attach: attachPicking } = useSlotPicking(canvasRef, getCamera, getScene)
const audio = useAudio()

// Plain variables — Three.js objects must never be wrapped in Vue reactivity
let shipGroup: THREE.Group | null = null
let craneObj: CraneObject | null = null
let ocean: THREE.Mesh | null = null
let foam: THREE.Points | null = null
let hoistMesh: THREE.Group | null = null
let queueMeshes: THREE.Group[] = []
let truckMeshes: THREE.Group[] = []
let currentAnimation: ((dt: number) => boolean) | null = null
let disasterAnimation: DisasterAnimation | null = null

const TRUCK_SPACING = 10

interface TruckAnim {
  truck: THREE.Group
  container: THREE.Group | null
  startX: number
  endX: number
  elapsed: number
  duration: number
  departing: boolean
}
let truckAnimations: TruckAnim[] = []

// Ambient truck engine loop handle
let truckEngineNode: AudioBufferSourceNode | null = null

// Ship shake state
const shipShake = { active: false, elapsed: 0, duration: 0.4, intensity: 0.15 }

// Sail-away animation state
const sailAway = { active: false, elapsed: 0, delay: 0.5 }

// Sail-in animation state (ship arrives from off-screen left)
const sailIn = { active: false, elapsed: 0, startX: -200, targetX: 0, duration: 4.0 }

// Timer warning sound state — track whether we've played each threshold warning
let timerWarnedAt30pct = false
let timerWarnedAt15pct = false

const { start: startLoop } = useGameLoop((deltaTime, time) => {
  // Tick the countdown timer
  const timerResult = store.tickTimer(deltaTime)
  if (timerResult === 'warn30pct' && !timerWarnedAt30pct) {
    timerWarnedAt30pct = true
    audio.playSound('clockTicking', 0.65)
  } else if (timerResult === 'warn15pct' && !timerWarnedAt15pct) {
    timerWarnedAt15pct = true
    audio.playSound('clockTicking', 1.0)
  }

  animateOcean(ocean, time)
  animateFoam(foam, time)

  if (shipGroup) {
    animateSlotIndicators(shipGroup, time)
  }

  if (craneObj) {
    animateCraneWarningLight(craneObj, time)
  }

  if (currentAnimation) {
    const done = currentAnimation(deltaTime)
    if (done) currentAnimation = null
  }

  if (disasterAnimation) {
    const done = disasterAnimation.update(deltaTime)
    if (done) disasterAnimation = null
  }

  if (shipShake.active && shipGroup) {
    shipShake.elapsed += deltaTime
    if (shipShake.elapsed >= shipShake.duration) {
      shipShake.active = false
      shipGroup.position.x = 0
      shipGroup.position.y = 0
    } else {
      const decay = 1 - shipShake.elapsed / shipShake.duration
      const freq = 25
      const t = shipShake.elapsed * freq
      shipGroup.position.x = Math.sin(t * 1.3) * shipShake.intensity * decay
      shipGroup.position.y = Math.sin(t) * shipShake.intensity * 0.6 * decay
    }
  }

  if (sailAway.active && shipGroup) {
    sailAway.elapsed += deltaTime
    if (sailAway.elapsed > sailAway.delay) {
      const speed = 12 + (sailAway.elapsed - sailAway.delay) * 6
      shipGroup.position.x += speed * deltaTime
    }
  }

  if (sailIn.active && shipGroup) {
    sailIn.elapsed += deltaTime
    const t = Math.min(sailIn.elapsed / sailIn.duration, 1)
    const eased = easeOutQuad(t)
    shipGroup.position.x = sailIn.startX + (sailIn.targetX - sailIn.startX) * eased
    if (t >= 1) {
      shipGroup.position.x = sailIn.targetX
      sailIn.active = false
    }
  }

  // Advance trucks toward crane, departing truck drives off and fades
  if (truckAnimations.length > 0) {
    const scene = getScene()
    truckAnimations = truckAnimations.filter(anim => {
      anim.elapsed += deltaTime
      const t = Math.min(anim.elapsed / anim.duration, 1)
      const eased = easeOutQuad(t)
      const x = anim.startX + (anim.endX - anim.startX) * eased
      anim.truck.position.x = x
      if (anim.container) anim.container.position.x = x

      if (anim.departing && t >= 0.4) {
        const fadeT = (t - 0.4) / 0.6
        const opacity = Math.max(0, 1 - fadeT)
        setGroupOpacity(anim.truck, opacity)
        if (anim.container) setGroupOpacity(anim.container, opacity)
      }

      if (t >= 1) {
        if (anim.departing && scene) {
          disposeGroup(anim.truck, scene)
          if (anim.container) disposeGroup(anim.container, scene)
        }
        return false
      }
      return true
    })
  }

  render()
})

onMounted(async () => {
  await audio.init()
})

// Choose horn sample based on vessel size (level 0 = small feeder)
function hornSound(): string {
  return store.currentLevel === 0 ? 'shipHornSmall' : 'shipHornLarge'
}

// Single phase watcher — handles both scene rebuilds and audio/animation triggers
watch(() => store.phase, (newPhase, oldPhase) => {
  if (newPhase === 'selecting' && (oldPhase === 'start' || oldPhase === 'disaster' || oldPhase === 'failed' || oldPhase === 'complete')) {
    // Stop all in-flight sounds from the previous level before building the new scene
    audio.stopAll()
    buildScene()
  }

  if (newPhase === 'complete') {
    audio.playSound('cheer', 0.8)
    setTimeout(() => audio.playSound('levelUp', 0.75), 800)
    setTimeout(() => audio.playSound(hornSound(), 0.9), 1400)
    setTimeout(() => audio.playSound(hornSound(), 0.9), 3200)
    setTimeout(() => audio.playSound(hornSound(), 0.9), 5000)
    sailAway.active = true
    sailAway.elapsed = 0
  }

  if (newPhase === 'failed') {
    // Boo sound when time runs out or level fails
    audio.playSound('boo', 0.9)
    setTimeout(() => audio.playSound(hornSound(), 0.9), 800)
    sailAway.active = true
    sailAway.elapsed = 0
  }
})

watch([() => store.shipList, () => store.shipTrim], ([list, trim]) => {
  updateShipTilt(shipGroup, list, trim)
})

watch(() => store.availableSlots, (slots) => {
  if (!shipGroup || !store.shipConfig) return
  removeSlotIndicators(shipGroup)
  if (store.phase === 'selecting') {
    createSlotIndicators(getScene()!, store.grid, slots, store.shipConfig, shipGroup)
  }
}, { deep: true })

watch(() => store.currentContainer, (container) => {
  updateHoistMesh(container)
})

watch(() => store.nextThreeContainers, (containers) => {
  updateQueueMeshes(containers)
}, { deep: true })

watch(() => store.disasterType, (type) => {
  const scene = getScene()
  if (!type || !shipGroup || !scene) return
  audio.playDisasterSequence(type)
  disasterAnimation = createDisasterAnimation(type, shipGroup, scene, () => { /* noop */ })
})

watch(() => store.lastPlacement, (placement) => {
  if (!placement) return
  if (placement.score >= 100) {
    // Perfect placement — cash register sound
    audio.playSound('caChing', 0.7)
  } else if (placement.score >= 80) {
    audio.playSound('correctDing', 0.6)
  } else if (placement.score < 30) {
    audio.playSound('negative', 0.45)
  }
})

function buildScene(): void {
  const scene = getScene()
  if (!scene || !store.shipConfig) return
  clearScene()

  createSkybox(scene)
  createSkyDome(scene)
  createLighting(scene)
  ocean = createOcean(scene)
  foam = createFoamParticles(scene)
  createDock(scene)

  shipGroup = createShip(scene, store.shipConfig)
  craneObj = createCrane(scene, store.shipConfig)

  // Start ship off-screen and sail it in
  shipGroup.position.x = sailIn.startX
  sailIn.elapsed = 0
  sailIn.active = true

  // Single horn blast as ship arrives (sample already has 3 blasts; use vessel-appropriate sound)
  setTimeout(() => audio.playSound(hornSound(), 0.9), 1000)

  setCameraForShip(store.shipConfig)

  createSlotIndicators(scene, store.grid, store.availableSlots, store.shipConfig, shipGroup)

  updateHoistMesh(store.currentContainer)
  updateQueueMeshes(store.nextThreeContainers)

  attachPicking()
  startLoop()
}

function handleClick(event: MouseEvent): void {
  if (store.phase !== 'selecting') return

  const slotId = pickSlot(event)
  if (!slotId) return

  const result = store.placeContainer(slotId)
  if (!result) return

  removeHoistMesh()

  const scene = getScene()!

  // Pick up from the front truck (truck #0 is at dockPos)
  const dockPos = getDockPosition(craneObj!)
  const truckHeight = 0.85
  const pickupPos = new THREE.Vector3(dockPos.x, truckHeight + CONTAINER.size.y + 0.1, dockPos.z)

  const containerMesh = createContainerMesh(result.container)
  containerMesh.position.copy(pickupPos)
  scene.add(containerMesh)

  // Remove the front container mesh from queue display (it's now being lifted)
  if (queueMeshes[0]) {
    disposeGroup(queueMeshes[0], scene)
    queueMeshes.shift()
  }

  const slot = store.grid[slotId]
  const targetPos = new THREE.Vector3(
    slot.xOffset,
    slot.yOffset + store.shipConfig!.height * 0.3 + CONTAINER.size.y / 2,
    slot.zOffset
  )

  shipGroup!.localToWorld(targetPos)
  removeSlotIndicators(shipGroup!)

  audio.playSound('containerLoad', 0.7)

  // Trigger trucks to advance as the crane picks up
  triggerTruckAdvance()

  currentAnimation = createPlacementAnimation(
    craneObj!,
    containerMesh,
    targetPos,
    shipGroup!,
    () => {
      audio.playSound('containerSet', 0.75)

      const weight = result.container.weight
      shipShake.intensity = 0.08 + (weight / 30) * 0.15
      shipShake.elapsed = 0
      shipShake.active = true

      store.finalizePlacement(slotId)
    }
  )
}

function updateHoistMesh(container: Container | null): void {
  removeHoistMesh()
  const scene = getScene()
  if (!container || !craneObj || !scene) return

  // Show current container sitting on the front truck, ready to be picked up
  const dockPos = getDockPosition(craneObj)
  const truckHeight = 0.85
  const mesh = createContainerMesh(container)
  mesh.position.set(dockPos.x, truckHeight + CONTAINER.size.y / 2, dockPos.z)
  mesh.name = 'hoist-mesh'
  scene.add(mesh)
  hoistMesh = mesh
}

function removeHoistMesh(): void {
  const scene = getScene()
  if (hoistMesh && scene) {
    scene.remove(hoistMesh)
    hoistMesh.traverse(child => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
        else mesh.material.dispose()
      }
    })
    hoistMesh = null
  }
}

function updateQueueMeshes(containers: Container[]): void {
  const scene = getScene()
  const disposeMeshGroup = (mesh: THREE.Group) => {
    if (scene) scene.remove(mesh)
    mesh.traverse(child => {
      const m = child as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose())
        else m.material.dispose()
      }
    })
  }
  for (const mesh of queueMeshes) disposeMeshGroup(mesh)
  for (const mesh of truckMeshes) disposeMeshGroup(mesh)
  queueMeshes = []
  truckMeshes = []
  truckAnimations = []

  if (!craneObj || !scene || !containers.length) return

  const dockPos = getDockPosition(craneObj)
  const truckHeight = 0.85
  const zPos = dockPos.z

  containers.forEach((container, i) => {
    // Truck 0 is directly under the crane; subsequent trucks wait behind (negative X)
    const xPos = dockPos.x - i * TRUCK_SPACING

    const truck = createTerminalTruck()
    truck.position.set(xPos, 0.0, zPos)
    truck.name = `queue-truck-${i}`
    scene.add(truck)
    truckMeshes.push(truck)

    const mesh = createContainerMesh(container)
    mesh.scale.setScalar(0.88)
    mesh.position.set(
      xPos,
      truckHeight + CONTAINER.size.y / 2,
      zPos
    )
    mesh.name = `queue-${i}`
    scene.add(mesh)
    queueMeshes.push(mesh)
  })
}

function clearScene(): void {
  const scene = getScene()
  if (!scene) return

  // Stop ambient truck engine if running
  if (truckEngineNode) {
    try { truckEngineNode.stop() } catch { /* already stopped */ }
    truckEngineNode = null
  }

  const toRemove: THREE.Object3D[] = []
  scene.traverse(child => {
    if (child !== scene) toRemove.push(child)
  })
  for (const obj of toRemove) {
    if (obj.parent === scene) scene.remove(obj)
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
      else mesh.material.dispose()
    }
  }
  if (disasterAnimation) {
    disasterAnimation.cleanup()
    disasterAnimation = null
  }
  currentAnimation = null
  sailAway.active = false
  sailAway.elapsed = 0
  sailIn.active = false
  sailIn.elapsed = 0
  timerWarnedAt30pct = false
  timerWarnedAt15pct = false
  shipGroup = null
  craneObj = null
  ocean = null
  foam = null
  hoistMesh = null
  queueMeshes = []
  truckMeshes = []
  truckAnimations = []
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function setGroupOpacity(group: THREE.Group, opacity: number): void {
  group.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.material) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      const m = mat as THREE.MeshPhongMaterial
      m.transparent = true
      m.opacity = opacity
    }
  })
}

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group)
  group.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(m => m.dispose())
    }
  })
}

function triggerTruckAdvance(): void {
  if (!craneObj) return
  const scene = getScene()
  if (!scene) return

  const dockX = getDockPosition(craneObj).x
  const zPos = getDockPosition(craneObj).z

  // Animate each remaining truck forward one TRUCK_SPACING step
  truckMeshes.forEach((truck, i) => {
    const containerMesh = queueMeshes[i] ?? null
    truckAnimations.push({
      truck,
      container: containerMesh,
      startX: truck.position.x,
      endX: truck.position.x + TRUCK_SPACING,
      elapsed: 0,
      duration: 0.8,
      departing: false,
    })
  })

  // The truck that was at position 0 (under crane) is now empty — it already had its
  // container lifted. Animate it departing forward past the crane.
  const departingTruck = createTerminalTruck()
  departingTruck.position.set(dockX, 0.0, zPos)
  scene.add(departingTruck)
  truckAnimations.push({
    truck: departingTruck,
    container: null,
    startX: dockX,
    endX: dockX + TRUCK_SPACING * 2,
    elapsed: 0,
    duration: 1.8,
    departing: true,
  })
}

defineExpose({ buildScene, clearScene, isReady })
</script>

<template>
  <canvas
    ref="canvasRef"
    class="game-canvas"
    @click="handleClick"
  />
</template>

<style scoped>
.game-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}
</style>
