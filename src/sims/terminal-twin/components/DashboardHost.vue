<script setup lang="ts">
/**
 * Mounts the dashboard tab, which is a separate chunk fetched on first open (the 3D view never
 * pays for it). While the chunk loads it shows a status line; if the fetch fails it shows the
 * error with a Retry button, so the Dashboard button never appears to do nothing.
 */
import { onMounted } from 'vue'
import TtIcon from './ui/TtIcon.vue'
import { createLazyComponent } from '../modules/lazyComponent'
import { useTwinStore } from '../store/twinStore'
import { t } from '../i18n/messages'

const store = useTwinStore()
const lazy = createLazyComponent(() => import('./DashboardTab.vue'))
const { state, error, component } = lazy

onMounted(() => void lazy.load())
</script>

<template>
  <component
    :is="component"
    v-if="state === 'ready' && component"
  />
  <section
    v-else
    class="dashboard-pending"
    data-testid="tt-dashboard-pending"
    :aria-label="t('dashboard.title')"
  >
    <header class="head">
      <h2>{{ t('dashboard.title') }}</h2>
      <button
        class="close"
        :aria-label="t('dashboard.close')"
        data-testid="tt-dashboard-close"
        @click="store.toggleDashboard()"
      >
        <TtIcon name="close" />
      </button>
    </header>
    <p
      v-if="state === 'error'"
      class="msg"
      role="alert"
      data-testid="tt-dashboard-error"
    >
      {{ t('dashboard.tabLoadFailed', { error }) }}
      <button
        class="retry"
        data-testid="tt-dashboard-retry"
        @click="lazy.load()"
      >
        {{ t('dashboard.retry') }}
      </button>
    </p>
    <p
      v-else
      class="msg"
      role="status"
      data-testid="tt-dashboard-loading"
    >
      {{ t('dashboard.loadingTab') }}
    </p>
  </section>
</template>

<style scoped>
.dashboard-pending {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: var(--tt-bg);
  color: var(--tt-text);
  font-family: var(--tt-font);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--tt-border);
}

h2 {
  font-size: 1.1rem;
}

.msg {
  padding: 1rem;
  color: var(--tt-text-muted);
  font-size: 0.9rem;
}

.close,
.retry {
  padding: 0.15rem 0.55rem;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  background: var(--tt-surface);
  color: var(--tt-text);
  cursor: pointer;
  font: inherit;
}

.retry {
  margin-left: 0.75rem;
  padding: 0.3rem 0.8rem;
}

.close:hover,
.retry:hover {
  background: var(--tt-surface-hover);
}
</style>
