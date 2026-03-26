<script setup lang="ts">
import { useGameStore } from '../store/gameStore'

const store = useGameStore()
</script>

<template>
  <div
    v-if="store.phase !== 'start'"
    class="top-bar"
  >
    <div class="title">
      STOWAGE MASTER
    </div>
    <div class="level">
      {{ store.levelConfig?.name }}
    </div>
    <div class="score">
      Score: <span class="score-value">{{ store.score.toLocaleString() }}</span>
      / {{ store.targetScore.toLocaleString() }}
    </div>
  </div>
</template>

<style scoped>
.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 100%);
  z-index: 10;
  pointer-events: none;
}
.title {
  font-size: 18px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #ffcc00;
}
.level {
  font-size: 14px;
  color: #aaa;
}
.score {
  font-size: 14px;
  color: #eee;
}
.score-value {
  color: #00ff88;
  font-weight: bold;
}
</style>
