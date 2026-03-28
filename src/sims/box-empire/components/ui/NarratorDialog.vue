<script setup lang="ts">
import { watch, computed } from 'vue'
import { useGameStore } from '../../store/gameStore'
import { useNarratorAudio } from '../../composables/useNarratorAudio'
import type { NarratorAction } from '../../types'

const store = useGameStore()
const { playBeat, stopCurrent, progress } = useNarratorAudio()

const dialog = computed(() => store.narratorDialog)
const beat = computed(() => {
  if (!dialog.value) return null
  return dialog.value.beats[dialog.value.currentBeat] ?? null
})
const beatIndex = computed(() => dialog.value?.currentBeat ?? 0)
const beatTotal = computed(() => dialog.value?.beats.length ?? 0)
const hasActions = computed(() => (beat.value?.actions?.length ?? 0) > 0)

// When a beat has autoAdvance, wire an onEnded callback to move to the next beat
function buildOnEnded(): (() => void) | undefined {
  if (!beat.value?.autoAdvance) return undefined
  return () => { store.narratorNextBeat() }
}

// Play audio whenever the current beat changes
watch(
  () => beat.value?.audioFile,
  (file) => {
    if (file) {
      playBeat(file, buildOnEnded())
    } else {
      stopCurrent()
    }
  },
  { immediate: true },
)

function handleNext() {
  store.narratorNextBeat()
}

function handleAction(narratorAction: NarratorAction) {
  store.dispatchNarratorAction(narratorAction.action)
  if (narratorAction.advancesOnClick) {
    store.narratorNextBeat()
  }
}

const progressPercent = computed(() => Math.round(progress.value * 100))
</script>

<template>
  <Transition name="narrator-slide">
    <div
      v-if="beat"
      class="narrator-dialog"
      role="dialog"
      aria-label="Narrator"
    >
      <div class="narrator-inner">
        <!-- Portrait / icon -->
        <div
          class="narrator-avatar"
          aria-hidden="true"
        >
          <span class="narrator-icon">🧓</span>
        </div>

        <!-- Content -->
        <div class="narrator-content">
          <div class="narrator-header">
            <span class="narrator-name">OLD FAMILY RELATIVE</span>
            <span class="narrator-beat-count">{{ beatIndex + 1 }} / {{ beatTotal }}</span>
          </div>

          <!-- Text lines -->
          <div class="narrator-lines">
            <p
              v-for="(line, i) in beat.lines"
              :key="i"
              class="narrator-line"
            >
              {{ line }}
            </p>
          </div>

          <!-- Audio progress bar -->
          <div
            class="narrator-progress-track"
            title="Audio progress"
          >
            <div
              class="narrator-progress-fill"
              :style="{ width: progressPercent + '%' }"
            />
          </div>

          <!-- Actions row -->
          <div class="narrator-actions">
            <!-- Game-wired action buttons from the beat definition -->
            <button
              v-for="act in beat.actions"
              :key="act.action"
              class="narrator-btn narrator-btn-action"
              @click="handleAction(act)"
            >
              {{ act.label }}
            </button>

            <!-- All beats without action buttons show Next → (auto-advance still fires on audio end too) -->
            <button
              v-if="!hasActions"
              class="narrator-btn narrator-btn-next"
              @click="handleNext"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.narrator-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 30;
  max-width: 520px;
  width: calc(100vw - 48px);
  pointer-events: auto;
}

.narrator-inner {
  display: flex;
  gap: 12px;
  background: rgba(10, 10, 20, 0.94);
  border: 2px solid var(--color-primary, #f59e0b);
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.7), 0 0 16px rgba(245, 158, 11, 0.2);
}

.narrator-avatar {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

.narrator-icon {
  font-size: 2rem;
  line-height: 1;
  filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.6));
}

.narrator-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.narrator-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.narrator-name {
  font-family: var(--font-retro, monospace);
  font-size: 0.65rem;
  font-weight: bold;
  color: var(--color-primary, #f59e0b);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  flex: 1;
}

.narrator-beat-count {
  font-family: var(--font-retro, monospace);
  font-size: 0.6rem;
  color: rgba(255, 255, 255, 0.4);
}


.narrator-lines {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.narrator-line {
  font-family: var(--font-retro, monospace);
  font-size: 0.82rem;
  color: #f0f0f0;
  line-height: 1.55;
  margin: 0;
}

.narrator-progress-track {
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  overflow: hidden;
}

.narrator-progress-fill {
  height: 100%;
  background: var(--color-primary, #f59e0b);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.narrator-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
  min-height: 28px;
}


.narrator-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-family: var(--font-retro, monospace);
  font-size: 0.78rem;
  font-weight: bold;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.narrator-btn:hover {
  transform: scale(1.04);
}

/* Game-action buttons: prominent, amber-filled */
.narrator-btn-action {
  background: var(--color-primary, #f59e0b);
  border: 1px solid var(--color-primary, #f59e0b);
  color: #000;
  flex: 1 1 auto;
}

.narrator-btn-action:hover {
  box-shadow: 0 2px 12px rgba(245, 158, 11, 0.6);
}

/* Navigation buttons: secondary, outlined */
.narrator-btn-next {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.7);
}

.narrator-btn-next:hover {
  border-color: rgba(255, 255, 255, 0.6);
  color: #fff;
}

.narrator-btn-done {
  background: #2ecc71;
  border: 1px solid #2ecc71;
  color: #000;
}

.narrator-btn-done:hover {
  box-shadow: 0 2px 10px rgba(46, 204, 113, 0.5);
}

/* Scale-in / fade transition (no translate — the outer wrapper owns centering) */
.narrator-slide-enter-active {
  transition: opacity 0.25s ease, scale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.narrator-slide-leave-active {
  transition: opacity 0.2s ease, scale 0.2s ease-in;
}

.narrator-slide-enter-from {
  opacity: 0;
  scale: 0.92;
}

.narrator-slide-leave-to {
  opacity: 0;
  scale: 0.95;
}
</style>
