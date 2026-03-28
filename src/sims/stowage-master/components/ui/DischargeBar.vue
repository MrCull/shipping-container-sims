<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

const progressPercent = computed(() =>
  store.dischargeCount > 0
    ? (store.dischargedCount / store.dischargeCount) * 100
    : 0
)
</script>

<template>
  <div
    v-if="store.phase === 'discharge_selecting' || store.phase === 'discharge_animating'"
    class="discharge-bar"
  >
    <div class="discharge-label">
      DISCHARGE PHASE
    </div>
    <div class="discharge-progress-track">
      <div
        class="discharge-progress-fill"
        :style="{ width: progressPercent + '%' }"
      />
    </div>
    <div class="discharge-counts">
      <span class="discharged">{{ store.dischargedCount }}</span>
      <span class="sep"> / </span>
      <span class="total">{{ store.dischargeCount }}</span>
      <span class="units"> containers unloaded</span>
    </div>
    <div class="discharge-score">
      ${{ store.dischargeScore.toLocaleString() }} discharge earnings
    </div>
  </div>
</template>

<style scoped>
.discharge-bar {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 136, 0, 0.5);
  border-radius: 8px;
  padding: 10px 20px;
  text-align: center;
  min-width: 260px;
  z-index: 10;
  pointer-events: none;
}

.discharge-label {
  font-size: 11px;
  letter-spacing: 2px;
  color: #ff8800;
  font-weight: bold;
  margin-bottom: 6px;
}

.discharge-progress-track {
  height: 6px;
  background: rgba(255, 136, 0, 0.2);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;
}

.discharge-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff6600, #ffaa00);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.discharge-counts {
  font-size: 13px;
  color: #eee;
}

.discharged {
  color: #ffaa00;
  font-weight: bold;
}

.sep,
.total,
.units {
  color: #888;
}

.discharge-score {
  font-size: 11px;
  color: #ff8800;
  margin-top: 4px;
}
</style>
