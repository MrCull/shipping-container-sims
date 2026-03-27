<script setup lang="ts">
import { computed, watch, ref, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../../store/gameStore'
import { getLevelTimeLimitSec, getMoveTimeLimitSec, MOVES_PER_LEVEL } from '../../modules/levelConfig'
import { playStackSound } from '../../modules/audioPlayer'

const store = useContainerStackStore()
const {
  phase,
  currentLevel,
  movesInLevel,
  levelTimeRemainingSec,
  moveTimeRemainingSec,
} = storeToRefs(store)

const levelLimit = computed(() => getLevelTimeLimitSec(currentLevel.value))
const moveLimit = computed(() => getMoveTimeLimitSec(currentLevel.value))

const levelPct = computed(() =>
  levelLimit.value > 0 ? Math.min(100, (levelTimeRemainingSec.value / levelLimit.value) * 100) : 0
)
const movePct = computed(() =>
  moveLimit.value > 0 ? Math.min(100, (moveTimeRemainingSec.value / moveLimit.value) * 100) : 0
)

const levelCeil = computed(() => Math.ceil(Math.max(0, levelTimeRemainingSec.value)))
const moveCeil = computed(() => Math.ceil(Math.max(0, moveTimeRemainingSec.value)))

const minRemainingCeil = computed(() => Math.min(levelCeil.value, moveCeil.value))

const urgencyWarn = computed(
  () => levelPct.value < 28 || movePct.value < 28 || minRemainingCeil.value <= 10
)
const urgencyCritical = computed(
  () => levelPct.value < 14 || movePct.value < 14 || minRemainingCeil.value <= 5
)

function fmt(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`
}

const prevMinCeil = ref(-1)

function playSecondTick(remainingCeil: number): void {
  if (remainingCeil <= 0 || remainingCeil > 10) return
  if (remainingCeil >= 7) {
    playStackSound('countdownTick', 0.2, 1.02 + (10 - remainingCeil) * 0.02)
  } else if (remainingCeil >= 4) {
    playStackSound('countdownUrgent', 0.32, 1.08 + (6 - remainingCeil) * 0.04)
  } else {
    playStackSound('countdownUrgent', 0.42 + (3 - remainingCeil) * 0.06, 1.22 + (3 - remainingCeil) * 0.08)
  }
}

function resetCountdownTracking(): void {
  prevMinCeil.value = -1
}

watch(
  [levelTimeRemainingSec, moveTimeRemainingSec, phase],
  () => {
    const active =
      phase.value === 'playing' ||
      phase.value === 'removing' ||
      phase.value === 'placing'
    if (!active) {
      resetCountdownTracking()
      return
    }

    const curMin = Math.min(levelCeil.value, moveCeil.value)

    if (prevMinCeil.value < 0) {
      prevMinCeil.value = curMin
      return
    }

    if (curMin < prevMinCeil.value && curMin >= 1 && curMin <= 10) {
      playSecondTick(curMin)
    }

    prevMinCeil.value = curMin
  },
  { flush: 'sync' }
)

watch(phase, p => {
  if (p === 'start' || p === 'levelComplete' || p === 'levelFailed' || p === 'gameOver') {
    resetCountdownTracking()
  }
})

onUnmounted(resetCountdownTracking)
</script>

<template>
  <div
    v-if="phase === 'playing' || phase === 'removing' || phase === 'placing'"
    class="timer-bar-wrap"
    :class="{ warn: urgencyWarn, critical: urgencyCritical }"
  >
    <div class="timer-bar">
      <div class="row head">
        <span class="lab">Level {{ currentLevel }}</span>
        <span class="moves">{{ movesInLevel }} / {{ MOVES_PER_LEVEL }} moves</span>
      </div>
      <div class="row track-row">
        <span class="mini">Level</span>
        <div class="track">
          <div
            class="fill level"
            :class="{ warn: levelPct < 28, crit: levelPct < 14 }"
            :style="{ width: levelPct + '%' }"
          />
        </div>
        <span
          class="time"
          :class="{ warn: levelPct < 28, crit: levelPct < 14 }"
        >
          {{ fmt(levelTimeRemainingSec) }}
        </span>
      </div>
      <div class="row track-row">
        <span class="mini">Move</span>
        <div class="track">
          <div
            class="fill move"
            :class="{ warn: movePct < 28, crit: movePct < 14 }"
            :style="{ width: movePct + '%' }"
          />
        </div>
        <span
          class="time"
          :class="{ warn: movePct < 28, crit: movePct < 14 }"
        >
          {{ fmt(moveTimeRemainingSec) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timer-bar-wrap {
  position: relative;
  flex: 0 1 auto;
  margin-top: -0.2rem;
  z-index: 12;
  pointer-events: none;
  transition: filter 0.15s ease;
}
.timer-bar-wrap.warn {
  animation: pulse-bar 1.1s ease-in-out infinite;
}
.timer-bar-wrap.critical {
  animation: pulse-bar 0.55s ease-in-out infinite;
  filter: drop-shadow(0 0 14px rgba(239, 68, 68, 0.55));
}
@keyframes pulse-bar {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.03);
    opacity: 0.92;
  }
}
.timer-bar {
  min-width: min(280px, 42vw);
  padding: 0.75rem 1rem;
  background: rgba(8, 10, 16, 0.92);
  border: 2px solid rgba(56, 189, 248, 0.45);
  border-radius: 12px;
  font-family: var(--font-retro, ui-monospace, monospace);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
}
.timer-bar-wrap.warn .timer-bar {
  border-color: rgba(251, 191, 36, 0.65);
  box-shadow:
    0 0 24px rgba(251, 191, 36, 0.2),
    0 8px 32px rgba(0, 0, 0, 0.45);
}
.timer-bar-wrap.critical .timer-bar {
  border-color: rgba(248, 113, 113, 0.85);
  box-shadow:
    0 0 28px rgba(239, 68, 68, 0.35),
    0 8px 32px rgba(0, 0, 0, 0.5);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  margin-bottom: 0.45rem;
}
.row:last-child {
  margin-bottom: 0;
}
.head {
  margin-bottom: 0.55rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.lab {
  font-size: 0.82rem;
  font-weight: 800;
  color: #f1f5f9;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.moves {
  font-size: 0.72rem;
  font-weight: 600;
  color: #94a3b8;
}
.track-row {
  margin-bottom: 0.4rem;
}
.mini {
  width: 3rem;
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #64748b;
}
.track {
  flex: 1;
  height: 11px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.35);
}
.fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.1s linear, background 0.2s ease, box-shadow 0.2s ease;
}
.fill.level {
  background: linear-gradient(90deg, #0284c7, #38bdf8);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.35);
}
.fill.move {
  background: linear-gradient(90deg, #7c3aed, #c4b5fd);
  box-shadow: 0 0 10px rgba(167, 139, 250, 0.35);
}
.fill.warn {
  background: linear-gradient(90deg, #ea580c, #fbbf24);
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.45);
}
.fill.crit {
  background: linear-gradient(90deg, #dc2626, #f87171);
  box-shadow: 0 0 14px rgba(239, 68, 68, 0.55);
  animation: flash-fill 0.5s ease-in-out infinite alternate;
}
@keyframes flash-fill {
  from {
    filter: brightness(1);
  }
  to {
    filter: brightness(1.18);
  }
}
.time {
  width: 3.2rem;
  flex-shrink: 0;
  text-align: right;
  font-size: 0.95rem;
  font-weight: 800;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
}
.time.warn {
  color: #fde68a;
}
.time.crit {
  color: #fecaca;
  animation: flash-text 0.45s ease-in-out infinite alternate;
}
@keyframes flash-text {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0.88;
    transform: scale(1.06);
  }
}
</style>
