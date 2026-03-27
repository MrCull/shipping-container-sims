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

const pct = computed(() => store.timerTotal > 0 ? store.timerRemaining / store.timerTotal : 1)
const isWarning = computed(() => pct.value <= 0.30 && pct.value > 0.15)
const isCritical = computed(() => pct.value <= 0.15)

const progressPercent = computed(() => Math.max(0, pct.value * 100))
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
  transition: border-color 0.3s, background 0.3s;
}
.timer-widget.warning {
  border-color: rgba(255, 170, 0, 0.7);
  background: rgba(60, 35, 0, 0.88);
  animation: pulse-warning 1s ease-in-out infinite alternate;
}
.timer-widget.critical {
  border-color: rgba(255, 40, 40, 1.0);
  background: rgba(80, 0, 0, 0.92);
  animation: pulse-critical 0.4s ease-in-out infinite alternate;
}
@keyframes pulse-warning {
  from { box-shadow: 0 0 4px rgba(255, 170, 0, 0.2); border-color: rgba(255, 170, 0, 0.3); }
  to   { box-shadow: 0 0 16px rgba(255, 170, 0, 0.7); border-color: rgba(255, 170, 0, 1.0); }
}
@keyframes pulse-critical {
  from { box-shadow: 0 0 8px rgba(255, 40, 40, 0.4); border-color: rgba(255, 40, 40, 0.5); transform: scale(1.00); }
  to   { box-shadow: 0 0 28px rgba(255, 40, 40, 1.0); border-color: rgba(255, 40, 40, 1.0); transform: scale(1.04); }
}
.timer-label {
  font-size: 10px;
  color: #aaa;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
.timer-display {
  font-size: 28px;
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
  color: #ff3333;
  animation: flash-text 0.4s ease-in-out infinite alternate;
}
@keyframes flash-text {
  from { opacity: 1; }
  to   { opacity: 0.55; }
}
.timer-track {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 3px;
}
.timer-fill {
  height: 100%;
  background: #00ff88;
  border-radius: 3px;
  transition: width 0.5s linear, background-color 0.3s;
}
.timer-widget.warning .timer-fill {
  background: #ffaa00;
}
.timer-widget.critical .timer-fill {
  background: #ff3333;
}
</style>
