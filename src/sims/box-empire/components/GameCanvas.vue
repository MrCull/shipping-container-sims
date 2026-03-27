<script setup lang="ts">
import { ref } from 'vue'
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

useGameLoop(() => {
  if (!isReady.value) return

  const pendingEvents = store.consumePendingEvents()
  for (const evt of pendingEvents) {
    play(evt.type)
  }

  updateEntities()
  render()
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
  width: 100%;
  height: 100%;
  display: block;
}
</style>
