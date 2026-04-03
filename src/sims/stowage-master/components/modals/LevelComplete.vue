<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../../store/gameStore'
import { LEVELS } from '../../modules/levels'
import StarRating from '../ui/StarRating.vue'

const store = useGameStore()

const rating = computed(() => store.getStarRatingResult())
const hasNextLevel = computed(() => store.currentLevel < LEVELS.length - 1)
const hasLoadPhase = computed(() => store.containers.length > 0)

function restart() {
  store.startLevel(store.currentLevel)
}

function nextLevel() {
  store.startLevel(store.currentLevel + 1)
}
</script>

<template>
  <div
    v-if="store.phase === 'complete'"
    class="modal-overlay"
  >
    <div class="modal-content">
      <h2 class="complete-title">
        Level Complete!
      </h2>
      <StarRating :stars="rating.stars" />
      <div class="rating-title">
        {{ rating.title }}
      </div>
      <div
        v-if="store.dischargeCount > 0"
        class="breakdown"
      >
        <div class="breakdown-row">
          <span class="breakdown-label">Discharge earnings</span>
          <span class="breakdown-value discharge">${{ store.dischargeScore.toLocaleString() }}</span>
        </div>
        <div
          v-if="hasLoadPhase"
          class="breakdown-row"
        >
          <span class="breakdown-label">Loading score</span>
          <span class="breakdown-value load">${{ store.score.toLocaleString() }}</span>
        </div>
        <div class="breakdown-divider" />
      </div>
      <div class="score-display">
        ${{ store.score.toLocaleString() }} / ${{ store.perfectScore.toLocaleString() }}
      </div>
      <div class="pass-threshold">
        Target: ${{ store.targetScore.toLocaleString() }}
      </div>
      <div class="actions">
        <button
          class="btn"
          @click="restart"
        >
          Restart
        </button>
        <button
          v-if="hasNextLevel"
          class="btn btn-primary"
          @click="nextLevel"
        >
          Next Level
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  z-index: 100;
}
.modal-content {
  text-align: center;
  background: rgba(20, 30, 50, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 40px;
  min-width: 350px;
}
.complete-title {
  font-size: 32px;
  color: #00ff88;
  margin-bottom: 16px;
}
.rating-title {
  font-size: 18px;
  color: #ffcc00;
  margin: 12px 0;
}
.score-display {
  font-size: 16px;
  color: #aaa;
  margin-bottom: 4px;
}
.pass-threshold {
  font-size: 13px;
  color: #666;
  margin-bottom: 24px;
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.btn {
  padding: 10px 24px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #eee;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.btn-primary {
  background: rgba(0, 255, 136, 0.15);
  border-color: #00ff88;
  color: #00ff88;
}
.btn-primary:hover {
  background: rgba(0, 255, 136, 0.25);
}

.breakdown {
  margin: 12px 0 8px;
  text-align: left;
}

.breakdown-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 4px;
}

.breakdown-label {
  color: #888;
}

.breakdown-value {
  font-weight: bold;
}

.breakdown-value.discharge {
  color: #ff8800;
}

.breakdown-value.load {
  color: #00ff88;
}

.breakdown-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 8px 0 4px;
}
</style>
