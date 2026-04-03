<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useBoxEmpireScene } from '../composables/useThreeScene'
import { useGameLoop } from '../composables/useGameLoop'
import { useInput } from '../composables/useInput'
import { useAudio } from '../composables/useAudio'
import { useGameStore } from '../store/gameStore'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const { getScene, getCamera, render, updateEntities, applyKeyboardCamera, isReady, webglFailed, spawnFloatingText, getContainerIdAtInstance, getContainerMesh, getContainerIdNearScreen, triggerVesselShake } = useBoxEmpireScene(canvasRef)
const store = useGameStore()
const { play, startAmbientSounds } = useAudio()

useInput(canvasRef, getCamera, getScene, getContainerIdAtInstance, getContainerMesh, getContainerIdNearScreen)

const { start, stop } = useGameLoop((dt: number) => {
  if (!isReady.value) return

  applyKeyboardCamera(dt)

  const pendingEvents = store.consumePendingEvents()
  for (const evt of pendingEvents) {
    play(evt.type)
    if (evt.type === 'money.earned' && evt.data?.position) {
      const pos = evt.data.position as { x: number; y: number; z: number }
      const amount = evt.data.amount as number
      spawnFloatingText(`+$${amount}`, '#2ecc71', pos)
    }
    if (evt.type === 'money.spent' && evt.data?.position) {
      const pos = evt.data.position as { x: number; y: number; z: number }
      const amount = evt.data.amount as number
      spawnFloatingText(`-$${amount}`, '#e74c3c', pos)
    }
    // Vessel shake when container placed on vessel
    if (evt.type === 'container.placed' && evt.data?.vesselId) {
      triggerVesselShake(evt.data.vesselId as string)
    }
  }

  updateEntities()
  render()
})

const { start: startHeadless } = useGameLoop(() => {
  store.consumePendingEvents()
})

watch(isReady, (ready) => {
  if (ready) {
    updateEntities()
    render()
    start()
  }
})

const stopGatehouseWatch = watch(() => store.gatehouseOpen, (open) => {
  if (open) {
    startAmbientSounds()
    stopGatehouseWatch()
  }
})

watch(webglFailed, (failed) => {
  if (failed) {
    startHeadless()
  }
})

onBeforeUnmount(() => {
  stop()
})

defineExpose({ webglFailed })
</script>

<template>
  <div class="game-canvas-wrapper">
    <canvas
      v-show="!webglFailed"
      ref="canvasRef"
      class="game-canvas"
    />
    <div
      v-if="webglFailed"
      class="webgl-fallback"
    >
      <div class="fallback-scene">
        <div class="fallback-sky" />
        <div class="fallback-ground" />
        <div class="fallback-water" />
        <div class="fallback-message">
          3D rendering unavailable — simulation running in text mode
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-canvas-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
}

.game-canvas {
  width: 100vw;
  height: 100vh;
  display: block;
}

.webgl-fallback {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.fallback-scene {
  width: 100%;
  height: 100%;
  position: relative;
}

.fallback-sky {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 50%;
  background: linear-gradient(180deg, #5b9bd5 0%, #87ceeb 100%);
}

.fallback-ground {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 35%;
  background: linear-gradient(180deg, #808080 0%, #606060 100%);
}

.fallback-water {
  position: absolute;
  bottom: 35%;
  left: 0;
  width: 100%;
  height: 15%;
  background: linear-gradient(180deg, #1a6b8a 0%, #2980b9 100%);
}

.fallback-message {
  position: absolute;
  bottom: 50%;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.4);
  padding: 4px 12px;
  border-radius: 4px;
}
</style>
