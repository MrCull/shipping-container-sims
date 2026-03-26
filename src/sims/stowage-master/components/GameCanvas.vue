<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { useGameThreeScene } from '../composables/useThreeScene'
import { useGameLoop } from '../composables/useGameLoop'
import { useSlotPicking } from '../composables/useSlotPicking'
import { useAudio } from '../composables/useAudio'
import { createOcean, animateOcean, createDock, createLighting, createSkybox } from '../modules/sceneBuilder'
import { createShip, updateShipTilt } from '../modules/shipRenderer'
import { createContainerMesh, createSlotIndicators, removeSlotIndicators } from '../modules/containerRenderer'
import { createCrane, getDockPosition, createPlacementAnimation } from '../modules/craneSystem'
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
let hoistMesh: THREE.Group | null = null
let queueMeshes: THREE.Group[] = []
let currentAnimation: ((dt: number) => boolean) | null = null
let disasterAnimation: DisasterAnimation | null = null

const { start: startLoop } = useGameLoop((deltaTime, time) => {
  animateOcean(ocean, time)

  if (currentAnimation) {
    const done = currentAnimation(deltaTime)
    if (done) currentAnimation = null
  }

  if (disasterAnimation) {
    const done = disasterAnimation.update(deltaTime)
    if (done) disasterAnimation = null
  }

  render()
})

onMounted(async () => {
  await audio.init()
})

watch(() => store.phase, (newPhase, oldPhase) => {
  if (newPhase === 'selecting' && oldPhase === 'start') {
    buildScene()
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

function buildScene(): void {
  const scene = getScene()
  if (!scene || !store.shipConfig) return
  clearScene()

  createSkybox(scene)
  createLighting(scene)
  ocean = createOcean(scene)
  createDock(scene)

  shipGroup = createShip(scene, store.shipConfig)
  craneObj = createCrane(scene, store.shipConfig)

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
  const containerMesh = createContainerMesh(result.container)
  const dockPos = getDockPosition(craneObj!)
  containerMesh.position.copy(dockPos)
  scene.add(containerMesh)

  const slot = store.grid[slotId]
  const targetPos = new THREE.Vector3(
    slot.xOffset,
    slot.yOffset + store.shipConfig!.height * 0.3 + CONTAINER.size.y / 2,
    slot.zOffset
  )

  shipGroup!.localToWorld(targetPos)
  removeSlotIndicators(shipGroup!)

  currentAnimation = createPlacementAnimation(
    craneObj!,
    containerMesh,
    targetPos,
    shipGroup!,
    () => {
      audio.playPlacementSound()
      store.finalizePlacement(slotId)
    }
  )
}

function updateHoistMesh(container: Container | null): void {
  removeHoistMesh()
  const scene = getScene()
  if (!container || !craneObj || !scene) return

  const mesh = createContainerMesh(container)
  const pos = getDockPosition(craneObj)
  mesh.position.copy(pos)
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
  for (const mesh of queueMeshes) {
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
  queueMeshes = []

  if (!craneObj || !scene || !containers.length) return

  const dockPos = getDockPosition(craneObj)
  containers.forEach((container, i) => {
    const mesh = createContainerMesh(container)
    mesh.scale.setScalar(0.9)
    mesh.position.set(
      dockPos.x - 4 - i * 3,
      0.8 + CONTAINER.size.y / 2,
      dockPos.z
    )
    mesh.name = `queue-${i}`
    scene.add(mesh)
    queueMeshes.push(mesh)
  })
}

function clearScene(): void {
  const scene = getScene()
  if (!scene) return
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
  shipGroup = null
  craneObj = null
  ocean = null
  hoistMesh = null
  queueMeshes = []
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
