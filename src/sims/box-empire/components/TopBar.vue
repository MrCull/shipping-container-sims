<script setup lang="ts">
import { useGameStore } from '../store/gameStore'
import MoneyDisplay from './ui/MoneyDisplay.vue'
import TimeControls from './ui/TimeControls.vue'

const store = useGameStore()
</script>

<template>
  <div class="top-bar">
    <div class="top-bar-left">
      <MoneyDisplay />
    </div>
    <div class="top-bar-center">
      <span class="sim-time">⏱ {{ Math.floor(store.simTime) }}s</span>
      <span
        v-if="!store.tutorialCompleted"
        class="tutorial-progress"
      >
        Step {{ store.tutorialStep }} / {{ store.totalTutorialSteps }}
      </span>
    </div>
    <div class="top-bar-right">
      <TimeControls />
    </div>
  </div>
</template>

<style scoped>
.top-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.3) 100%);
  z-index: 10;
  pointer-events: auto;
}

.top-bar-left,
.top-bar-center,
.top-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sim-time {
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.8);
}

.tutorial-progress {
  font-family: var(--font-retro, monospace);
  font-size: 0.8rem;
  color: var(--color-primary, #f59e0b);
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 8px;
  border-radius: 4px;
}
</style>
