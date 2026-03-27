<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../../store/gameStore'
import type { LevelFailReason } from '../../types'

const store = useContainerStackStore()
const { levelFailReason, currentLevel } = storeToRefs(store)

const title = computed(() => {
  const r = levelFailReason.value as LevelFailReason
  if (r === 'timeoutMove') return 'Move time ran out'
  if (r === 'timeoutLevel') return 'Level time ran out'
  return "Time's up"
})

const detail = computed(() => {
  const r = levelFailReason.value as LevelFailReason
  if (r === 'timeoutMove') return 'You must pull and place before the move clock hits zero.'
  if (r === 'timeoutLevel') return 'Complete enough moves before the level clock expires.'
  return 'Watch both timers on harder levels.'
})

function retry(): void {
  store.retryCurrentLevel()
}
</script>

<template>
  <div class="overlay">
    <div class="card">
      <h2 class="title">
        {{ title }}
      </h2>
      <p class="level">
        Level {{ currentLevel }}
      </p>
      <p class="detail">
        {{ detail }}
      </p>
      <button
        type="button"
        class="btn"
        @click="retry"
      >
        Retry level
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 8, 6, 0.9);
  z-index: 24;
}
.card {
  padding: 2rem 2.25rem;
  text-align: center;
  border-radius: 12px;
  border: 2px solid rgba(251, 191, 36, 0.55);
  background: rgba(35, 28, 15, 0.98);
  min-width: 300px;
}
.title {
  margin: 0 0 0.5rem;
  font-size: 1.35rem;
  color: #fde68a;
  font-family: var(--font-retro, ui-monospace, monospace);
}
.level {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: #fcd34d;
}
.detail {
  margin: 0 0 1.5rem;
  font-size: 0.88rem;
  line-height: 1.45;
  color: #d6d3d1;
}
.btn {
  padding: 0.65rem 1.75rem;
  font-weight: 700;
  font-family: var(--font-retro, ui-monospace, monospace);
  color: #1c1917;
  background: linear-gradient(180deg, #fcd34d, #f59e0b);
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.btn:hover {
  filter: brightness(1.05);
}
</style>
