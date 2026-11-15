<script setup lang="ts">
import TtIcon from './ui/TtIcon.vue'
import { computed, ref } from 'vue'
import { useTwinStore } from '../store/twinStore'
import { SPEEDS } from '../modules/twinController'
import { fromLocalInputValue, simDate, toLocalInputValue } from '../modules/time'
import { t, type MessageKey } from '../i18n/messages'
import { ROB_DISPLAY_MODES } from '../modules/colourBy'
import PerfPanel from './PerfPanel.vue'
import { useHudStore } from '../store/hudStore'
import LocaleDateTimeInput from './LocaleDateTimeInput.vue'

withDefaults(defineProps<{ showGraphics?: boolean }>(), { showGraphics: true })

const store = useTwinStore()
const hud = useHudStore()

const clock = computed(() => store.fmt.clock(store.choice.startDateTime, store.displayTime))

const ended = computed(() => store.runEnded)

/** Shown while the engine holds playback more than 10 % below the chosen speed (#251). */
const showAchieved = computed(() => !store.paused && !store.busy && !ended.value && store.achievedSpeed < store.speed * 0.9)

/** Status pill state (also its CSS class). */
const status = computed<'running' | 'failed' | 'complete' | 'paused' | 'live'>(() => {
  if (store.busy) return 'running'
  if (store.info?.status === 'failed') return 'failed'
  if (ended.value) return 'complete'
  return store.paused ? 'paused' : 'live'
})

/** The popup's open state is in the store (#169: the shared Esc handling closes it). */
const runToOpen = computed(() => store.runToOpen)
const runToValue = ref('')
const runToError = ref<string | null>(null)

function openRunTo(): void {
  store.setRunToOpen(!runToOpen.value)
  runToError.value = null
  if (runToOpen.value) {
    runToValue.value = toLocalInputValue(simDate(store.choice.startDateTime, store.displayTime + 600), true)
  }
}

async function submitRunToDeparture(): Promise<void> {
  store.setRunToOpen(false)
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
  store.setRunToOpen(false)
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
        <span class="clock-time">{{ clock.time }}</span>
        <span class="clock-meta">
          <span class="clock-when"><span class="clock-day">{{ clock.day }}</span> <span class="clock-date">{{ clock.date }}</span></span>
          <span class="clock-elapsed">{{ clock.elapsed }}</span>
        </span>
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
      <span
        v-if="showAchieved"
        class="achieved"
        data-testid="tt-achieved-speed"
        :title="t('topbar.achievedHint')"
      >{{ t('topbar.achieved', { speed: Math.round(store.achievedSpeed) }) }}</span>

      <div
        v-show="!hud.collapsed.topBar"
        class="actions"
      >
        <button
          class="action-btn"
          data-testid="tt-topbar-step"
          :disabled="store.busy || ended"
          :title="t('debug.stepHint')"
          @click="store.step().catch(() => {})"
        >
          <TtIcon name="step" /> {{ t('debug.step') }}
        </button>
        <div
          class="run-to"
          data-tt-popup
        >
          <button
            class="action-btn"
            :disabled="store.busy || ended"
            :title="ended ? t('topbar.endedHint') : undefined"
            @click="openRunTo"
          >
            <TtIcon name="skip" /> {{ t('topbar.runTo') }}
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
                @click="store.setRunToOpen(false)"
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
          <TtIcon name="reset" /> {{ t('topbar.reset') }}
        </button>
        <button
          class="action-btn"
          :disabled="store.busy"
          @click="store.newScenario()"
        >
          <TtIcon name="plus" /> {{ t('topbar.newScenario') }}
        </button>
        <button
          class="action-btn"
          data-testid="tt-saves-button"
          :disabled="store.busy"
          :title="t('topbar.savesHint')"
          @click="store.openSaves()"
        >
          <TtIcon name="save" /> {{ t('topbar.saves') }}
        </button>
        <button
          class="action-btn"
          :class="{ active: store.dashboardOpen }"
          :aria-pressed="store.dashboardOpen"
          :title="t('topbar.dashboardHint')"
          data-testid="tt-dashboard-button"
          @click="store.toggleDashboard()"
        >
          <TtIcon name="chart" /> {{ t('topbar.dashboard') }}
        </button>
        <button
          class="action-btn help-btn"
          :title="t('topbar.shortcuts')"
          :aria-label="t('topbar.shortcuts')"
          data-testid="tt-help-button"
          @click="store.setHelpOpen(!store.helpOpen)"
        >
          <TtIcon name="help" />
        </button>
        <span
          class="status"
          :class="status"
          data-testid="tt-status"
        >{{ t(`status.${status}`) }}</span>
      </div>
    </div>
    <div
      v-show="!hud.collapsed.topBar"
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
        <TtIcon name="sun" /> {{ t('topbar.daylight') }}
      </button>
      <PerfPanel v-if="showGraphics" />
    </div>
    <button
      type="button"
      class="hud-pill topbar-toggle"
      data-testid="tt-topbar-toggle"
      :title="hud.collapsed.topBar ? t('hud.expandTopBar') : t('hud.collapseTopBar')"
      :aria-label="hud.collapsed.topBar ? t('hud.expandTopBar') : t('hud.collapseTopBar')"
      :aria-expanded="!hud.collapsed.topBar"
      @click="hud.toggle('topBar')"
    >
      <TtIcon :name="hud.collapsed.topBar ? 'down' : 'up'" />
    </button>
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
  gap: 0.5rem 1.25rem;
  flex-wrap: nowrap;
  padding: 0.55rem 0.9rem;
  background: var(--tt-panel-strong);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  border-bottom: 1px solid var(--tt-border);
  font-family: var(--tt-font);
  color: var(--tt-text);
}

.tt-topbar-main {
  display: flex;
  align-items: center;
  gap: 0.5rem 1rem;
  flex: 1 1 0;
  flex-wrap: wrap;
  min-width: 0;
}

/* The clock: the time large, the date and the elapsed run time stacked beside it. */
.clock {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 17rem;
  font-variant-numeric: tabular-nums;
}

.clock-time {
  font-family: var(--tt-font-mono);
  font-size: 1.45rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1;
  white-space: nowrap;
}

.clock-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  line-height: 1.1;
  white-space: nowrap;
}

.clock-when {
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.clock-day {
  color: var(--tt-accent);
}

.clock-date {
  color: var(--tt-text-muted);
}

.clock-elapsed {
  color: var(--tt-text-faint);
  font-family: var(--tt-font-mono);
  font-size: var(--tt-text-xs);
}

/* Transport: pause and the speeds as one segmented control. */
.speeds {
  display: flex;
  gap: 1px;
  padding: 2px;
  background: var(--tt-surface-sunken);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
}

.speed-btn {
  min-width: 1.7rem;
  height: 1.7rem;
  padding: 0 0.32rem;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: var(--tt-text-muted);
  font-family: var(--tt-font-mono);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  transition:
    background 0.12s var(--tt-ease),
    color 0.12s var(--tt-ease);
}

.speed-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.speed-btn:hover:not(:disabled) {
  background: var(--tt-control-hover);
  color: var(--tt-text);
}

.speed-btn.active {
  background: var(--tt-accent);
  color: var(--tt-on-accent);
  font-weight: 700;
}

.achieved {
  color: var(--tt-warn, var(--tt-text-muted));
  font-family: var(--tt-font-mono);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-left: auto;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 2rem;
  padding: 0 0.7rem;
  background: var(--tt-control);
  border: 1px solid var(--tt-hairline);
  border-radius: var(--tt-radius-sm);
  color: var(--tt-text);
  font-size: var(--tt-text-sm);
  font-weight: 500;
  white-space: nowrap;
  transition:
    background 0.12s var(--tt-ease),
    border-color 0.12s var(--tt-ease);
}

.action-btn .tt-icon {
  color: var(--tt-text-muted);
}

.action-btn:hover:not(:disabled) {
  background: var(--tt-control-hover);
  border-color: var(--tt-border-strong);
}

.action-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.action-btn.primary {
  background: var(--tt-accent);
  border-color: var(--tt-accent);
  color: var(--tt-on-accent);
  font-weight: 650;
}

.action-btn.primary:hover:not(:disabled) {
  background: var(--tt-accent-hover);
  border-color: var(--tt-accent-hover);
}

/* State by shape as well as colour: an active toggle carries a check mark. */
.action-btn.active::before,
.status::before {
  content: '';
  display: inline-block;
  flex: none;
  width: 0.9em;
  height: 0.9em;
  background: currentColor;
  -webkit-mask: var(--tt-mark) center / contain no-repeat;
  mask: var(--tt-mark) center / contain no-repeat;
}

.action-btn.active::before {
  --tt-mark: var(--tt-glyph-check);
  color: var(--tt-accent);
}

.action-btn.active {
  background: var(--tt-accent-soft);
  border-color: var(--tt-accent-line);
}

.action-btn.active .tt-icon {
  display: none;
}

.help-btn {
  width: 2rem;
  padding: 0;
}

.status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-width: 5.6rem;
  height: 2rem;
  padding: 0 0.7rem;
  border: 1px solid var(--tt-hairline);
  border-radius: 999px;
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tt-text-muted);
}

.status.running::before {
  --tt-mark: var(--tt-glyph-dot);
  color: var(--tt-accent);
}

.status.live {
  border-color: var(--tt-success-border);
  background: var(--tt-success-bg);
  color: var(--tt-success);
}

.status.live::before {
  --tt-mark: var(--tt-glyph-dot);
}

.status.paused {
  border-color: var(--tt-warn-border);
  background: var(--tt-warn-bg);
  color: var(--tt-warn);
}

.status.paused::before {
  --tt-mark: var(--tt-glyph-pause);
}

.status.complete::before {
  --tt-mark: var(--tt-glyph-check);
  color: var(--tt-success);
}

.status.failed {
  border-color: var(--tt-danger-border);
  background: var(--tt-danger-bg);
  color: var(--tt-danger);
}

.status.failed::before {
  --tt-mark: var(--tt-glyph-close);
}

/* View settings: ROB display, daylight and the graphics controls. */
.settings {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.5rem;
  flex: 0 1 auto;
  justify-content: flex-end;
  max-width: 29.5rem;
}

.rob-display {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  background: var(--tt-surface-sunken);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
}

.rob-label {
  padding: 0 0.45rem 0 0.4rem;
  color: var(--tt-text-faint);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rob-btn {
  height: 1.7rem;
  padding: 0 0.55rem;
  background: transparent;
  border-color: transparent;
  border-radius: 5px;
  color: var(--tt-text-muted);
  font-size: 0.76rem;
}

.rob-btn.active {
  background: var(--tt-accent-soft);
  border-color: var(--tt-accent-line);
  color: var(--tt-text);
}

.topbar-toggle {
  flex: none;
  align-self: flex-start;
}

.run-to {
  position: relative;
}

.run-to-pop {
  position: absolute;
  top: calc(100% + 0.5rem);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 17rem;
  padding: 0.9rem;
  background: var(--tt-surface-raised);
  border: 1px solid var(--tt-border-strong);
  border-radius: var(--tt-radius);
  box-shadow: var(--tt-shadow-lg);
}

.run-to-pop label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: var(--tt-text-sm);
  font-weight: 500;
  color: var(--tt-text-muted);
}

.pop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.error {
  color: var(--tt-danger);
  font-size: var(--tt-text-sm);
}

/* Phones and narrow windows: everything wraps inside the screen width (an over-wide bar stretched the whole view,
   and the 3D canvas with it, past the right edge of the screen). */
@media (max-width: 720px) {
  .tt-topbar {
    flex-wrap: wrap;
    padding: 0.4rem 3rem 0.4rem 0.5rem;
  }

  .tt-topbar-main {
    flex-basis: 100%;
  }

  .topbar-toggle {
    position: absolute;
    top: 0.4rem;
    right: 0.5rem;
  }

  .clock {
    min-width: 0;
  }

  .clock-time {
    font-size: 1.2rem;
  }

  .speeds {
    max-width: 100%;
    overflow-x: auto;
  }

  .speed-btn {
    flex: none;
  }

  .actions {
    margin-left: 0;
  }

  .settings {
    max-width: 100%;
    justify-content: flex-start;
  }
}
</style>
