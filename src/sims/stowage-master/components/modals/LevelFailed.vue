<script setup lang="ts">
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

function restart() {
  store.startLevel(store.currentLevel)
}
</script>

<template>
  <div
    v-if="store.phase === 'failed'"
    class="modal-overlay"
  >
    <div class="modal-content">
      <h2 class="failed-title">
        Level Failed
      </h2>
      <div class="score-info">
        <div>Your Score: <span class="actual">{{ store.score.toLocaleString() }}</span></div>
        <div>Required: <span class="required">{{ store.targetScore.toLocaleString() }}</span></div>
      </div>
      <button
        class="btn"
        @click="restart"
      >
        Try Again
      </button>
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
  background: rgba(50, 20, 20, 0.95);
  border: 1px solid rgba(255, 68, 68, 0.3);
  border-radius: 12px;
  padding: 40px;
  min-width: 300px;
}
.failed-title {
  font-size: 32px;
  color: #ff4444;
  margin-bottom: 20px;
}
.score-info {
  font-size: 16px;
  color: #ccc;
  margin-bottom: 24px;
  line-height: 1.8;
}
.actual { color: #ffaa00; font-weight: bold; }
.required { color: #00ff88; font-weight: bold; }
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
</style>
