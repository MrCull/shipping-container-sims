<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTwinStore } from '../store/twinStore'
import { SPEEDS } from '../modules/twinController'
import { clockParts, fromLocalInputValue, simDate, toLocalInputValue } from '../modules/time'

const store = useTwinStore()

const clock = computed(() => clockParts(store.choice.startDateTime, store.displayTime))

const ended = computed(() => {
  const info = store.info
  return !!info && info.status !== 'ready' && store.displayTime >= (info.endT ?? info.now)
})

const statusLabel = computed(() => {
  if (store.busy) return 'Running…'
  if (store.info?.status === 'failed') return 'Failed'
  if (ended.value) return 'Complete'
  return store.paused ? 'Paused' : 'Live'
})

const runToOpen = ref(false)
const runToValue = ref('')
const runToError = ref<string | null>(null)

function openRunTo(): void {
  runToOpen.value = !runToOpen.value
  runToError.value = null
  if (runToOpen.value) {
    runToValue.value = toLocalInputValue(simDate(store.choice.startDateTime, store.displayTime + 600))
  }
}

async function submitRunTo(): Promise<void> {
  const target = fromLocalInputValue(runToValue.value)
  if (!target) {
    runToError.value = 'Enter a date and time'
    return
  }
  const t = (target.getTime() - new Date(store.choice.startDateTime).getTime()) / 1000
  if (t <= store.displayTime) {
    runToError.value = 'Pick a time after the current sim time'
    return
  }
  runToOpen.value = false
  await store.runTo(t).catch(() => {})
}
</script>

<template>
  <header
    class="tt-topbar"
    data-testid="tt-topbar"
  >
    <div
      class="clock"
      data-testid="tt-clock"
      :title="`Elapsed ${clock.elapsed}`"
    >
      <span class="clock-day">{{ clock.day }}</span>
      <span class="clock-date">{{ clock.date }}</span>
      <span class="clock-time">{{ clock.time }}</span>
      <span class="clock-elapsed">T+{{ clock.elapsed }}</span>
    </div>

    <div
      class="speeds"
      role="group"
      aria-label="Speed"
    >
      <button
        class="speed-btn"
        :class="{ active: store.paused }"
        :aria-pressed="store.paused"
        title="Pause"
        @click="store.togglePause()"
      >
        {{ store.paused ? '▶' : '❚❚' }}
      </button>
      <button
        v-for="s in SPEEDS"
        :key="s"
        class="speed-btn"
        :class="{ active: !store.paused && store.speed === s }"
        :aria-pressed="!store.paused && store.speed === s"
        :data-speed="s"
        @click="store.setSpeed(s)"
      >
        ×{{ s }}
      </button>
    </div>

    <div class="actions">
      <div class="run-to">
        <button
          class="action-btn"
          :disabled="store.busy"
          @click="openRunTo"
        >
          Run to…
        </button>
        <form
          v-if="runToOpen"
          class="run-to-pop"
          @submit.prevent="submitRunTo"
        >
          <label>
            <span>Target sim time</span>
            <input
              v-model="runToValue"
              type="datetime-local"
              step="1"
              required
            >
          </label>
          <p
            v-if="runToError"
            class="error"
          >
            {{ runToError }}
          </p>
          <div class="pop-actions">
            <button
              type="button"
              class="action-btn"
              @click="runToOpen = false"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="action-btn primary"
            >
              Run
            </button>
          </div>
        </form>
      </div>
      <button
        class="action-btn"
        :disabled="store.busy"
        title="Back to t = 0 with the same seed"
        @click="store.reset()"
      >
        Reset
      </button>
      <button
        class="action-btn"
        :disabled="store.busy"
        @click="store.newScenario()"
      >
        New Scenario
      </button>
      <span
        class="status"
        :class="statusLabel.toLowerCase().replace('…', '')"
        data-testid="tt-status"
      >{{ statusLabel }}</span>
    </div>
  </header>
</template>

<style scoped>
.tt-topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.9rem;
  background: rgba(17, 24, 39, 0.92);
  border-bottom: 1px solid var(--color-border);
  font-family: var(--font-body);
  color: var(--color-text);
  backdrop-filter: blur(6px);
}

.clock {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
  min-width: 21rem;
}

.clock-day {
  color: var(--color-accent);
  font-weight: 600;
}

.clock-time {
  font-size: 1.15rem;
  font-weight: 600;
}

.clock-date,
.clock-elapsed {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.speeds {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.speed-btn {
  padding: 0.3rem 0.5rem;
  background: transparent;
  border: none;
  border-right: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--tt-font-mono);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.speed-btn:last-child {
  border-right: none;
}

.speed-btn:hover {
  background: var(--color-bg-card-hover);
  color: var(--color-text);
}

.speed-btn.active {
  background: var(--color-primary);
  color: #fff;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.action-btn {
  padding: 0.35rem 0.75rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.82rem;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.action-btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.run-to {
  position: relative;
}

.run-to-pop {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 16rem;
  padding: 0.75rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}

.run-to-pop label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: var(--color-text-muted);
}

.run-to-pop input {
  padding: 0.35rem 0.5rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--tt-font-mono);
  color-scheme: dark;
}

.pop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.error {
  color: var(--color-danger);
  font-size: 0.78rem;
}

.status {
  min-width: 5.5rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.75rem;
  text-align: center;
  color: var(--color-text-muted);
}

.status.live::before {
  content: '● ';
  color: var(--color-success);
}

.status.paused::before {
  content: '❚❚ ';
}

.status.complete::before {
  content: '✓ ';
  color: var(--color-success);
}

.status.failed::before {
  content: '✕ ';
  color: var(--color-danger);
}
</style>
