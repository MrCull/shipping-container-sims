<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'

const store = useGameStore()

const isDischargePhase = computed(() =>
  store.phase === 'discharge_selecting' || store.phase === 'discharge_animating'
)
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
      <span>{{ store.levelConfig?.name }}</span>
      <span
        v-if="isDischargePhase"
        class="phase-badge"
      >DISCHARGE</span>
      <span
        v-else-if="store.phase !== 'complete' && store.phase !== 'failed' && store.phase !== 'disaster'"
        class="phase-badge phase-badge--load"
      >LOAD</span>
    </div>
    <div class="score">
      <span
        class="score-value"
        :class="{ negative: store.score < 0 }"
      >${{ store.score.toLocaleString() }}</span>
      <span class="score-sep">/</span>
      <span class="score-target">${{ store.targetScore.toLocaleString() }}</span>
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
  font-size: 16px;
}
.score-value.negative {
  color: #ff4444;
}
.score-sep {
  color: #666;
  margin: 0 4px;
}
.score-target {
  color: #888;
  font-size: 13px;
}

.phase-badge {
  display: inline-block;
  margin-left: 8px;
  font-size: 10px;
  font-weight: bold;
  letter-spacing: 1px;
  background: rgba(255, 136, 0, 0.2);
  border: 1px solid rgba(255, 136, 0, 0.6);
  color: #ff8800;
  border-radius: 4px;
  padding: 1px 6px;
  vertical-align: middle;
}

.phase-badge--load {
  background: rgba(0, 255, 136, 0.1);
  border-color: rgba(0, 255, 136, 0.4);
  color: #00ff88;
}
</style>
