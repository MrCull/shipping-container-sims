<script setup lang="ts">
import { useContainerStackStore } from '../../store/gameStore'
import { ensureAudioLoaded, playStackSound } from '../../modules/audioPlayer'

const emit = defineEmits<{ play: [] }>()
const store = useContainerStackStore()

async function onPlay(): Promise<void> {
  await ensureAudioLoaded()
  playStackSound('hornsLevelUp', 0.55)
  store.beginPlay()
  emit('play')
}
</script>

<template>
  <div class="overlay">
    <div class="card">
      <h1 class="title">
        Container Stack
      </h1>
      <p class="tag">
        How high can you stack before the tower falls?
      </p>
      <p class="blurb">
        Pull containers from the tower like Jenga, then place them on top. Watch stability, keep your hands steady, and listen for the stack groan.
      </p>
      <button
        type="button"
        class="play-btn"
        @click="onPlay"
      >
        Play
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
  background: radial-gradient(ellipse at center, rgba(15, 17, 23, 0.92), rgba(5, 6, 10, 0.97));
  z-index: 20;
}
.card {
  max-width: 400px;
  padding: 2rem 1.75rem;
  text-align: center;
  border: 2px solid rgba(239, 68, 68, 0.45);
  border-radius: 12px;
  background: rgba(24, 27, 35, 0.95);
  box-shadow: 0 0 40px rgba(239, 68, 68, 0.15);
}
.title {
  margin: 0 0 0.35rem;
  font-size: 1.75rem;
  font-family: var(--font-retro, ui-monospace, monospace);
  color: #f9fafb;
}
.tag {
  margin: 0 0 1rem;
  font-size: 0.95rem;
  color: #ef4444;
  font-weight: 600;
}
.blurb {
  margin: 0 0 1.5rem;
  font-size: 0.88rem;
  line-height: 1.5;
  color: #9ca3af;
}
.play-btn {
  padding: 0.75rem 2.5rem;
  font-size: 1rem;
  font-weight: 700;
  font-family: var(--font-retro, ui-monospace, monospace);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #0f1117;
  background: linear-gradient(180deg, #fca5a5, #ef4444);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(239, 68, 68, 0.35);
}
.play-btn:hover {
  filter: brightness(1.06);
}
</style>
