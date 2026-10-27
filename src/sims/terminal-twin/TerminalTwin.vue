<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import TopBar from './components/TopBar.vue'
import SetupDialog from './components/modals/SetupDialog.vue'
import { useTwinScene } from './composables/useTwinScene'
import { useTwinStore } from './store/twinStore'

const store = useTwinStore()
const sceneHost = ref<HTMLElement | null>(null)
const { webglFailed } = useTwinScene(sceneHost)

let uninstallDevApi: (() => void) | null = null
let unmounted = false

const ended = computed(() => {
  const info = store.info
  return !!info && info.status !== 'ready' && store.displayTime >= (info.endT ?? info.now)
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
  <div class="terminal-twin">
    <TopBar v-if="store.hasScenario" />
    <div
      ref="sceneHost"
      class="scene"
      data-testid="tt-scene"
    >
      <div
        v-if="webglFailed"
        class="notice"
      >
        3D view unavailable: WebGL could not start in this browser. The simulation still runs.
      </div>
      <div
        v-if="store.busy"
        class="notice busy"
        role="status"
      >
        Running flat out…
      </div>
      <div
        v-else-if="ended && store.info"
        class="banner"
        role="status"
      >
        <template v-if="store.info.status === 'ended'">
          Scenario complete · {{ store.info.endReason }} ·
          <span class="mono">{{ store.info.movesCompleted }}</span> moves
        </template>
        <template v-else>
          Run stopped: {{ store.info.firstError }}
        </template>
      </div>
    </div>
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
  top: 1rem;
  border-color: var(--color-success);
}

.mono {
  font-family: var(--tt-font-mono);
}
</style>
