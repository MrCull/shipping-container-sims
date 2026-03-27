<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, watch, computed } from 'vue'
import { useContainerStackStore } from '../../store/gameStore'
import { SCORING } from '../../modules/config'

const store = useContainerStackStore()
const { score, moveCount, comboStreak, lastScorePopup, phase } = storeToRefs(store)

const popupVisible = ref(false)
const popupValue = ref(0)

const comboMult = computed(() => {
  const i = Math.min(comboStreak.value, SCORING.comboTiers.length - 1)
  return SCORING.comboTiers[i] ?? 1
})

watch(lastScorePopup, v => {
  if (v > 0 && phase.value === 'playing') {
    popupValue.value = v
    popupVisible.value = true
    setTimeout(() => {
      popupVisible.value = false
    }, 900)
  }
})
</script>

<template>
  <div class="score-bar">
    <div class="stat">
      <span class="label">Score</span>
      <span class="value">{{ score }}</span>
    </div>
    <div class="stat">
      <span class="label">Moves</span>
      <span class="value">{{ moveCount }}</span>
    </div>
    <div
      class="stat combo"
      :class="{ hot: comboStreak > 2 }"
    >
      <span class="label">Combo</span>
      <span class="value">×{{ comboMult }}</span>
    </div>
    <Transition name="pop">
      <div
        v-if="popupVisible"
        class="score-popup"
      >
        +{{ popupValue }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.score-bar {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  padding: 0.65rem 1rem;
  background: rgba(15, 17, 23, 0.82);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 8px;
  font-family: var(--font-retro, ui-monospace, monospace);
  position: relative;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted, #9ca3af);
}
.value {
  font-size: 1.15rem;
  font-weight: 700;
  color: #f9fafb;
}
.combo.hot .value {
  color: #fbbf24;
}
.score-popup {
  position: absolute;
  right: 0.5rem;
  top: -1.5rem;
  font-size: 1.25rem;
  font-weight: 800;
  color: #4ade80;
  text-shadow: 0 0 12px rgba(74, 222, 128, 0.5);
  pointer-events: none;
}
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
