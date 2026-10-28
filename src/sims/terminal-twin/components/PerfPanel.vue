<script setup lang="ts">
import { QUALITY_SETTINGS } from '../modules/quality'
import { usePerfStore } from '../store/perfStore'
import { useTwinStore } from '../store/twinStore'
import { t, type MessageKey } from '../i18n/messages'

const perf = usePerfStore()
const store = useTwinStore()
</script>

<template>
  <div
    class="perf"
    role="group"
    :aria-label="t('perf.group')"
    data-testid="tt-perf-panel"
  >
    <div
      v-if="perf.overlayVisible"
      class="readout"
      role="status"
      data-testid="tt-perf-overlay"
    >
      <span class="k">{{ t('perf.fps') }}</span>
      <span
        class="v"
        data-testid="tt-perf-fps"
      >{{ store.fmt.number(perf.stats.fps, 0) }}</span>
      <span class="k">{{ t('perf.drawCalls') }}</span>
      <span
        class="v"
        data-testid="tt-perf-calls"
      >{{ store.fmt.number(perf.stats.calls, 0) }}</span>
      <span class="k">{{ t('perf.triangles') }}</span>
      <span
        class="v"
        data-testid="tt-perf-triangles"
      >{{ store.fmt.number(perf.stats.triangles, 0) }}</span>
      <span class="k">{{ t('perf.cpu') }}</span>
      <span
        class="v"
        data-testid="tt-perf-cpu"
      >{{ store.fmt.number(perf.stats.cpuMs, 1) }}</span>
      <span class="k">{{ t('perf.level') }}</span>
      <span
        class="v"
        data-testid="tt-perf-level"
      >{{ t(`perf.quality.${perf.effective}` as MessageKey) }}</span>
    </div>
    <div class="row">
      <span class="label">{{ t('perf.quality') }}</span>
      <div
        class="seg"
        role="radiogroup"
        :aria-label="t('perf.quality')"
        :title="t('perf.qualityHint')"
      >
        <button
          v-for="s in QUALITY_SETTINGS"
          :key="s"
          type="button"
          role="radio"
          class="opt"
          :class="{ on: perf.setting === s }"
          :aria-checked="perf.setting === s"
          :data-testid="`tt-quality-${s}`"
          @click="perf.setSetting(s)"
        >
          {{ t(`perf.quality.${s}` as MessageKey) }}
        </button>
      </div>
      <button
        type="button"
        class="opt stats"
        :class="{ on: perf.overlayVisible }"
        :aria-pressed="perf.overlayVisible"
        :title="t('perf.statsHint')"
        data-testid="tt-perf-toggle"
        @click="perf.toggleOverlay()"
      >
        {{ t('perf.stats') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.perf {
  position: absolute;
  top: 0.8rem;
  right: 6.2rem; /* clear of the Inspector tab on the right edge */
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--color-text);
}

.row,
.readout {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: rgba(17, 24, 39, 0.88);
}

.readout {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.1rem 0.8rem;
  font-variant-numeric: tabular-nums;
}

.k {
  color: var(--color-text-muted);
}

.v {
  text-align: right;
  font-weight: 600;
}

.label {
  color: var(--color-text-muted);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.seg {
  display: inline-flex;
  gap: 0.2rem;
}

.opt {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.76rem;
}

.opt:hover {
  border-color: var(--color-primary);
}

.opt.on {
  border-color: var(--color-accent);
  background: rgba(245, 158, 11, 0.12);
}
</style>
