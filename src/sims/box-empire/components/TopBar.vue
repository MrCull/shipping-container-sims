<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useGameStore } from '../store/gameStore'
import MoneyDisplay from './ui/MoneyDisplay.vue'
import TimeControls from './ui/TimeControls.vue'

const store = useGameStore()
const router = useRouter()

function goToMenu(): void {
  store.resetToMenu()
  router.push('/')
}
</script>

<template>
  <div class="top-bar">
    <div class="top-bar-left">
      <button
        class="menu-btn"
        title="Back to main menu"
        @click="goToMenu"
      >
        ← Menu
      </button>
      <MoneyDisplay />
    </div>
    <div class="top-bar-center">
      <span class="sim-time">⏱ {{ Math.floor(store.simTime) }}s</span>
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

.menu-btn {
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.85);
  font-family: var(--font-retro, monospace);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}

.menu-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.6);
}

.sim-time {
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.8);
}
</style>
