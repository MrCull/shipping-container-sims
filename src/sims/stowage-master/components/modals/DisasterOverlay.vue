<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

const disasterTitle = computed(() => {
  switch (store.disasterType) {
    case 'capsize': return 'CAPSIZE!'
    case 'founder': return 'FOUNDER!'
    case 'collapse': return 'STACK COLLAPSE!'
    case 'explosion': return 'EXPLOSION!'
    default: return 'DISASTER!'
  }
})

const disasterDesc = computed(() => {
  switch (store.disasterType) {
    case 'capsize': return 'The ship has rolled over due to extreme list!'
    case 'founder': return 'The ship has sunk due to extreme trim!'
    case 'collapse': return 'Stack weight exceeded! Containers everywhere!'
    case 'explosion': return 'Hazmat containers too close - catastrophic detonation!'
    default: return 'Something went terribly wrong!'
  }
})

const pulseClass = computed(() => store.disasterType === 'explosion' ? 'pulse-fast' : 'pulse')

function restart() {
  store.startLevel(store.currentLevel)
}
</script>

<template>
  <div
    v-if="store.phase === 'disaster'"
    class="modal-overlay disaster-overlay"
  >
    <div class="disaster-content">
      <h2
        class="disaster-title"
        :class="pulseClass"
      >
        {{ disasterTitle }}
      </h2>
      <p class="disaster-desc">
        {{ disasterDesc }}
      </p>
      <button
        class="btn"
        @click="restart"
      >
        Restart Level
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
  z-index: 100;
}
.disaster-overlay {
  background: rgba(80, 0, 0, 0.7);
}
.disaster-content {
  text-align: center;
  padding: 40px;
}
.disaster-title {
  font-size: 56px;
  font-weight: bold;
  color: #ff4444;
  text-shadow: 0 0 30px rgba(255, 0, 0, 0.8);
  margin-bottom: 16px;
}
.pulse {
  animation: pulse 1s ease-in-out infinite;
}
.pulse-fast {
  animation: pulse 0.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}
.disaster-desc {
  font-size: 18px;
  color: #ffaa88;
  margin-bottom: 30px;
}
.btn {
  padding: 12px 30px;
  border: 2px solid #ff4444;
  border-radius: 6px;
  background: rgba(255, 68, 68, 0.15);
  color: #ff8888;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:hover {
  background: rgba(255, 68, 68, 0.3);
  color: #fff;
}
</style>
