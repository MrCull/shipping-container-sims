<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import FinalReport from './components/FinalReport.vue'
import KpiStrip from './components/KpiStrip.vue'
import EventFeedPanel from './components/debug/EventFeedPanel.vue'
import InspectorPanel from './components/debug/InspectorPanel.vue'
import OverlayToggles from './components/OverlayToggles.vue'
import TopBar from './components/TopBar.vue'
import SetupDialog from './components/modals/SetupDialog.vue'
import SavesDialog from './components/modals/SavesDialog.vue'
import ShortcutHelp from './components/modals/ShortcutHelp.vue'
import { useTwinScene } from './composables/useTwinScene'
import { useTwinShortcuts } from './composables/useTwinShortcuts'
import { useTwinStore } from './store/twinStore'
import { describeEndReason } from './modules/endReason'
import { t } from './i18n/messages'

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
    <SavesDialog v-if="store.savesOpen && store.phase === 'running'" />
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
