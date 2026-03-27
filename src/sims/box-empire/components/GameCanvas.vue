<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useBoxEmpireScene } from '../composables/useThreeScene'
import { useGameLoop } from '../composables/useGameLoop'
import { useInput } from '../composables/useInput'
import { useAudio } from '../composables/useAudio'
import { useGameStore } from '../store/gameStore'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const { getScene, getCamera, render, updateEntities, isReady } = useBoxEmpireScene(canvasRef)
const store = useGameStore()
const { play } = useAudio()

useInput(canvasRef, getCamera, getScene)

const { start, stop } = useGameLoop(() => {
  if (!isReady.value) return

  const pendingEvents = store.consumePendingEvents()
  for (const evt of pendingEvents) {
    play(evt.type)
  }

  updateEntities()
  render()
})

watch(isReady, (ready) => {
  if (ready) {
    updateEntities()
    render()
    start()
  }
})

onBeforeUnmount(() => {
  stop()
})
</script>

<template>
  <canvas
    ref="canvasRef"
    class="game-canvas"
  />
</template>

<style scoped>
.game-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: block;
}
</style>
