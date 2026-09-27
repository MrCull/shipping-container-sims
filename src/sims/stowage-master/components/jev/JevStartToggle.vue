<script setup lang="ts">
import { computed, ref } from 'vue'
import { useJevStore } from '../../store/jevStore'

const jev = useJevStore()
const showPopover = ref(false)

const linkLabel = computed(() => {
  if (!jev.enabled) return 'Jev'
  if (!jev.hasKey) return 'Jev · key needed'
  return 'Jev ✓'
})

function onToggleClick(): void {
  if (!jev.enabled) {
    jev.openKeyDialog()
    return
  }
  showPopover.value = !showPopover.value
}

function onEnterOrReplaceKey(): void {
  showPopover.value = false
  jev.openKeyDialog()
}

function onForgetKey(): void {
  jev.forgetKey()
}

function onDisable(): void {
  showPopover.value = false
  jev.disable()
}

function onToggleMinConfidence(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  jev.setMinConfidenceToAutoplay(checked ? 0.5 : null)
}
</script>

<template>
  <div class="jev-start-toggle">
    <button
      type="button"
      class="jev-link"
      :class="{ 'jev-link--active': jev.enabled }"
      @click="onToggleClick"
    >
      {{ linkLabel }}
    </button>

    <div
      v-if="showPopover && jev.enabled"
      class="jev-popover"
    >
      <div class="popover-row popover-status">
        <span>{{ jev.hasKey ? 'Key set ✓' : 'Key needed' }}</span>
        <span
          v-if="jev.keyLimitRemaining != null"
          class="popover-credit"
        >
          ${{ jev.keyLimitRemaining.toFixed(2) }} credit remaining
        </span>
      </div>

      <label class="popover-row popover-checkbox">
        <input
          type="checkbox"
          :checked="jev.showInspector"
          @change="jev.setShowInspector(($event.target as HTMLInputElement).checked)"
        >
        Show Jev details (inspector)
      </label>

      <label class="popover-row popover-slider">
        <span>Pause between Jev moves: {{ jev.settleDelayMs }}ms</span>
        <input
          type="range"
          min="0"
          max="2000"
          step="50"
          :value="jev.settleDelayMs"
          @input="jev.setSettleDelayMs(Number(($event.target as HTMLInputElement).value))"
        >
      </label>

      <label class="popover-row popover-checkbox">
        <input
          type="checkbox"
          :checked="jev.minConfidenceToAutoplay !== null"
          @change="onToggleMinConfidence"
        >
        Pause play-all when confidence is below…
      </label>
      <input
        v-if="jev.minConfidenceToAutoplay !== null"
        type="range"
        min="0.1"
        max="0.9"
        step="0.05"
        :value="jev.minConfidenceToAutoplay"
        class="popover-slider-input"
        @input="jev.setMinConfidenceToAutoplay(Number(($event.target as HTMLInputElement).value))"
      >

      <div class="popover-actions">
        <button
          type="button"
          class="popover-btn"
          @click="onEnterOrReplaceKey"
        >
          Enter / replace key
        </button>
        <button
          type="button"
          class="popover-btn"
          @click="onForgetKey"
        >
          Forget key
        </button>
        <button
          type="button"
          class="popover-btn popover-btn--danger"
          @click="onDisable"
        >
          Disable Jev
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jev-start-toggle {
  position: relative;
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  z-index: 5;
}

.jev-link {
  background: none;
  border: none;
  padding: 2px 4px;
  color: #888;
  font-family: var(--font-body);
  font-size: 10px;
  opacity: 0.35;
  cursor: pointer;
  transition: opacity 0.15s;
}

.jev-link:hover {
  opacity: 0.7;
}

.jev-link--active {
  opacity: 0.6;
  color: #ffcc00;
}

.jev-link--active:hover {
  opacity: 1;
}

.jev-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 260px;
  background: rgba(10, 14, 26, 0.97);
  border: 1px solid rgba(255, 204, 0, 0.25);
  border-radius: 8px;
  padding: 12px 14px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  text-align: left;
}

.popover-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: #ccc;
  margin-bottom: 10px;
}

.popover-status {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  color: #eee;
}

.popover-checkbox {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.popover-credit {
  color: #7df0b3;
  font-weight: bold;
}

.popover-slider input,
input[type='range'] {
  width: 100%;
}

.popover-slider-input {
  width: 100%;
  margin-bottom: 10px;
}

.popover-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.popover-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 5px;
  padding: 6px 8px;
  color: #eee;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.popover-btn:hover {
  background: rgba(255, 204, 0, 0.12);
  border-color: #ffcc00;
}

.popover-btn--danger:hover {
  background: rgba(255, 68, 68, 0.15);
  border-color: #ff4444;
}

@media (max-width: 800px) {
  .jev-start-toggle {
    justify-content: center;
  }

  .jev-popover {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
  }
}
</style>
