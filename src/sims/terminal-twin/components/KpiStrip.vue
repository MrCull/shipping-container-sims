<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import { useTwinStore } from '../store/twinStore'
import { crossedThreshold, prefersReducedMotion, stripItems, tween, type StripItemId } from '../modules/kpiStrip'
import { t } from '../i18n/messages'

const COUNT_UP_MS = 600
const PULSE_MS = 900

const store = useTwinStore()
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
  <ul
    v-if="items.length"
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
      <span class="value">{{ shown[item.id] === undefined ? t('unit.none') : item.format(store.fmt, shown[item.id] as number) }}</span>
    </li>
  </ul>
</template>

<style scoped>
.kpi-strip {
  /* Grid cell between the side panels; wraps onto more rows rather than overflowing. */
  grid-column: 2;
  grid-row: 1;
  justify-self: start;
  position: relative;
  z-index: 4;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-width: 0;
  max-width: 100%;
  margin: 0.6rem 0.8rem 0;
  padding: 0;
  list-style: none;
  pointer-events: none;
  font-family: var(--font-body);
}

.kpi {
  display: flex;
  flex-direction: column;
  min-width: 5.6rem;
  padding: 0.3rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: rgba(17, 24, 39, 0.82);
  color: var(--color-text);
  backdrop-filter: blur(4px);
}

.label {
  font-size: 0.66rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.value {
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.98rem;
  font-weight: 600;
}

.kpi.pulse {
  animation: tt-kpi-pulse 0.9s ease-out;
}

@keyframes tt-kpi-pulse {
  0% {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
  }
  100% {
    border-color: var(--color-border);
    box-shadow: 0 0 0 0.9rem rgba(245, 158, 11, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .kpi.pulse {
    animation: none;
    border-color: var(--color-accent);
  }
}
</style>
