<script setup lang="ts">
import { useGameStore } from '../store/gameStore'
import type { PlacementReason } from '../types'

const store = useGameStore()

function reasonClass(reason: PlacementReason): string {
  if (reason.good) return 'good'
  if (reason.points < -30) return 'bad'
  if (reason.points < 0) return 'warn'
  return ''
}
</script>

<template>
  <div
    v-if="store.lastPlacement && store.phase === 'selecting'"
    class="last-placement panel"
  >
    <div class="panel-title">
      Last Placement
    </div>
    <div class="placement-score">
      {{ store.lastPlacement.score }} pts
    </div>
    <div
      v-for="(reason, i) in store.lastPlacement.reasons"
      :key="i"
      class="reason"
      :class="reasonClass(reason)"
    >
      <span v-if="reason.points < 0">{{ reason.points }}</span>
      <span
        v-else-if="reason.good"
        class="good-mark"
      >+</span>
      {{ reason.text }}
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: absolute;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 10px 14px;
  z-index: 10;
  pointer-events: none;
  backdrop-filter: blur(4px);
}
.last-placement {
  top: 200px;
  right: 12px;
  min-width: 220px;
}
.panel-title {
  font-size: 12px;
  font-weight: bold;
  color: #ffcc00;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.placement-score {
  font-size: 20px;
  font-weight: bold;
  color: #00ff88;
  margin-bottom: 6px;
}
.reason {
  font-size: 11px;
  padding: 2px 0;
  color: #ccc;
}
.reason.good { color: #00ff88; }
.reason.warn { color: #ffaa00; }
.reason.bad { color: #ff4444; }
.good-mark { font-weight: bold; }
</style>
