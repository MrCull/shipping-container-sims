<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useGameStore } from '../../store/gameStore'
import { useJevStore } from '../../store/jevStore'
import { useJevController } from '../../composables/useJevController'
import type { GamePhase } from '../../types'

const store = useGameStore()
const jev = useJevStore()
const controller = useJevController()

const showSettings = ref(false)
// Tracks which action the player last chose, so a "paused" status shows the matching
// affordance (Resume for play-all, Retry for a single step) without adding controller state.
const autoPlayIntent = ref(false)

const VISIBLE_PHASES = new Set<GamePhase>([
  'discharge_selecting', 'discharge_animating',
  'restow_selecting', 'restow_animating',
  'selecting', 'animating',
  'disaster', 'complete', 'failed',
])

const isVisible = computed(() => jev.enabled && VISIBLE_PHASES.has(store.phase))

const isSelectingPhase = computed(() =>
  store.phase === 'selecting' || store.phase === 'discharge_selecting' || store.phase === 'restow_selecting',
)

const isRequestBusy = computed(() =>
  jev.status === 'requesting' || jev.status === 'executing' || jev.status === 'settling',
)

const nextMoveDisabled = computed(() =>
  jev.autoPlay || !jev.hasKey || !isSelectingPhase.value || isRequestBusy.value,
)

const playAllDisabled = computed(() => {
  if (jev.autoPlay) return false // always clickable — it becomes the Stop button
  return !jev.hasKey || isRequestBusy.value
})

const isPaused = computed(() => jev.status === 'paused')
const isAuthPaused = computed(() => isPaused.value && jev.lastError?.kind === 'auth')

const statusLabel = computed(() => {
  switch (jev.status) {
    case 'requesting': return 'Thinking…'
    case 'executing':
    case 'settling': return 'Moving…'
    case 'paused': return jev.lastError ? `Paused: ${jev.lastError.message}` : 'Paused'
    default: return jev.autoPlay ? 'Playing…' : ''
  }
})

function onNextMoveClick(): void {
  if (nextMoveDisabled.value && jev.status !== 'paused') return
  autoPlayIntent.value = false
  void controller.requestNextMove()
}

function onToggleAutoPlay(): void {
  if (jev.autoPlay) {
    autoPlayIntent.value = false
    controller.stopAutoPlay()
    return
  }
  if (playAllDisabled.value) return
  autoPlayIntent.value = true
  void controller.startAutoPlay()
}

function onResumeOrRetryClick(): void {
  controller.resume()
  if (autoPlayIntent.value) {
    void controller.startAutoPlay()
  } else {
    void controller.requestNextMove()
  }
}

function onEnterKeyClick(): void {
  jev.openKeyDialog()
}

function onToggleMinConfidence(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  jev.setMinConfidenceToAutoplay(checked ? 0.5 : null)
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return
  }
  if (jev.isKeyDialogOpen || !jev.hasKey) return
  if (event.key !== 'j' && event.key !== 'J') return

  event.preventDefault()
  if (event.shiftKey) {
    onToggleAutoPlay()
  } else {
    onNextMoveClick()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-if="isVisible"
    class="jev-panel"
  >
    <div class="jev-header">
      <span class="jev-title">JEV</span>
      <button
        type="button"
        class="gear-btn"
        title="Jev settings"
        @click="showSettings = !showSettings"
      >
        ⚙
      </button>
    </div>

    <div
      v-if="showSettings"
      class="jev-settings"
    >
      <label class="setting-row setting-row--checkbox">
        <input
          type="checkbox"
          :checked="jev.showInspector"
          @change="jev.setShowInspector(($event.target as HTMLInputElement).checked)"
        >
        Show Jev details
      </label>
      <label class="setting-row">
        <span>Pause between moves: {{ jev.settleDelayMs }}ms</span>
        <input
          type="range"
          min="0"
          max="2000"
          step="50"
          :value="jev.settleDelayMs"
          @input="jev.setSettleDelayMs(Number(($event.target as HTMLInputElement).value))"
        >
      </label>
      <label class="setting-row setting-row--checkbox">
        <input
          type="checkbox"
          :checked="jev.minConfidenceToAutoplay !== null"
          @change="onToggleMinConfidence"
        >
        Pause play-all below confidence
      </label>
      <input
        v-if="jev.minConfidenceToAutoplay !== null"
        type="range"
        min="0.1"
        max="0.9"
        step="0.05"
        :value="jev.minConfidenceToAutoplay"
        @input="jev.setMinConfidenceToAutoplay(Number(($event.target as HTMLInputElement).value))"
      >
      <div class="setting-actions">
        <button
          type="button"
          @click="jev.forgetKey()"
        >
          Forget key
        </button>
        <button
          type="button"
          @click="jev.disable()"
        >
          Disable Jev
        </button>
      </div>
    </div>

    <div
      v-if="!jev.hasKey"
      class="jev-body"
    >
      <button
        type="button"
        class="jev-btn jev-btn--primary"
        @click="onEnterKeyClick"
      >
        Enter Jev key
      </button>
    </div>
    <template v-else>
      <div class="jev-controls">
        <button
          type="button"
          class="jev-btn"
          :disabled="nextMoveDisabled"
          @click="onNextMoveClick"
        >
          Next move (J)
        </button>
        <button
          type="button"
          class="jev-btn jev-btn--accent"
          :disabled="playAllDisabled"
          @click="onToggleAutoPlay"
        >
          {{ jev.autoPlay ? '■ Stop' : '▶ Play all (⇧J)' }}
        </button>
      </div>

      <div
        v-if="statusLabel"
        class="jev-status"
      >
        <span>{{ statusLabel }}</span>
        <button
          v-if="isAuthPaused"
          type="button"
          class="jev-link-btn"
          @click="onEnterKeyClick"
        >
          Enter key
        </button>
        <button
          v-else-if="isPaused"
          type="button"
          class="jev-link-btn"
          @click="onResumeOrRetryClick"
        >
          {{ autoPlayIntent ? 'Resume' : 'Retry' }}
        </button>
      </div>

      <div class="jev-meta">
        Jev moves: {{ jev.movesByJevThisLevel }} · Session cost: ${{ jev.sessionCostUsd.toFixed(4) }}
      </div>

      <button
        v-if="jev.showInspector"
        type="button"
        class="jev-details-btn"
        @click="jev.toggleInspector()"
      >
        {{ jev.isInspectorOpen ? 'Hide details ▾' : 'Details ▸' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.jev-panel {
  position: absolute;
  right: 12px;
  /* Clears KeyboardHint's box, which grows by two rows (and sits at a higher z-index) once
     Jev is enabled — the same condition this panel is mounted under. */
  bottom: 300px;
  z-index: 15;
  width: 220px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 204, 0, 0.3);
  border-radius: 8px;
  padding: 10px 12px;
  backdrop-filter: blur(4px);
  pointer-events: all;
}

.jev-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.jev-title {
  font-size: 12px;
  font-weight: bold;
  color: #ffcc00;
  letter-spacing: 1.5px;
}

.gear-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 13px;
  cursor: pointer;
  line-height: 1;
  padding: 2px;
}

.gear-btn:hover {
  color: #ffcc00;
}

.jev-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
  margin-bottom: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.setting-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10px;
  color: #ccc;
}

.setting-row--checkbox {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.setting-row input[type='range'] {
  width: 100%;
}

.setting-actions {
  display: flex;
  gap: 6px;
}

.setting-actions button {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 5px;
  padding: 4px 6px;
  color: #eee;
  font-size: 10px;
  cursor: pointer;
}

.setting-actions button:hover {
  border-color: #ffcc00;
}

.jev-body {
  display: flex;
}

.jev-controls {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.jev-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 7px 4px;
  color: #eee;
  font-size: 10.5px;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.jev-btn:hover:not(:disabled) {
  background: rgba(255, 204, 0, 0.12);
  border-color: #ffcc00;
}

.jev-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.jev-btn--primary {
  width: 100%;
  background: linear-gradient(135deg, #ffcc00, #ff9900);
  border: none;
  color: #000;
}

.jev-btn--accent.jev-btn:not(:disabled) {
  border-color: rgba(255, 204, 0, 0.4);
}

.jev-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 10.5px;
  color: #ffaa00;
  margin-bottom: 6px;
  line-height: 1.4;
}

.jev-link-btn {
  flex-shrink: 0;
  background: none;
  border: 1px solid rgba(255, 204, 0, 0.4);
  border-radius: 4px;
  padding: 2px 8px;
  color: #ffcc00;
  font-size: 10px;
  cursor: pointer;
}

.jev-link-btn:hover {
  background: rgba(255, 204, 0, 0.15);
}

.jev-meta {
  font-size: 9.5px;
  color: #8f96a3;
}

.jev-details-btn {
  width: 100%;
  margin-top: 6px;
  background: none;
  border: none;
  color: #ffcc00;
  font-size: 10px;
  text-align: right;
  padding: 2px 0;
  cursor: pointer;
}

.jev-details-btn:hover {
  color: #ffe066;
}
</style>
