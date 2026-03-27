<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { useContainerStackStore } from '../store/gameStore'
import { useContainerStackThreeScene } from '../composables/useThreeScene'
import { useContainerPicking } from '../composables/useContainerPicking'
import { useGameLoop } from '../composables/useGameLoop'
import { useContainerStackAudio } from '../composables/useAudio'
import { createContainerMesh, setContainerHighlight } from '../modules/containerRenderer'
import { slotWorldPosition, getTowerTopY } from '../modules/towerBuilder'
import { INTERACTION, TOWER } from '../modules/config'
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
} = storeToRefs(store)

const three = useContainerStackThreeScene(canvasRef)
const audio = useContainerStackAudio()

const blocksGroup = new THREE.Group()
const ghostGroup = new THREE.Group()
const collapseGroup = new THREE.Group()
const particles = new THREE.Points()

let blocksById = new Map<string, THREE.Group>()
let collapseMeshes = new Map<string, THREE.Group>()

const dragStart = ref<{ x: number; y: number } | null>(null)
const activePick = ref<{ layerIndex: number; slotIndex: number } | null>(null)
const slideProgress = ref(0)
const slideDir = new THREE.Vector3()
let prevClientX = 0
let prevClientY = 0

const picking = useContainerPicking(
  canvasRef,
  three.getCamera,
  () => three.getTowerPivot() ?? null
)

function rebuildTowerMeshes(): void {
  const pivot = three.getTowerPivot()
  if (!pivot) return

  for (const g of blocksById.values()) {
    blocksGroup.remove(g)
    g.traverse(obj => {
      const m = obj as THREE.Mesh | THREE.LineSegments
      if (m.geometry) m.geometry.dispose()
      const mat = m.material
      if (mat && !Array.isArray(mat)) mat.dispose()
    })
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
  const cam = three.getCamera()
  if (phase.value === 'removing' && activePick.value && cam) {
    const base = slotWorldPosition(
      activePick.value.layerIndex,
      activePick.value.slotIndex,
      layers.value
    )
    const worldSlide = slideDir.clone().multiplyScalar(slideProgress.value * INTERACTION.slideOutDistance)
    g.position.copy(base).add(worldSlide)
    return
  }
  if (phase.value === 'placing') {
    g.position.set(0, topY + INTERACTION.ghostHeightAboveTop, 0)
  }
}

function syncCollapseMeshes(): void {
  collapseGroup.clear()
  collapseMeshes.clear()
  for (const p of collapsePieces.value) {
    const fake: JengaContainer = {
      id: p.id,
      color: p.color,
      layerIndex: 0,
      slotIndex: 0,
    }
    const mesh = createContainerMesh(fake, p.orientation)
    mesh.position.copy(p.position)
    collapseMeshes.set(p.id, mesh)
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
  for (const p of collapsePieces.value) {
    const m = collapseMeshes.get(p.id)
    if (m) {
      m.position.copy(p.position)
      m.rotation.x += p.angularVelocity.x * 0.016
      m.rotation.y += p.angularVelocity.y * 0.016
      m.rotation.z += p.angularVelocity.z * 0.016
    }
  }
}

watch(
  [layers, phase],
  () => {
    if (phase.value !== 'collapsing' && phase.value !== 'gameOver') {
      rebuildTowerMeshes()
    }
    syncGhostMesh()
  },
  { deep: true }
)

watch(floatingContainer, () => {
  syncGhostMesh()
})

watch(phase, (p, prevP) => {
  if (p === 'gameOver' || p === 'start') {
    const pivot = three.getTowerPivot()
    if (pivot) {
      pivot.rotation.set(0, 0, 0)
    }
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
  () => {
    applyWobbleToPivot()
    updateGhostPosition()
    if (phase.value === 'collapsing') {
      updateCollapseVisuals()
    }
  }
)

function onPointerDown(e: PointerEvent): void {
  if (!canvasRef.value) return
  canvasRef.value.setPointerCapture(e.pointerId)
  three.setIdleOrbit(false)

  if (phase.value === 'placing') {
    store.placeOnTop()
    audio.playSound('containerSet', 0.75)
    audio.playSound('caChing', 0.45)
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
  picking.onPointerMove(e.clientX, e.clientY)

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
  const h = picking.hoveredPick.value
  if (h && phase.value === 'playing') {
    const layer = layers.value[h.layerIndex]
    const c = layer?.slots[h.slotIndex]
    if (c && store.canRemoveFromSlot(h.layerIndex, h.slotIndex)) {
      const grp = blocksById.get(c.id)
      if (grp) setContainerHighlight(grp, true)
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
