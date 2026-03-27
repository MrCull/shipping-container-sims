<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../../store/gameStore'
import { playStackSound } from '../../modules/audioPlayer'

const store = useContainerStackStore()
const { currentLevel } = storeToRefs(store)

onMounted(() => {
  playStackSound('levelPassedOk', 0.5)
})

function onContinue(): void {
  playStackSound('levelUp', 0.55)
  store.continueToNextLevel()
}
</script>

<template>
  <div class="overlay">
    <div class="card">
      <h2 class="title">
        Level {{ currentLevel }} cleared
      </h2>
      <p class="sub">
        Timers get tighter next round. Stack on.
      </p>
      <button
        type="button"
        class="btn"
        @click="onContinue"
      >
        Next level
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
  background: rgba(5, 10, 16, 0.88);
  z-index: 24;
}
.card {
  padding: 2rem 2.25rem;
  text-align: center;
  border-radius: 12px;
  border: 2px solid rgba(34, 197, 94, 0.55);
  background: rgba(15, 28, 22, 0.98);
  min-width: 280px;
}
.title {
  margin: 0 0 0.75rem;
  font-size: 1.45rem;
  color: #86efac;
  font-family: var(--font-retro, ui-monospace, monospace);
}
.sub {
  margin: 0 0 1.5rem;
  font-size: 0.88rem;
  color: #a7f3d0;
  line-height: 1.45;
}
.btn {
  padding: 0.65rem 1.75rem;
  font-weight: 700;
  font-family: var(--font-retro, ui-monospace, monospace);
  color: #052e16;
  background: linear-gradient(180deg, #86efac, #22c55e);
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.btn:hover {
  filter: brightness(1.05);
}
</style>
