<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'
import type { PlacementReason } from '../types'

const store = useGameStore()

const isDischargePhase = computed(() =>
  store.phase === 'discharge_selecting' || store.phase === 'discharge_animating'
)

function reasonClass(reason: PlacementReason): string {
  if (reason.good) return 'good'
  if (reason.points < -30) return 'bad'
  if (reason.points < 0) return 'warn'
  return ''
}
</script>

<template>
  <div
    v-if="store.lastDischarge && isDischargePhase"
    class="last-discharge panel"
  >
    <div class="panel-title">
      Last Discharge
    </div>
    <div class="discharge-score">
      +${{ store.lastDischarge.score }}
    </div>
    <div
      v-for="(reason, i) in store.lastDischarge.reasons"
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

.last-discharge {
  top: 230px;
  left: 12px;
  min-width: 220px;
}

.panel-title {
  font-size: 12px;
  font-weight: bold;
  color: #ff8800;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.discharge-score {
  font-size: 20px;
  font-weight: bold;
  color: #ffaa00;
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
