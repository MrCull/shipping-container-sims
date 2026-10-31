<script setup lang="ts">
import { computed } from 'vue'
import { DECISION_POINT_IDS, strategies, type AsyncMode, type DecisionPointId, type DecisionsConfig, type LatencyDelay } from '../../engine'
import { t } from '../../i18n/messages'

/**
 * Decision points (TT-15): the async-mode toggle, a strategy dropdown per decision point and its latency
 * injector (delay distribution, timeout % and error %). Edits the scenario's `decisions` config.
 */
const model = defineModel<DecisionsConfig>({ required: true })

const ASYNC_MODES: AsyncMode[] = ['keep-running', 'pause']
const DELAY_KINDS: LatencyDelay['kind'][] = ['none', 'fixed', 'uniform', 'exponential']

const rows = computed(() =>
  DECISION_POINT_IDS.map((id) => {
    const registry = strategies[id]
    const cfg = model.value.points?.[id]
    const delay: LatencyDelay = cfg?.latency?.delay ?? { kind: 'none' }
    return {
      id,
      strategy: cfg?.strategy ?? registry.default,
      options: Object.entries(registry.strategies).map(([name, def]) => ({ name, description: def.description })),
      delay,
      timeoutPct: cfg?.latency?.timeoutPct ?? 0,
      errorPct: cfg?.latency?.errorPct ?? 0,
    }
  }),
)

function update(id: DecisionPointId, patch: { strategy?: string; delay?: LatencyDelay; timeoutPct?: number; errorPct?: number }): void {
  const next: DecisionsConfig = JSON.parse(JSON.stringify(model.value))
  next.points ??= {}
  const point = (next.points[id] ??= {})
  if (patch.strategy !== undefined) point.strategy = patch.strategy
  if (patch.delay || patch.timeoutPct !== undefined || patch.errorPct !== undefined) {
    const latency = (point.latency ??= {})
    if (patch.delay) latency.delay = patch.delay
    if (patch.timeoutPct !== undefined) latency.timeoutPct = patch.timeoutPct
    if (patch.errorPct !== undefined) latency.errorPct = patch.errorPct
  }
  model.value = next
}

function setAsyncMode(mode: AsyncMode): void {
  model.value = { ...JSON.parse(JSON.stringify(model.value)), asyncMode: mode }
}

function delayOf(kind: LatencyDelay['kind'], previous: LatencyDelay): LatencyDelay {
  const ms = previous.kind === 'fixed' ? previous.ms : previous.kind === 'exponential' ? previous.meanMs : previous.kind === 'uniform' ? previous.maxMs : 500
  if (kind === 'fixed') return { kind, ms }
  if (kind === 'uniform') return { kind, minMs: 0, maxMs: ms }
  if (kind === 'exponential') return { kind, meanMs: ms }
  return { kind: 'none' }
}

/** The one number a delay kind takes (uniform has two: min is edited next to it). */
function delayMs(d: LatencyDelay): number {
  return d.kind === 'fixed' ? d.ms : d.kind === 'exponential' ? d.meanMs : d.kind === 'uniform' ? d.maxMs : 0
}

function setDelayMs(row: (typeof rows.value)[number], raw: string): void {
  const n = Number(raw)
  const d = row.delay
  if (!Number.isFinite(n) || n < 0) return
  if (d.kind === 'fixed') update(row.id, { delay: { kind: 'fixed', ms: n } })
  else if (d.kind === 'exponential') update(row.id, { delay: { kind: 'exponential', meanMs: n } })
  else if (d.kind === 'uniform') update(row.id, { delay: { kind: 'uniform', minMs: Math.min(d.minMs, n), maxMs: n } })
}

const asyncMode = computed<AsyncMode>(() => model.value.asyncMode ?? 'keep-running')
const pct = (raw: string): number => Math.min(100, Math.max(0, Number(raw) || 0))
</script>

<template>
  <div data-testid="tt-decisions">
    <p class="hint">
      {{ t('setup.decisions.hint') }}
    </p>
    <div
      class="mode"
      role="radiogroup"
      :aria-label="t('setup.decisions.asyncMode')"
      data-testid="tt-async-mode"
    >
      <span>{{ t('setup.decisions.asyncMode') }}</span>
      <label
        v-for="m in ASYNC_MODES"
        :key="m"
        class="unit-choice"
      >
        <input
          type="radio"
          name="tt-async-mode"
          :value="m"
          :checked="asyncMode === m"
          :data-testid="`tt-async-${m}`"
          @change="setAsyncMode(m)"
        >
        {{ t(`setup.decisions.mode.${m}`) }}
      </label>
    </div>
    <div class="table">
      <div
        v-for="row in rows"
        :key="row.id"
        class="row"
        :data-testid="`tt-dp-${row.id}`"
      >
        <span class="dp">{{ row.id }}</span>
        <label class="mini">
          <span>{{ t('setup.decisions.strategy') }}</span>
          <select
            :value="row.strategy"
            :name="`dp-strategy-${row.id}`"
            @change="update(row.id, { strategy: ($event.target as HTMLSelectElement).value })"
          >
            <option
              v-for="o in row.options"
              :key="o.name"
              :value="o.name"
              :title="o.description"
            >
              {{ o.name }}
            </option>
          </select>
        </label>
        <label class="mini">
          <span>{{ t('setup.decisions.latency') }}</span>
          <select
            :value="row.delay.kind"
            :name="`dp-latency-${row.id}`"
            @change="update(row.id, { delay: delayOf(($event.target as HTMLSelectElement).value as LatencyDelay['kind'], row.delay) })"
          >
            <option
              v-for="k in DELAY_KINDS"
              :key="k"
              :value="k"
            >
              {{ t(`setup.decisions.delay.${k}`) }}
            </option>
          </select>
        </label>
        <label
          v-if="row.delay.kind !== 'none'"
          class="mini"
        >
          <span>{{ t('setup.decisions.delayMs') }}</span>
          <input
            type="number"
            step="any"
            :name="`dp-ms-${row.id}`"
            :value="delayMs(row.delay)"
            @input="setDelayMs(row, ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="mini">
          <span>{{ t('setup.decisions.timeoutPct') }}</span>
          <input
            type="number"
            step="any"
            :name="`dp-timeout-${row.id}`"
            :value="row.timeoutPct"
            @input="update(row.id, { timeoutPct: pct(($event.target as HTMLInputElement).value) })"
          >
        </label>
        <label class="mini">
          <span>{{ t('setup.decisions.errorPct') }}</span>
          <input
            type="number"
            step="any"
            :name="`dp-error-${row.id}`"
            :value="row.errorPct"
            @input="update(row.id, { errorPct: pct(($event.target as HTMLInputElement).value) })"
          >
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: var(--tt-text-muted);
}

.mode {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  align-items: center;
  margin-bottom: 0.6rem;
  font-size: 0.85rem;
}

.unit-choice {
  display: inline-flex;
  gap: 0.3rem;
  align-items: center;
}

.table {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.row {
  display: grid;
  grid-template-columns: 9rem repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
  align-items: end;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--tt-border);
}

.dp {
  font-size: 0.78rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.mini {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.7rem;
  color: var(--tt-text-muted);
}

.mini input,
.mini select {
  padding: 0.3rem 0.4rem;
  font: inherit;
  color: var(--tt-text);
  background: var(--tt-bg);
  border: 1px solid var(--tt-border);
  border-radius: 4px;
}

@media (max-width: 700px) {
  .row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dp {
    grid-column: 1 / -1;
  }
}
</style>
