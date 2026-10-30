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
    class="fps-chip"
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
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.fps-chip:hover {
  border-color: var(--color-primary);
}

.num {
  min-width: 2ch;
  text-align: right;
  font-weight: 700;
}

.fps-chip.warn {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.fps-chip.bad {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}
</style>
