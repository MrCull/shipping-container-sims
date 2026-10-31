<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import FpsChip from './components/FpsChip.vue'
import DashboardHost from './components/DashboardHost.vue'
import FinalReport from './components/FinalReport.vue'
import KpiStrip from './components/KpiStrip.vue'
import BayViewer from './components/BayViewer.vue'
import DepartureBanner from './components/DepartureBanner.vue'
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
import { quayNote } from './modules/microcopy'

const store = useTwinStore()
// Dev-only asset viewer: /sim/terminal-twin?viewer=<asset>|yard (stripped from production builds).
const assetViewer = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('viewer') : null
const AssetViewer = import.meta.env.DEV ? defineAsyncComponent(() => import('./dev/AssetViewer.vue')) : null
const sceneHost = ref<HTMLElement | null>(null)
const { webglFailed } = useTwinScene(sceneHost)
useTwinShortcuts()

let uninstallDevApi: (() => void) | null = null
let unmounted = false

/** SimPage's top-right slot (beside the shared audio control) takes the FPS chip. */
const hasHeaderSlot = !!document.getElementById('sim-header-slot')

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
    <Teleport
      v-if="hasHeaderSlot && !webglFailed"
      to="#sim-header-slot"
    >
      <FpsChip />
    </Teleport>
    <TopBar
      v-if="store.hasScenario"
      :show-graphics="!webglFailed"
    />
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
      <BayViewer v-if="store.hasScenario && store.bayViewerVesselId" />
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
      <DashboardHost v-if="store.dashboardOpen && store.hasScenario" />
    </div>
    <ShortcutHelp v-if="store.helpOpen && store.phase === 'running'" />
    <SavesDialog v-if="store.savesOpen && store.phase === 'running'" />
    <SetupDialog v-if="store.phase === 'setup'" />
  </div>
</template>

<!-- The skin tokens (unscoped: the FPS chip is teleported out of this component). -->
<style src="./skin.css"></style>

<style scoped>
.terminal-twin {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 52px);
  font-family: var(--tt-font);
  background: var(--tt-bg);
}

.scene {
  position: relative;
  /* 0px basis (not 0%): the side panels' content must never grow the scene past the viewport. */
  flex: 1 1 0px;
  min-height: 0;
  overflow: hidden;
  /* HUD regions: left panel | KPI strip over the free scene over the overlay bar | right panel. The KPI strip gets
     the width left between the side panels, so it can never sit underneath them. */
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: auto minmax(0, 1fr) auto;
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
  border: 1px solid var(--tt-border);
  background: var(--tt-panel);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  color: var(--tt-text);
  font-size: 0.9rem;
}

.notice {
  top: 40%;
}

.notice.busy {
  border-color: var(--tt-accent);
}

.banner {
  bottom: 4.6rem;
  border-color: var(--tt-success);
}

.banner-complete {
  box-shadow: var(--tt-shadow);
  animation: tt-toast-in 0.4s ease-out;
}

.quiet-note {
  grid-column: 2;
  grid-row: 2;
  align-self: end;
  justify-self: start;
  position: relative;
  margin: 0 0 0.6rem 0.9rem;
  z-index: 4;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--tt-border);
  background: var(--tt-panel);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  color: var(--tt-text-muted);
  font-size: 0.82rem;
  pointer-events: none;
}

.toast {
  position: absolute;
  left: 50%;
  bottom: 7.4rem;
  transform: translateX(-50%);
  z-index: 6;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--tt-border);
  background: var(--tt-panel);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  color: var(--tt-text);
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
