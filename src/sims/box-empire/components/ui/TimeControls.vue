<script setup lang="ts">
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

const speedOptions = [0, 1, 2, 3, 5, 10, 20, 50, 100]
</script>

<template>
  <div class="time-controls">
    <button
      v-for="speed in speedOptions"
      :key="speed"
      class="speed-btn"
      :class="{ active: store.timeScale === speed }"
      @click="store.setTimeScale(speed)"
    >
      {{ speed === 0 ? '⏸' : `${speed}×` }}
    </button>
  </div>
</template>

<style scoped>
.time-controls {
  display: flex;
  gap: 4px;
}

.speed-btn {
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  font-size: 0.8rem;
  font-family: var(--font-retro, monospace);
  transition: all 0.15s;
}

.speed-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.speed-btn.active {
  background: var(--color-primary, #f59e0b);
  border-color: var(--color-primary, #f59e0b);
  color: #000;
  font-weight: bold;
}
</style>
