<script setup lang="ts">
import TtIcon from './ui/TtIcon.vue'
import { computed, ref } from 'vue'
import { useTwinStore } from '../store/twinStore'
import { SPEEDS } from '../modules/twinController'
import { fromLocalInputValue, simDate, toLocalInputValue } from '../modules/time'
import { t, type MessageKey } from '../i18n/messages'
import { ROB_DISPLAY_MODES } from '../modules/colourBy'
import PerfPanel from './PerfPanel.vue'
import LocaleDateTimeInput from './LocaleDateTimeInput.vue'

withDefaults(defineProps<{ showGraphics?: boolean }>(), { showGraphics: true })

const store = useTwinStore()

const clock = computed(() => store.fmt.clock(store.choice.startDateTime, store.displayTime))

const ended = computed(() => store.runEnded)

/** Status pill state (also its CSS class). */
const status = computed<'running' | 'failed' | 'complete' | 'paused' | 'live'>(() => {
  if (store.busy) return 'running'
  if (store.info?.status === 'failed') return 'failed'
  if (ended.value) return 'complete'
  return store.paused ? 'paused' : 'live'
})

const runToOpen = ref(false)
const runToValue = ref('')
const runToError = ref<string | null>(null)

function openRunTo(): void {
  runToOpen.value = !runToOpen.value
  runToError.value = null
  if (runToOpen.value) {
    runToValue.value = toLocalInputValue(simDate(store.choice.startDateTime, store.displayTime + 600), true)
  }
}

async function submitRunToDeparture(): Promise<void> {
  runToOpen.value = false
  await store.runToNextDeparture().catch(() => {})
}

async function submitRunTo(): Promise<void> {
  const target = fromLocalInputValue(runToValue.value)
  if (!target) {
    runToError.value = t('topbar.runToMissing')
    return
  }
  const simT = (target.getTime() - new Date(store.choice.startDateTime).getTime()) / 1000
  if (simT <= store.displayTime) {
    runToError.value = t('topbar.runToPast')
    return
  }
  runToOpen.value = false
  await store.runTo(simT).catch(() => {})
}
</script>

<template>
  <header
    class="tt-topbar"
    data-testid="tt-topbar"
  >
    <div
      class="tt-topbar-main"
      data-hud-region="topBar"
    >
      <div
        class="clock"
        data-testid="tt-clock"
        :title="t('topbar.elapsed', { elapsed: clock.elapsed })"
      >
        <span class="clock-day">{{ clock.day }}</span>
        <span class="clock-date">{{ clock.date }}</span>
        <span class="clock-time">{{ clock.time }}</span>
        <span class="clock-elapsed">{{ clock.elapsed }}</span>
      </div>

      <div
        class="speeds"
        role="group"
        :aria-label="t('topbar.speedGroup')"
      >
        <button
          class="speed-btn"
          :class="{ active: store.paused }"
          :aria-pressed="store.paused"
          :disabled="ended"
          :title="ended ? t('topbar.endedHint') : store.paused ? t('topbar.resume') : t('topbar.pause')"
          :aria-label="store.paused ? t('topbar.resume') : t('topbar.pause')"
          @click="store.togglePause()"
        >
          <TtIcon :name="store.paused ? 'play' : 'pause'" />
        </button>
        <button
          v-for="s in SPEEDS"
          :key="s"
          class="speed-btn"
          :class="{ active: !store.paused && store.speed === s }"
          :aria-pressed="!store.paused && store.speed === s"
          :data-speed="s"
          :disabled="ended"
          @click="store.setSpeed(s)"
        >
          {{ t('topbar.speed', { speed: s }) }}
        </button>
      </div>

      <div class="actions">
        <button
          class="action-btn"
          data-testid="tt-topbar-step"
          :disabled="store.busy || ended"
          :title="t('debug.stepHint')"
          @click="store.step().catch(() => {})"
        >
          {{ t('debug.step') }}
        </button>
        <div class="run-to">
          <button
            class="action-btn"
            :disabled="store.busy || ended"
            :title="ended ? t('topbar.endedHint') : undefined"
            @click="openRunTo"
          >
            {{ t('topbar.runTo') }}
          </button>
          <form
            v-if="runToOpen"
            class="run-to-pop"
            @submit.prevent="submitRunTo"
          >
            <label>
              <span>{{ t('topbar.runToTarget') }}</span>
              <LocaleDateTimeInput
                v-model="runToValue"
                seconds
                required
                test-id="tt-run-to-input"
              />
            </label>
            <button
              type="button"
              class="action-btn"
              data-testid="tt-run-to-departure"
              @click="submitRunToDeparture"
            >
              {{ t('topbar.runToDeparture') }}
            </button>
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
                {{ t('setup.cancel') }}
              </button>
              <button
                type="submit"
                class="action-btn primary"
              >
                {{ t('topbar.run') }}
              </button>
            </div>
          </form>
        </div>
        <button
          class="action-btn"
          :disabled="store.busy"
          :title="t('topbar.resetHint')"
          @click="store.reset()"
        >
          {{ t('topbar.reset') }}
        </button>
        <button
          class="action-btn"
          :disabled="store.busy"
          @click="store.newScenario()"
        >
          {{ t('topbar.newScenario') }}
        </button>
        <button
          class="action-btn"
          data-testid="tt-saves-button"
          :disabled="store.busy"
          :title="t('topbar.savesHint')"
          @click="store.openSaves()"
        >
          {{ t('topbar.saves') }}
        </button>
        <button
          class="action-btn"
          :class="{ active: store.dashboardOpen }"
          :aria-pressed="store.dashboardOpen"
          :title="t('topbar.dashboardHint')"
          data-testid="tt-dashboard-button"
          @click="store.toggleDashboard()"
        >
          {{ t('topbar.dashboard') }}
        </button>
        <button
          class="action-btn help-btn"
          :title="t('topbar.shortcuts')"
          :aria-label="t('topbar.shortcuts')"
          data-testid="tt-help-button"
          @click="store.setHelpOpen(!store.helpOpen)"
        >
          ?
        </button>
        <span
          class="status"
          :class="status"
          data-testid="tt-status"
        >{{ t(`status.${status}`) }}</span>
      </div>
    </div>
    <div
      class="settings"
      role="group"
      :aria-label="t('topbar.settings')"
      data-hud-region="settings"
      data-testid="tt-settings"
    >
      <div
        class="rob-display"
        role="group"
        :aria-label="t('topbar.rob')"
        :title="t('topbar.robHint')"
        data-testid="tt-rob-display"
        :data-mode="store.robDisplay"
      >
        <span class="rob-label">{{ t('topbar.rob') }}</span>
        <button
          v-for="m in ROB_DISPLAY_MODES"
          :key="m"
          type="button"
          class="action-btn rob-btn"
          :class="{ active: store.robDisplay === m }"
          :aria-pressed="store.robDisplay === m"
          :data-testid="`tt-rob-${m}`"
          @click="store.setRobDisplay(m)"
        >
          {{ t(`topbar.rob.${m}` as MessageKey) }}
        </button>
      </div>
      <button
        class="action-btn"
        :class="{ active: store.lockDaylight }"
        :aria-pressed="store.lockDaylight"
        :title="t('topbar.daylightHint')"
        data-testid="tt-daylight-toggle"
        @click="store.toggleLockDaylight()"
      >
        {{ t('topbar.daylight') }}
      </button>
      <PerfPanel v-if="showGraphics" />
    </div>
  </header>
</template>

<style scoped>
.tt-topbar {
  /* Above the scene below it (HUD panels are z 4-8, modals 40+): the Run to… popup hangs out of the bar over the 3D view. */
  position: relative;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  flex-wrap: nowrap;
  padding: 0.5rem 0.9rem;
  background: var(--tt-panel);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  border-bottom: 1px solid var(--tt-border);
  font-family: var(--tt-font);
  color: var(--tt-text);
  backdrop-filter: blur(6px);
}

.tt-topbar-main {
  display: flex;
  align-items: center;
  gap: 0.5rem 1rem;
  flex: 1 1 0;
  flex-wrap: wrap;
  min-width: 0;
}

.rob-display {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.rob-label {
  color: var(--tt-text-muted);
  font-size: 0.78rem;
  margin-right: 0.1rem;
}

.rob-btn {
  padding: 0.35rem 0.5rem;
}

.settings {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.5rem;
  flex: 0 1 auto;
  justify-content: flex-end;
  max-width: 27rem;
}

.clock {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
  min-width: 20rem;
}

.clock-day {
  color: var(--tt-accent);
  font-weight: 600;
}

.clock-time {
  font-size: 1.15rem;
  font-weight: 600;
}

.clock-date,
.clock-elapsed {
  color: var(--tt-text-muted);
  font-size: 0.8rem;
}

.speeds {
  display: flex;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  overflow: hidden;
}

.speed-btn {
  padding: 0.3rem 0.5rem;
  background: transparent;
  border: none;
  border-right: 1px solid var(--tt-border);
  color: var(--tt-text-muted);
  font-family: var(--tt-font-mono);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.speed-btn:last-child {
  border-right: none;
}

.speed-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.speed-btn:hover:not(:disabled) {
  background: var(--tt-surface-hover);
  color: var(--tt-text);
}

.speed-btn.active {
  background: var(--tt-accent);
  color: var(--tt-on-accent);
}

/* State by shape as well as colour: an active toggle carries a check mark. */
.action-btn.active::before,
.status.live::before,
.status.paused::before,
.status.complete::before,
.status.failed::before {
  content: '';
  display: inline-block;
  width: 0.9em;
  height: 0.9em;
  margin-right: 0.3em;
  vertical-align: -0.12em;
  background: currentColor;
  -webkit-mask: var(--tt-mark) center / contain no-repeat;
  mask: var(--tt-mark) center / contain no-repeat;
}

.action-btn.active::before {
  --tt-mark: var(--tt-glyph-check);
}

.action-btn.active {
  background: var(--tt-accent);
  border-color: var(--tt-accent);
  color: var(--tt-on-accent);
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.action-btn {
  padding: 0.35rem 0.75rem;
  background: var(--tt-surface);
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  color: var(--tt-text);
  font-size: 0.82rem;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--tt-accent);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.action-btn.primary {
  background: var(--tt-accent);
  border-color: var(--tt-accent);
  color: var(--tt-on-accent);
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
  background: var(--tt-surface);
  border: 1px solid var(--tt-border);
  border-radius: 8px;
  box-shadow: var(--tt-shadow);
}

.run-to-pop label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: var(--tt-text-muted);
}

.run-to-pop input {
  padding: 0.35rem 0.5rem;
  background: var(--tt-bg);
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  color: var(--tt-text);
  font-family: var(--tt-font-mono);
  color-scheme: dark;
}

.pop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.error {
  color: var(--tt-danger);
  font-size: 0.78rem;
}

.help-btn {
  min-width: 2rem;
  font-family: var(--tt-font-mono);
}

.status {
  min-width: 5.5rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--tt-border);
  border-radius: 999px;
  font-size: 0.75rem;
  text-align: center;
  color: var(--tt-text-muted);
}

.status.live::before {
  --tt-mark: var(--tt-glyph-dot);
  color: var(--tt-success);
}

.status.paused::before {
  --tt-mark: var(--tt-glyph-pause);
}

.status.complete::before {
  --tt-mark: var(--tt-glyph-check);
  color: var(--tt-success);
}

.status.failed::before {
  --tt-mark: var(--tt-glyph-close);
  color: var(--tt-danger);
}
</style>
