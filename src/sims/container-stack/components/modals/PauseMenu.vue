<script setup lang="ts">
import { useContainerStackStore } from '../../store/gameStore'

const store = useContainerStackStore()

defineProps<{ open: boolean }>()

const emit = defineEmits<{ close: [] }>()

function resume(): void {
  store.setPaused(false)
  emit('close')
}

function restart(): void {
  store.setPaused(false)
  store.restartToStart()
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    class="overlay"
  >
    <div class="card">
      <h2 class="title">
        Paused
      </h2>
      <button
        type="button"
        class="btn primary"
        @click="resume"
      >
        Resume
      </button>
      <button
        type="button"
        class="btn ghost"
        @click="restart"
      >
        Quit to menu
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
  background: rgba(5, 6, 10, 0.75);
  z-index: 22;
}
.card {
  padding: 1.75rem 2rem;
  border-radius: 12px;
  background: rgba(24, 27, 35, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 240px;
}
.title {
  margin: 0 0 0.5rem;
  text-align: center;
  font-size: 1.25rem;
  color: #f9fafb;
  font-family: var(--font-retro, ui-monospace, monospace);
}
.btn {
  padding: 0.55rem 1rem;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}
.btn.primary {
  background: #ef4444;
  color: #0f1117;
}
.btn.ghost {
  background: transparent;
  color: #9ca3af;
  border: 1px solid rgba(255, 255, 255, 0.15);
}
</style>
