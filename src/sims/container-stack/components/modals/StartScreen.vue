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
        Contenga
      </h1>
      <p class="tag">
        How high can you stack before the tower falls?
      </p>
      <p class="blurb">
        Pull containers with the mouse, then place them on top. Use WASD or arrow keys to orbit the camera. If the stack is not supported below, it comes down.
      </p>
      <p class="tip">
        Beat each level: level 1 needs 1 move, level 2 needs 2 moves, level 3 needs 3 moves, and so on. Finish before the move timer or level timer hits zero.
      </p>
      <button
        type="button"
        class="play-btn"
        @click="onPlay"
      >
        Play
      </button>
      <RouterLink
        class="menu-btn"
        to="/"
      >
        Main menu
      </RouterLink>
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
  background: radial-gradient(ellipse at center, rgba(15, 23, 32, 0.94), rgba(8, 12, 18, 0.98));
  z-index: 20;
}
.card {
  max-width: 400px;
  padding: 2rem 1.75rem;
  text-align: center;
  border: 2px solid rgba(56, 189, 248, 0.45);
  border-radius: 12px;
  background: rgba(22, 30, 42, 0.96);
  box-shadow:
    0 0 48px rgba(14, 165, 233, 0.12),
    0 0 1px rgba(255, 255, 255, 0.06) inset;
}
.title {
  margin: 0 0 0.35rem;
  font-size: 1.75rem;
  font-family: var(--font-retro, ui-monospace, monospace);
  color: #f0f9ff;
}
.tag {
  margin: 0 0 1rem;
  font-size: 0.95rem;
  color: #38bdf8;
  font-weight: 600;
}
.blurb {
  margin: 0 0 0.85rem;
  font-size: 0.88rem;
  line-height: 1.5;
  color: #94a3b8;
}
.tip {
  margin: 0 0 1.5rem;
  padding: 0.65rem 0.75rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: #bae6fd;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 8px;
  text-align: left;
}
.play-btn {
  display: block;
  margin: 0 auto;
  padding: 0.75rem 2.5rem;
  font-size: 1rem;
  font-weight: 700;
  font-family: var(--font-retro, ui-monospace, monospace);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #0c1220;
  background: linear-gradient(180deg, #7dd3fc, #0ea5e9);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 4px 24px rgba(14, 165, 233, 0.35);
}
.play-btn:hover {
  filter: brightness(1.06);
}
.menu-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  width: fit-content;
  margin: 0.8rem auto 0;
  padding: 0.65rem 1.4rem;
  font-size: 0.82rem;
  font-weight: 700;
  font-family: var(--font-retro, ui-monospace, monospace);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #bae6fd;
  text-decoration: none;
  background: rgba(15, 23, 42, 0.68);
  border: 1px solid rgba(56, 189, 248, 0.38);
  border-radius: 8px;
  cursor: pointer;
}
.menu-btn:hover {
  color: #f0f9ff;
  border-color: rgba(125, 211, 252, 0.75);
  background: rgba(30, 41, 59, 0.84);
}
</style>
