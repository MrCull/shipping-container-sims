<script setup lang="ts">
import TtIcon from './ui/TtIcon.vue'
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import { useTwinStore } from '../store/twinStore'
import { crossedThreshold, prefersReducedMotion, stripItems, tween, type StripItemId } from '../modules/kpiStrip'
import { t } from '../i18n/messages'
import { useHudStore } from '../store/hudStore'

const COUNT_UP_MS = 600
const PULSE_MS = 900

const store = useTwinStore()
const hud = useHudStore()
const items = computed(() => (store.kpi ? stripItems(store.kpi.headline) : []))

/** Displayed (animated) value and pulse flag per item. */
const shown = reactive<Partial<Record<StripItemId, number>>>({})
const pulsing = reactive<Partial<Record<StripItemId, boolean>>>({})
const lastTarget: Partial<Record<StripItemId, number | null>> = {}
const animations = new Map<StripItemId, { from: number; to: number; start: number }>()
const pulseTimers = new Map<StripItemId, ReturnType<typeof setTimeout>>()
let frame = 0

function pulse(id: StripItemId): void {
  pulsing[id] = true
  clearTimeout(pulseTimers.get(id))
  pulseTimers.set(
    id,
    setTimeout(() => {
      pulsing[id] = false
    }, PULSE_MS),
  )
}

function loop(now: number): void {
  frame = 0
  for (const [id, a] of animations) {
    shown[id] = tween(a.from, a.to, now - a.start, COUNT_UP_MS)
    if (now - a.start >= COUNT_UP_MS) animations.delete(id)
  }
  if (animations.size > 0) frame = requestAnimationFrame(loop)
}

watch(
  items,
  (list) => {
    const present = new Set(list.map((i) => i.id))
    for (const id of Object.keys(shown) as StripItemId[]) {
      if (!present.has(id)) {
        delete shown[id]
        delete lastTarget[id]
        animations.delete(id)
      }
    }
    for (const item of list) {
      if (item.value === null) {
        delete shown[item.id]
        lastTarget[item.id] = null
        continue
      }
      const prev = lastTarget[item.id] ?? null
      if (item.threshold !== undefined && crossedThreshold(prev, item.value, item.threshold)) pulse(item.id)
      const current = shown[item.id]
      if (current === undefined || prefersReducedMotion()) shown[item.id] = item.value
      else if (current !== item.value) animations.set(item.id, { from: current, to: item.value, start: performance.now() })
      lastTarget[item.id] = item.value
    }
    if (animations.size > 0 && !frame) frame = requestAnimationFrame(loop)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  for (const timer of pulseTimers.values()) clearTimeout(timer)
})
</script>

<template>
  <button
    v-if="items.length && hud.collapsed.kpis"
    type="button"
    class="hud-pill kpi-pill"
    data-testid="tt-kpi-expand"
    :aria-label="t('kpi.strip')"
    :aria-expanded="false"
    @click="hud.toggle('kpis')"
  >
    {{ t('hud.kpisShort') }} <TtIcon name="down" />
  </button>
  <ul
    v-else-if="items.length"
    class="kpi-strip"
    data-hud-region="kpiStrip"
    data-testid="tt-kpi-strip"
    :aria-label="t('kpi.strip')"
  >
    <li
      v-for="item in items"
      :key="item.id"
      class="kpi"
      :class="{ pulse: pulsing[item.id] }"
      :data-testid="`tt-kpi-${item.id}`"
      :data-value="item.value ?? ''"
      :data-pulse="pulsing[item.id] ? 'on' : 'off'"
    >
      <span class="label">{{ t(item.labelKey) }}</span>
      <span
        class="value"
        :style="{ minWidth: `${item.minWidthCh}ch` }"
      >{{ shown[item.id] === undefined ? t('unit.none') : item.format(store.fmt, shown[item.id] as number) }}</span>
    </li>
    <li class="kpi-collapse">
      <button
        type="button"
        class="hud-pill"
        data-testid="tt-kpi-collapse"
        :title="t('hud.collapseKpis')"
        :aria-label="t('hud.collapseKpis')"
        :aria-expanded="true"
        @click="hud.toggle('kpis')"
      >
        <TtIcon name="up" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.kpi-pill {
  grid-column: 2;
  grid-row: 1;
  justify-self: start;
  align-self: start;
  position: relative;
  z-index: 4;
  margin: 0.6rem 0.8rem 0;
}

.kpi-collapse {
  align-self: center;
  padding: 0 0.4rem;
  pointer-events: auto;
}

.kpi-collapse .hud-pill {
  border-color: transparent;
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

/* One glass strip of figures, a hairline between them. */
.kpi-strip {
  /* Grid cell between the side panels; wraps onto more rows rather than overflowing. */
  grid-column: 2;
  grid-row: 1;
  justify-self: start;
  position: relative;
  z-index: 4;
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  max-width: calc(100% - 1.6rem);
  margin: 0.7rem 0.8rem 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
  pointer-events: none;
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius);
  background: var(--tt-panel);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  box-shadow: var(--tt-shadow);
  font-family: var(--tt-font);
  color: var(--tt-text);
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 5.6rem;
  padding: 0.5rem 0.85rem 0.55rem;
  box-shadow: inset -1px 0 0 var(--tt-hairline);
}

.label {
  font-size: 0.64rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--tt-text-faint);
}

.value {
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.15;
}

.kpi.pulse {
  animation: tt-kpi-pulse 0.9s ease-out;
}

@keyframes tt-kpi-pulse {
  0% {
    background: var(--tt-accent-soft);
  }
  100% {
    background: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kpi.pulse {
    animation: none;
    background: var(--tt-accent-soft);
  }
}
</style>
