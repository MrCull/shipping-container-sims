<script setup lang="ts">
import { computed, watch, ref } from 'vue'
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

function fmt(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`
}

const warnedLevel = ref(false)
const warnedMove = ref(false)

watch(levelTimeRemainingSec, v => {
  if (phase.value !== 'playing' && phase.value !== 'removing' && phase.value !== 'placing') return
  const lim = levelLimit.value
  if (lim > 0 && v > 0 && v <= lim * 0.2 && !warnedLevel.value) {
    warnedLevel.value = true
    playStackSound('tickClock', 0.35, 1.15)
  }
  if (v > lim * 0.25) warnedLevel.value = false
})

watch(moveTimeRemainingSec, v => {
  if (phase.value !== 'playing' && phase.value !== 'removing' && phase.value !== 'placing') return
  const lim = moveLimit.value
  if (lim > 0 && v > 0 && v <= lim * 0.2 && !warnedMove.value) {
    warnedMove.value = true
    playStackSound('tickClock', 0.32, 1.25)
  }
  if (v > lim * 0.25) warnedMove.value = false
})

watch(phase, p => {
  if (p === 'start' || p === 'levelComplete' || p === 'levelFailed') {
    warnedLevel.value = false
    warnedMove.value = false
  }
})
</script>

<template>
  <div
    v-if="phase === 'playing' || phase === 'removing' || phase === 'placing'"
    class="timer-bar"
  >
    <div class="row">
      <span class="lab">Level {{ currentLevel }}</span>
      <span class="moves">{{ movesInLevel }} / {{ MOVES_PER_LEVEL }} moves</span>
    </div>
    <div class="row track-row">
      <span class="mini">Level</span>
      <div class="track">
        <div
          class="fill level"
          :class="{ warn: levelPct < 22 }"
          :style="{ width: levelPct + '%' }"
        />
      </div>
      <span class="time">{{ fmt(levelTimeRemainingSec) }}</span>
    </div>
    <div class="row track-row">
      <span class="mini">Move</span>
      <div class="track">
        <div
          class="fill move"
          :class="{ warn: movePct < 22 }"
          :style="{ width: movePct + '%' }"
        />
      </div>
      <span class="time">{{ fmt(moveTimeRemainingSec) }}</span>
    </div>
  </div>
</template>

<style scoped>
.timer-bar {
  min-width: 220px;
  padding: 0.55rem 0.75rem;
  background: rgba(15, 17, 23, 0.88);
  border: 1px solid rgba(56, 189, 248, 0.25);
  border-radius: 8px;
  font-family: var(--font-retro, ui-monospace, monospace);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.row:last-child {
  margin-bottom: 0;
}
.lab {
  font-size: 0.72rem;
  font-weight: 700;
  color: #e2e8f0;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.moves {
  font-size: 0.65rem;
  color: #94a3b8;
}
.track-row {
  margin-bottom: 0.3rem;
}
.mini {
  width: 2.6rem;
  flex-shrink: 0;
  font-size: 0.58rem;
  text-transform: uppercase;
  color: #64748b;
}
.track {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.12s linear;
}
.fill.level {
  background: linear-gradient(90deg, #0ea5e9, #38bdf8);
}
.fill.move {
  background: linear-gradient(90deg, #a78bfa, #c4b5fd);
}
.fill.warn {
  background: linear-gradient(90deg, #f97316, #ef4444);
}
.time {
  width: 2.5rem;
  flex-shrink: 0;
  text-align: right;
  font-size: 0.68rem;
  font-weight: 700;
  color: #cbd5e1;
}
</style>
