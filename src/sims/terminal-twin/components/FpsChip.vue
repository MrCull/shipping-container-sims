<script setup lang="ts">
import { computed } from 'vue'
import { fpsSeverity } from '../modules/fpsChip'
import { usePerfStore } from '../store/perfStore'
import { t } from '../i18n/messages'

const perf = usePerfStore()
const severity = computed(() => fpsSeverity(perf.stats.fps))
const label = computed(() => (perf.stats.fps > 0 ? Math.round(perf.stats.fps) : '--'))
</script>

<template>
  <button
    type="button"
    class="fps-chip tt-skin"
    :class="severity"
    :aria-pressed="perf.overlayVisible"
    :title="t('perf.chipHint')"
    data-testid="tt-fps-chip"
    :data-severity="severity"
    @click="perf.toggleOverlay()"
  >
    <span class="num">{{ label }}</span>
    <span class="unit">{{ t('perf.fps') }}</span>
  </button>
</template>

<style scoped>
.fps-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 2rem;
  padding: 0 0.6rem;
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
  background: var(--tt-panel-strong);
  color: var(--tt-text);
  font-family: var(--tt-font);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.fps-chip:hover {
  border-color: var(--tt-accent);
}

.num {
  min-width: 2ch;
  text-align: right;
  font-weight: 700;
}

.fps-chip.warn {
  border-color: var(--tt-warn-border);
  background: var(--tt-warn-bg);
  color: var(--tt-warn);
}

.fps-chip.bad {
  border-color: var(--tt-danger-border);
  background: var(--tt-danger-bg);
  color: var(--tt-danger);
}
</style>
