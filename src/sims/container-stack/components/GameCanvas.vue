<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { useContainerStackStore } from '../store/gameStore'
import { useContainerStackThreeScene } from '../composables/useThreeScene'
import { useContainerPicking } from '../composables/useContainerPicking'
import { useGameLoop } from '../composables/useGameLoop'
import { useContainerStackAudio } from '../composables/useAudio'
import {
  createContainerMesh,
  disposeContainerGroupMaterials,
  setContainerHighlight,
} from '../modules/containerRenderer'
import { createPlacementMarker } from '../modules/placementMarkers'
import { slotWorldPosition, getTowerTopY, getPlacementCandidates } from '../modules/towerBuilder'
import { BLOCK, INTERACTION, TOWER } from '../modules/config'
import type { JengaContainer } from '../types'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const store = useContainerStackStore()
const {
  phase,
  layers,
  floatingContainer,
  wobble,
  collapsePieces,
  comboStreak,
  maxHeightLayers,
  placingSlotOptions,
} = storeToRefs(store)

const three = useContainerStackThreeScene(canvasRef)
const audio = useContainerStackAudio()

const blocksGroup = new THREE.Group()
const ghostGroup = new THREE.Group()
const collapseGroup = new THREE.Group()
const placementMarkersGroup = new THREE.Group()
const particles = new THREE.Points()

const placementRaycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()

let blocksById = new Map<string, THREE.Group>()
let collapseMeshes = new Map<string, THREE.Group>()

const dragStart = ref<{ x: number; y: number } | null>(null)
const activePick = ref<{ layerIndex: number; slotIndex: number } | null>(null)
const slideProgress = ref(0)
const slideDir = new THREE.Vector3()
let prevClientX = 0
let prevClientY = 0

const hoveredPlacementSlot = ref<number | null>(null)
const lastPhysicsDt = ref(0.016)

const picking = useContainerPicking(
  canvasRef,
  three.getCamera,
  () => three.getTowerPivot() ?? null
)

function isContainerBlockGroup(g: THREE.Object3D): boolean {
  if (!(g instanceof THREE.Group)) return false
  return g.children.some(c => c instanceof THREE.Mesh && c.userData['isJengaBlock'])
}

function disposeObjectTree(obj: THREE.Object3D): void {
  if (isContainerBlockGroup(obj)) {
    disposeContainerGroupMaterials(obj as THREE.Group)
    return
  }
  obj.traverse(child => {
    const m = child as THREE.Mesh | THREE.LineSegments
    if (m.geometry) m.geometry.dispose()
    const mat = m.material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(x => x.dispose())
      else mat.dispose()
    }
  })
}

function clearCollapseVisuals(): void {
  for (const g of collapseMeshes.values()) {
    collapseGroup.remove(g)
    disposeObjectTree(g)
  }
  collapseMeshes.clear()
  collapseGroup.clear()
}

function clearPlacementMarkers(): void {
  for (const c of placementMarkersGroup.children.slice()) {
    placementMarkersGroup.remove(c)
    disposeObjectTree(c)
  }
}

function rebuildPlacementMarkers(): void {
  clearPlacementMarkers()
  if (phase.value !== 'placing') return
  const opts = placingSlotOptions.value
  const cands = getPlacementCandidates(layers.value, opts)
  const hi = hoveredPlacementSlot.value
  for (const c of cands) {
    const m = createPlacementMarker(c, c.slotIndex === hi)
    placementMarkersGroup.add(m)
  }
}

function updateNdc(clientX: number, clientY: number): void {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
}

function pickPlacementSlot(clientX: number, clientY: number): number | null {
  const camera = three.getCamera()
  if (!camera) return null
  updateNdc(clientX, clientY)
  placementRaycaster.setFromCamera(ndc, camera)
  const hits = placementRaycaster.intersectObjects(placementMarkersGroup.children, true)
  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object
    while (obj) {
      const ud = obj.userData as { isPlacementMarker?: boolean; slotIndex?: number }
      if (ud?.isPlacementMarker && ud.slotIndex !== undefined) {
        return ud.slotIndex
      }
      obj = obj.parent
    }
  }
  return null
}

function rebuildTowerMeshes(): void {
  const pivot = three.getTowerPivot()
  if (!pivot) return

  for (const g of blocksById.values()) {
    blocksGroup.remove(g)
    disposeObjectTree(g)
  }
  blocksById = new Map()

  for (let li = 0; li < layers.value.length; li++) {
    const layer = layers.value[li]!
    for (let si = 0; si < layer.slots.length; si++) {
      const c = layer.slots[si]
      if (!c) continue
      const g = createContainerMesh(c, layer.orientation)
      const pos = slotWorldPosition(li, si, layers.value)
      g.position.copy(pos)
      blocksById.set(c.id, g)
      blocksGroup.add(g)
    }
  }
}

function setupParticles(): void {
  const count = 80
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i++) pos[i] = 0
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xffaa66,
    size: 0.35,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  particles.geometry = geo
  particles.material = mat
  particles.visible = false
}

function burstParticlesAt(origin: THREE.Vector3): void {
  const geo = particles.geometry as THREE.BufferGeometry
  const attr = geo.getAttribute('position') as THREE.BufferAttribute
  const arr = attr.array as Float32Array
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = origin.x + (Math.random() - 0.5) * 3
    arr[i + 1] = origin.y + Math.random() * 4
    arr[i + 2] = origin.z + (Math.random() - 0.5) * 3
  }
  attr.needsUpdate = true
  particles.visible = true
  particles.position.set(0, 0, 0)
  setTimeout(() => {
    particles.visible = false
  }, 900)
}

function syncGhostMesh(): void {
  ghostGroup.clear()
  const c = floatingContainer.value
  if (!c || (phase.value !== 'removing' && phase.value !== 'placing')) return

  const layer = layers.value[c.layerIndex]
  const orient = layer?.orientation ?? (c.layerIndex % 2 === 0 ? 'alongX' : 'alongZ')
  const g = createContainerMesh(c, orient)
  ghostGroup.add(g)
}

function updateGhostPosition(): void {
  if (ghostGroup.children.length === 0) return
  const g = ghostGroup.children[0] as THREE.Group
  const topY = getTowerTopY(layers.value)
  if (phase.value === 'removing' && activePick.value) {
    const base = slotWorldPosition(
      activePick.value.layerIndex,
      activePick.value.slotIndex,
      layers.value
    )
    const worldSlide = slideDir
      .clone()
      .multiplyScalar(slideProgress.value * INTERACTION.slideOutDistance)
    g.position.copy(base).add(worldSlide)
    return
  }
  if (phase.value === 'placing') {
    const opts = placingSlotOptions.value
    const cands = getPlacementCandidates(layers.value, opts)
    const slot = hoveredPlacementSlot.value
    const chosen =
      cands.find(c => c.slotIndex === slot) ??
      cands[0] ??
      null
    if (chosen) {
      g.position.copy(chosen.position)
      g.position.y += BLOCK.height * 0.95
    } else {
      g.position.set(0, topY + INTERACTION.ghostHeightAboveTop, 0)
    }
  }
}

function syncCollapseMeshes(): void {
  clearCollapseVisuals()
  for (const p of collapsePieces.value) {
    const fake: JengaContainer = {
      id: p.meshKey,
      color: p.color,
      layerIndex: 0,
      slotIndex: 0,
    }
    const mesh = createContainerMesh(fake, p.orientation)
    mesh.position.copy(p.position)
    collapseMeshes.set(p.meshKey, mesh)
    collapseGroup.add(mesh)
  }
}

function applyWobbleToPivot(): void {
  const pivot = three.getTowerPivot()
  if (!pivot) return
  const a = wobble.value.angle
  pivot.rotation.x = a * 0.35
  pivot.rotation.z = a * 0.22
}

function updateCollapseVisuals(): void {
  const dt = lastPhysicsDt.value
  for (const p of collapsePieces.value) {
    const m = collapseMeshes.get(p.meshKey)
    if (m) {
      m.position.copy(p.position)
      m.rotation.x += p.angularVelocity.x * dt
      m.rotation.y += p.angularVelocity.y * dt
      m.rotation.z += p.angularVelocity.z * dt
    }
  }
}

watch(
  [layers, phase],
  () => {
    if (
      phase.value !== 'collapsing' &&
      phase.value !== 'gameOver' &&
      phase.value !== 'levelComplete' &&
      phase.value !== 'levelFailed'
    ) {
      rebuildTowerMeshes()
    }
    syncGhostMesh()
  },
  { deep: true }
)

watch(floatingContainer, () => {
  syncGhostMesh()
})

watch([phase, placingSlotOptions, layers, hoveredPlacementSlot], () => {
  rebuildPlacementMarkers()
})

watch(phase, (p, prevP) => {
  if (p === 'gameOver' || p === 'start' || (p === 'playing' && prevP === 'start')) {
    clearCollapseVisuals()
  }
  if (p === 'gameOver' || p === 'start') {
    const pivot = three.getTowerPivot()
    if (pivot) {
      pivot.rotation.set(0, 0, 0)
    }
  }
  if (p !== 'placing') {
    hoveredPlacementSlot.value = null
  }
  if (p === 'collapsing' && prevP !== 'collapsing') {
    const pivot = three.getTowerPivot()
    if (pivot) {
      burstParticlesAt(new THREE.Vector3(0, getTowerTopY(layers.value) * 0.6, 0))
    }
    syncCollapseMeshes()
    audio.playCollapseSequence()
    blocksGroup.clear()
    blocksById.clear()
    clearPlacementMarkers()
  }
  if (p === 'playing' && prevP === 'start') {
    void audio.init()
  }
})

watch(comboStreak, (c, o) => {
  if (c > o && c > 1) {
    audio.playSound('bonus', 0.55)
  }
})

watch(maxHeightLayers, (m, o) => {
  if (m > o && m > TOWER.startLayers) {
    audio.playSound('levelUp', 0.6)
  }
})

const { start: startLoop, stop: stopLoop } = useGameLoop(
  () => three.render(),
  () => getTowerTopY(layers.value),
  y => three.frameTower(y),
  n => three.setCameraShake(n),
  dt => {
    lastPhysicsDt.value = dt
    applyWobbleToPivot()
    updateGhostPosition()
    if (phase.value === 'collapsing') {
      updateCollapseVisuals()
    }
  },
  dt => three.applyKeyboardCamera(dt)
)

function onPointerDown(e: PointerEvent): void {
  if (!canvasRef.value) return
  canvasRef.value.setPointerCapture(e.pointerId)

  if (phase.value === 'placing') {
    const slot = pickPlacementSlot(e.clientX, e.clientY)
    if (slot === null) return
    if (store.placeOnTop(slot)) {
      audio.playSound('containerSet', 0.75)
      audio.playSound('caChing', 0.45)
    }
    return
  }

  if (phase.value !== 'playing') return

  const hit = picking.pick(e.clientX, e.clientY)
  if (!hit || !store.canRemoveFromSlot(hit.layerIndex, hit.slotIndex)) return

  if (store.startRemoval(hit.layerIndex, hit.slotIndex)) {
    activePick.value = hit
    dragStart.value = { x: e.clientX, y: e.clientY }
    prevClientX = e.clientX
    prevClientY = e.clientY
    slideProgress.value = 0
    slideDir.set(0, 0, 1)
    const cam = three.getCamera()
    if (cam) {
      const base = slotWorldPosition(hit.layerIndex, hit.slotIndex, layers.value)
      const toCam = new THREE.Vector3().subVectors(cam.position, base).setY(0)
      if (toCam.lengthSq() > 0.001) {
        slideDir.copy(toCam.normalize())
      }
    }
    audio.playSound('correctDing', 0.5)
  }
}

function onPointerMove(e: PointerEvent): void {
  if (phase.value === 'placing') {
    hoveredPlacementSlot.value = pickPlacementSlot(e.clientX, e.clientY)
  } else {
    picking.onPointerMove(e.clientX, e.clientY)
  }

  if (phase.value === 'removing' && dragStart.value) {
    const dx = e.clientX - prevClientX
    const dy = e.clientY - prevClientY
    store.recordDragJitter(Math.hypot(dx, dy))
    prevClientX = e.clientX
    prevClientY = e.clientY

    const totalDrag = Math.hypot(e.clientX - dragStart.value.x, e.clientY - dragStart.value.y)
    if (totalDrag > INTERACTION.minDragPxToExtract) {
      slideProgress.value = Math.min(1, (totalDrag - INTERACTION.minDragPxToExtract) / 120)
    }
  }

  for (const [, grp] of blocksById) {
    setContainerHighlight(grp, false)
  }
  if (phase.value === 'playing') {
    const h = picking.hoveredPick.value
    if (h) {
      const layer = layers.value[h.layerIndex]
      const c = layer?.slots[h.slotIndex]
      if (c && store.canRemoveFromSlot(h.layerIndex, h.slotIndex)) {
        const grp = blocksById.get(c.id)
        if (grp) setContainerHighlight(grp, true)
      }
    }
  }
}

function onPointerUp(e: PointerEvent): void {
  try {
    canvasRef.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }

  if (phase.value === 'removing') {
    if (slideProgress.value > 0.85) {
      store.finishSlideAndEnterPlacing()
      audio.playSound('containerLoad', 0.55)
    } else {
      store.cancelRemoval()
    }
  }
  dragStart.value = null
  activePick.value = null
  slideProgress.value = 0
}

function onPointerLeave(): void {
  picking.onPointerLeave()
  if (phase.value === 'placing') {
    hoveredPlacementSlot.value = null
  }
}

onMounted(() => {
  const tryMount = () => {
    const scene = three.getScene()
    const pivot = three.getTowerPivot()
    if (!scene || !pivot) {
      requestAnimationFrame(tryMount)
      return
    }
    pivot.add(blocksGroup)
    pivot.add(ghostGroup)
    scene.add(collapseGroup)
    scene.add(placementMarkersGroup)
    setupParticles()
    scene.add(particles)
    rebuildTowerMeshes()
    startLoop()
  }
  tryMount()
  void audio.init()
})

onUnmounted(() => {
  stopLoop()
})

watch(
  () => three.isReady.value,
  ready => {
    if (ready) {
      const scene = three.getScene()
      const pivot = three.getTowerPivot()
      if (scene && pivot && !pivot.children.includes(blocksGroup)) {
        pivot.add(blocksGroup)
        pivot.add(ghostGroup)
        scene.add(collapseGroup)
        scene.add(placementMarkersGroup)
        scene.add(particles)
        rebuildTowerMeshes()
      }
    }
  }
)
</script>

<template>
  <canvas
    ref="canvasRef"
    class="game-canvas"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerleave="onPointerLeave"
  />
</template>

<style scoped>
.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}
.game-canvas:active {
  cursor: grabbing;
}
</style>
