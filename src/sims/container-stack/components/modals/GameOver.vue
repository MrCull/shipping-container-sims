<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../../store/gameStore'

const store = useContainerStackStore()
const { score, moveCount } = storeToRefs(store)

const emit = defineEmits<{ restart: [] }>()

function again(): void {
  store.restartToStart()
  emit('restart')
}
</script>

<template>
  <div class="overlay">
    <div class="card">
      <h2 class="title">
        Stack down
      </h2>
      <p class="score-line">
        Final score <strong>{{ score }}</strong>
      </p>
      <p class="moves">
        Moves completed: {{ moveCount }}
      </p>
      <button
        type="button"
        class="btn"
        @click="again"
      >
        Play again
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
  background: rgba(5, 6, 10, 0.88);
  z-index: 25;
}
.card {
  padding: 2rem 2.25rem;
  text-align: center;
  border-radius: 12px;
  border: 2px solid rgba(239, 68, 68, 0.5);
  background: rgba(20, 22, 30, 0.98);
  min-width: 280px;
}
.title {
  margin: 0 0 1rem;
  font-size: 1.5rem;
  color: #fecaca;
  font-family: var(--font-retro, ui-monospace, monospace);
}
.score-line {
  margin: 0 0 0.5rem;
  color: #e5e7eb;
  font-size: 1.05rem;
}
.score-line strong {
  color: #fbbf24;
  font-size: 1.25rem;
}
.moves {
  margin: 0 0 1.5rem;
  font-size: 0.85rem;
  color: #9ca3af;
}
.btn {
  padding: 0.65rem 1.75rem;
  font-weight: 700;
  font-family: var(--font-retro, ui-monospace, monospace);
  color: #0f1117;
  background: #ef4444;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.btn:hover {
  filter: brightness(1.08);
}
</style>
