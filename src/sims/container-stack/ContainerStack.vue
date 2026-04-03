<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import GameCanvas from './components/GameCanvas.vue'
import ScoreBar from './components/ui/ScoreBar.vue'
import TowerStability from './components/ui/TowerStability.vue'
import Instructions from './components/ui/Instructions.vue'
import KeyboardHint from './components/ui/KeyboardHint.vue'
import StartScreen from './components/modals/StartScreen.vue'
import GameOver from './components/modals/GameOver.vue'
import PauseMenu from './components/modals/PauseMenu.vue'
import LevelCompleteModal from './components/modals/LevelCompleteModal.vue'
import LevelFailedModal from './components/modals/LevelFailedModal.vue'
import TimerBar from './components/ui/TimerBar.vue'
import { useContainerStackStore } from './store/gameStore'
import { playStackSound } from './modules/audioPlayer'
import { useGameMusic } from './composables/useGameMusic'

useGameMusic()

const store = useContainerStackStore()
const { phase } = storeToRefs(store)

const pauseOpen = ref(false)

function onKey(e: KeyboardEvent): void {
  if (e.code !== 'Escape') return
  if (phase.value !== 'playing' && phase.value !== 'paused') return
  if (pauseOpen.value) {
    pauseOpen.value = false
    store.setPaused(false)
  } else {
    pauseOpen.value = true
    store.setPaused(true)
  }
}

watch(phase, p => {
  if (p === 'levelFailed') {
    playStackSound('boo', 0.68)
  }
  if (p !== 'paused') {
    pauseOpen.value = false
  }
})

onMounted(() => {
  // Reset game state when component mounts (e.g., returning from menu)
  if (phase.value !== 'start') {
    store.restartToStart()
  }
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="container-stack">
    <GameCanvas />
    <div class="hud-top">
      <div class="hud-left">
        <div class="hud-row">
          <ScoreBar />
          <TimerBar />
        </div>
      </div>
      <TowerStability />
    </div>
    <div class="hud-bottom">
      <Instructions />
      <p class="pause-hint">
        WASD / arrows — orbit camera · + / − — zoom · Esc — pause
      </p>
    </div>
    <KeyboardHint v-if="phase !== 'start'" />
    <StartScreen v-if="phase === 'start'" />
    <GameOver v-if="phase === 'gameOver'" />
    <LevelCompleteModal v-if="phase === 'levelComplete'" />
    <LevelFailedModal v-if="phase === 'levelFailed'" />
    <PauseMenu
      :open="pauseOpen"
      @close="pauseOpen = false"
    />
  </div>
</template>

<style scoped>
.container-stack {
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
  background: #0a0c10;
  font-family: var(--font-body, system-ui, sans-serif);
  color: #e5e7eb;
}
.hud-top {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  right: 0.75rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  pointer-events: none;
  z-index: 10;
}
.hud-top > * {
  pointer-events: auto;
}
.hud-left {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  align-items: flex-start;
}
.hud-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.85rem 1rem;
}
.hud-bottom {
  position: absolute;
  bottom: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  z-index: 10;
  pointer-events: none;
}
.pause-hint {
  margin: 0;
  font-size: 0.65rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
</style>
