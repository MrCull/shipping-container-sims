<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import FinalReport from './components/FinalReport.vue'
import KpiStrip from './components/KpiStrip.vue'
import DepartureBanner from './components/DepartureBanner.vue'
import EventFeedPanel from './components/debug/EventFeedPanel.vue'
import InspectorPanel from './components/debug/InspectorPanel.vue'
import OverlayToggles from './components/OverlayToggles.vue'
import TopBar from './components/TopBar.vue'
import SetupDialog from './components/modals/SetupDialog.vue'
import ShortcutHelp from './components/modals/ShortcutHelp.vue'
import { useTwinScene } from './composables/useTwinScene'
import { useTwinShortcuts } from './composables/useTwinShortcuts'
import { useTwinStore } from './store/twinStore'
import { describeEndReason } from './modules/endReason'
import { t } from './i18n/messages'
import { quayNote } from './modules/microcopy'

const store = useTwinStore()
// Dev-only asset viewer: /sim/terminal-twin?viewer=<asset>|yard (stripped from production builds).
const assetViewer = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('viewer') : null
const AssetViewer = import.meta.env.DEV ? defineAsyncComponent(() => import('./dev/AssetViewer.vue')) : null
/** The dashboard tab (and, through it, ECharts) loads on first open, never with the 3D view. */
const DashboardTab = defineAsyncComponent(() => import('./components/DashboardTab.vue'))
const sceneHost = ref<HTMLElement | null>(null)
const { webglFailed } = useTwinScene(sceneHost)
useTwinShortcuts()

let uninstallDevApi: (() => void) | null = null
let unmounted = false

const ended = computed(() => store.runEnded)

/** Friendly note while the quay is empty (re-evaluated every 30 sim seconds, not every frame). */
const quietNote = computed(() => {
  const model = store.controller()?.model
  if (!store.hasScenario || !model || store.runEnded) return null
  const note = quayNote(model, Math.floor(store.displayTime / 30) * 30)
  if (!note) return null
  const time = note.etaS === undefined ? '' : store.fmt.clock(store.choice.startDateTime, note.etaS).time
  return t(note.key, { time })
})

onMounted(async () => {
  if (import.meta.env.DEV) {
    const { installDevApi } = await import('./dev/devApi')
    if (!unmounted) uninstallDevApi = installDevApi(store)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  uninstallDevApi?.()
  store.dispose()
})
</script>

<template>
  <component
    :is="AssetViewer"
    v-if="AssetViewer && assetViewer"
    :initial="assetViewer"
  />
  <div
    v-else
    class="terminal-twin"
  >
    <TopBar v-if="store.hasScenario" />
    <div
      ref="sceneHost"
      class="scene"
      data-testid="tt-scene"
    >
      <KpiStrip v-if="store.hasScenario" />
      <DepartureBanner v-if="store.hasScenario" />
      <p
        v-if="quietNote"
        class="quiet-note"
        data-testid="tt-quiet-note"
      >
        {{ quietNote }}
      </p>
      <FinalReport v-if="store.hasScenario && store.phase === 'running' && !store.dashboardOpen" />
      <OverlayToggles v-if="store.hasScenario && !webglFailed" />
      <EventFeedPanel v-if="store.hasScenario" />
      <InspectorPanel v-if="store.hasScenario" />
      <div
        v-if="webglFailed"
        class="notice"
      >
        {{ t('twin.webglUnavailable') }}
      </div>
      <div
        v-if="store.busy"
        class="notice busy"
        role="status"
      >
        {{ t('twin.runningFlatOut') }}
      </div>
      <div
        v-else-if="ended && store.info"
        class="banner"
        :class="{ 'banner-complete': store.info.status === 'ended' }"
        role="status"
      >
        <template v-if="store.info.status === 'ended'">
          {{ t('twin.scenarioComplete', { reason: describeEndReason(store.info.endReason, store.fmt), moves: store.fmt.number(store.info.movesCompleted, 0) }) }}
        </template>
        <template v-else>
          {{ t('twin.runStopped', { error: store.info.firstError ?? '' }) }}
        </template>
      </div>
      <div
        v-if="store.toast"
        :key="store.toast.id"
        class="toast"
        role="status"
        data-testid="tt-toast"
      >
        {{ store.toast.text }}
      </div>
      <DashboardTab v-if="store.dashboardOpen && store.hasScenario" />
    </div>
    <ShortcutHelp v-if="store.helpOpen && store.phase === 'running'" />
    <SetupDialog v-if="store.phase === 'setup'" />
  </div>
</template>

<style scoped>
.terminal-twin {
  --tt-font-mono: ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 52px);
  font-family: var(--font-body);
  background: var(--color-bg);
}

.scene {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.scene :deep(.tt-canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.notice,
.banner {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: rgba(17, 24, 39, 0.9);
  color: var(--color-text);
  font-size: 0.9rem;
}

.notice {
  top: 40%;
}

.notice.busy {
  border-color: var(--color-primary);
}

.banner {
  bottom: 3.4rem;
  border-color: var(--color-success);
}

.banner-complete {
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.3);
  animation: tt-toast-in 0.4s ease-out;
}

.quiet-note {
  position: absolute;
  left: 0.9rem;
  bottom: 0.9rem;
  z-index: 4;
  margin: 0;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: rgba(17, 24, 39, 0.82);
  color: var(--color-text-muted);
  font-size: 0.82rem;
  pointer-events: none;
}

.toast {
  position: absolute;
  left: 50%;
  bottom: 1.2rem;
  transform: translateX(-50%);
  z-index: 6;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: rgba(17, 24, 39, 0.92);
  color: var(--color-text);
  font-size: 0.82rem;
  animation: tt-toast-in 0.15s ease-out;
}

@keyframes tt-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 0.4rem);
  }
}
</style>
