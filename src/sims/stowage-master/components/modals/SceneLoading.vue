<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

// Animated container stack — cycles through shipping-line colours
const COLOURS = ['#e8212b', '#0057a8', '#00843d', '#ff6600', '#ffcc00', '#6a1b9a']
const stackTick = ref(0)
let tickInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  tickInterval = setInterval(() => { stackTick.value++ }, 420)
})
onUnmounted(() => {
  if (tickInterval !== null) clearInterval(tickInterval)
})

function boxColour(i: number): string {
  return COLOURS[(stackTick.value + i) % COLOURS.length]
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="store.isLoading"
      class="loading-overlay"
      aria-live="polite"
      aria-label="Loading"
    >
      <div class="panel">
        <!-- Animated crane arm -->
        <div class="crane-wrap">
          <svg
            class="crane-svg"
            viewBox="0 0 120 90"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <!-- Tower -->
            <rect x="54" y="20" width="8" height="65" fill="#607d8b" rx="2" />
            <!-- Jib (horizontal boom) -->
            <rect x="10" y="20" width="100" height="6" fill="#607d8b" rx="2" />
            <!-- Counter-jib -->
            <rect x="10" y="20" width="28" height="5" fill="#546e7a" rx="2" />
            <!-- Pendant cables from jib tip -->
            <line x1="110" y1="26" x2="62" y2="20" stroke="#78909c" stroke-width="1.5" />
            <line x1="10"  y1="26" x2="58" y2="20" stroke="#78909c" stroke-width="1.5" />
            <!-- Trolley (animated along jib) -->
            <rect
              class="trolley"
              x="68" y="19" width="14" height="8"
              fill="#ffcc00" rx="2"
            />
            <!-- Hoist rope from trolley -->
            <line
              class="hoist-rope"
              x1="75" y1="27" x2="75" y2="52"
              stroke="#aaa" stroke-width="1.5"
              stroke-dasharray="3 2"
            />
            <!-- Spreader bar -->
            <rect
              class="spreader"
              x="65" y="52" width="20" height="4"
              fill="#90a4ae" rx="1"
            />
          </svg>
        </div>

        <!-- Animated container stack -->
        <div class="stack">
          <div
            v-for="i in 4"
            :key="i"
            class="box"
            :style="{ background: boxColour(i), animationDelay: `${(4 - i) * 0.18}s` }"
          />
        </div>

        <p class="title">PORT OPERATIONS</p>
        <p class="message">{{ store.loadingMessage || 'Initialising terminal…' }}</p>

        <!-- Animated progress bar -->
        <div class="progress-track">
          <div class="progress-fill" />
        </div>

        <p class="hint">Stand clear of crane operating area</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 10, 20, 0.93);
  z-index: 200;
  pointer-events: all;
}

.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 36px 44px 28px;
  background: linear-gradient(160deg, #0b1320 0%, #0f1c35 100%);
  border: 1px solid rgba(255, 204, 0, 0.18);
  border-radius: 14px;
  box-shadow: 0 0 60px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 204, 0, 0.06);
  min-width: 300px;
  text-align: center;
}

/* ── Crane SVG ─────────────────────────────────────────────── */
.crane-wrap {
  width: 120px;
  height: 90px;
}

.crane-svg {
  width: 100%;
  height: 100%;
}

.trolley {
  animation: trolley-move 2.4s ease-in-out infinite alternate;
}

.hoist-rope {
  animation: trolley-move 2.4s ease-in-out infinite alternate;
}

.spreader {
  animation: trolley-move 2.4s ease-in-out infinite alternate;
}

@keyframes trolley-move {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-46px); }
}

/* ── Container stack ───────────────────────────────────────── */
.stack {
  display: flex;
  gap: 3px;
  align-items: flex-end;
}

.box {
  width: 28px;
  height: 18px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  animation: box-pop 0.84s ease-out infinite;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.3);
}

@keyframes box-pop {
  0%, 70%, 100% { transform: translateY(0); }
  35%            { transform: translateY(-5px); }
}

/* ── Text ──────────────────────────────────────────────────── */
.title {
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 3px;
  color: #ffcc00;
  margin: 0;
  text-transform: uppercase;
}

.message {
  font-size: 13px;
  color: #aac4d8;
  margin: 0;
  min-height: 1.4em;
  letter-spacing: 0.5px;
}

/* ── Progress bar ──────────────────────────────────────────── */
.progress-track {
  width: 220px;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #ffcc00, #ff9900);
  animation: progress-sweep 2.4s ease-in-out infinite;
  transform-origin: left;
}

@keyframes progress-sweep {
  0%   { width: 0%;   margin-left: 0; }
  50%  { width: 70%;  margin-left: 0; }
  100% { width: 0%;   margin-left: 100%; }
}

/* ── Hint ──────────────────────────────────────────────────── */
.hint {
  font-size: 10px;
  color: rgba(255, 200, 0, 0.35);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin: 0;
}

/* ── Transition ────────────────────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
