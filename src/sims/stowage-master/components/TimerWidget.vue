<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'

const store = useGameStore()

const minutes = computed(() => Math.floor(store.timerRemaining / 60))
const seconds = computed(() => Math.floor(store.timerRemaining % 60))

const timeDisplay = computed(() => {
  const m = minutes.value
  const s = seconds.value.toString().padStart(2, '0')
  return `${m}:${s}`
})

const isWarning = computed(() => store.timerRemaining <= 30 && store.timerRemaining > 10)
const isCritical = computed(() => store.timerRemaining <= 10)

const progressPercent = computed(() => {
  if (store.timerTotal <= 0) return 100
  return (store.timerRemaining / store.timerTotal) * 100
})
</script>

<template>
  <div
    v-if="store.phase !== 'start' && store.timerTotal > 0"
    class="timer-widget"
    :class="{ warning: isWarning, critical: isCritical }"
  >
    <div class="timer-label">
      TIME
    </div>
    <div class="timer-display">
      {{ timeDisplay }}
    </div>
    <div class="timer-track">
      <div
        class="timer-fill"
        :style="{ width: progressPercent + '%' }"
      />
    </div>
  </div>
</template>

<style scoped>
.timer-widget {
  position: absolute;
  top: 44px;
  right: 250px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 16px 8px;
  background: rgba(0, 0, 0, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  z-index: 10;
  pointer-events: none;
  backdrop-filter: blur(4px);
  min-width: 100px;
  transition: border-color 0.3s;
}
.timer-widget.warning {
  border-color: rgba(255, 170, 0, 0.6);
  background: rgba(60, 40, 0, 0.82);
}
.timer-widget.critical {
  border-color: rgba(255, 60, 60, 0.8);
  background: rgba(60, 10, 10, 0.88);
  animation: pulse-border 0.5s ease-in-out infinite alternate;
}
@keyframes pulse-border {
  from { border-color: rgba(255, 60, 60, 0.4); }
  to   { border-color: rgba(255, 60, 60, 1.0); }
}
.timer-label {
  font-size: 10px;
  color: #aaa;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
.timer-display {
  font-size: 26px;
  font-weight: bold;
  font-family: var(--font-retro, monospace);
  color: #00ff88;
  line-height: 1;
  transition: color 0.3s;
}
.timer-widget.warning .timer-display {
  color: #ffaa00;
}
.timer-widget.critical .timer-display {
  color: #ff4444;
}
.timer-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}
.timer-fill {
  height: 100%;
  background: #00ff88;
  border-radius: 2px;
  transition: width 0.5s linear, background-color 0.3s;
}
.timer-widget.warning .timer-fill {
  background: #ffaa00;
}
.timer-widget.critical .timer-fill {
  background: #ff4444;
}
</style>
