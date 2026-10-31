<script setup lang="ts">
import TtIcon from './ui/TtIcon.vue'
import { computed } from 'vue'
import type { ExportKind } from '../engine'
import { useTwinStore } from '../store/twinStore'
import { describeEndReason } from '../modules/endReason'
import { highlightText } from '../modules/highlights'
import { stripItems } from '../modules/kpiStrip'
import { t } from '../i18n/messages'

/** `embedded`: shown inside the dashboard's report tab (no docking, no close button). */
const props = defineProps<{ embedded?: boolean }>()
const store = useTwinStore()
const report = computed(() => store.finalReport)
const fmt = computed(() => store.fmt)
const info = computed(() => store.info)

const heading = computed(() => {
  const i = info.value
  if (!i) return ''
  return i.status === 'failed'
    ? t('report.failed', { error: i.firstError ?? '' })
    : t('report.ended', { reason: describeEndReason(i.endReason, fmt.value) })
})

const summary = computed(() => {
  const r = report.value
  if (!r) return ''
  return t('report.summary', {
    moves: fmt.value.number(r.kpis.movesCompleted, 0),
    vessels: fmt.value.number(r.kpis.vesselsCompleted, 0),
    time: fmt.value.duration(r.kpis.simTimeS),
  })
})

const headline = computed(() =>
  report.value
    ? stripItems(report.value.headline).map((i) => ({
        id: i.id,
        label: t(i.labelKey),
        text: i.value === null ? t('unit.none') : i.format(fmt.value, i.value),
      }))
    : [],
)

const highlights = computed(() => (report.value ? report.value.highlights.map((h) => highlightText(h, fmt.value)) : []))

const cranes = computed(() => {
  const r = report.value
  if (!r) return []
  const total = (kpi: string, id: string) => r.series.series[kpi]?.entities[id]?.total ?? null
  const rate = (v: number | null) => (v === null ? t('unit.none') : fmt.value.movesPerHour(v))
  return Object.entries(r.kpis.sts).map(([id, k]) => ({
    id,
    moves: fmt.value.number(k.moves, 0),
    gross: rate(total('sts.gross-moves-per-hour', id)),
    net: rate(total('sts.net-moves-per-hour', id)),
    waitShc: fmt.value.duration(total('sts.wait-shc-s', id) ?? 0),
    waitWork: fmt.value.duration(total('sts.wait-work-s', id) ?? 0),
  }))
})

const handlers = computed(() => {
  const r = report.value
  if (!r) return []
  return Object.entries(r.kpis.handlers).map(([id, h]) => ({
    id,
    handler: h.handler,
    calls: fmt.value.number(h.calls, 0),
    fallbacks: fmt.value.number(h.fallbacks + h.timeouts + h.errors, 0),
    simLatency: fmt.value.duration(h.simLatencyS.mean),
    wallLatency: fmt.value.duration(h.wallLatencyMs.mean / 1000),
    idle: fmt.value.duration(h.equipmentIdleS),
  }))
})

const vessels = computed(() => {
  const r = report.value
  if (!r) return []
  const span = (s: number | null) => (s === null ? t('unit.none') : fmt.value.duration(s))
  return Object.entries(r.kpis.vessels).map(([id, v]) => ({
    id,
    sizeClass: v.sizeClass,
    anchorage: span(v.anchorageWaitS),
    turnaround: span(v.turnaroundS),
  }))
})

const EXPORTS: { kind: ExportKind; label: Parameters<typeof t>[0] }[] = [
  { kind: 'kpi-json', label: 'report.export.kpiJson' },
  { kind: 'kpi-csv', label: 'report.export.kpiCsv' },
  { kind: 'events-json', label: 'report.export.eventsJson' },
  { kind: 'events-csv', label: 'report.export.eventsCsv' },
]
</script>

<template>
  <button
    v-if="!props.embedded && store.runEnded && !store.reportOpen"
    class="reopen"
    :class="{ shifted: store.inspectorOpen }"
    data-testid="tt-report-reopen"
    @click="store.reportOpen = true"
  >
    {{ t('report.show') }}
  </button>
  <component
    :is="props.embedded ? 'section' : 'aside'"
    v-else-if="props.embedded || store.runEnded"
    class="report"
    :class="{ shifted: store.inspectorOpen && !props.embedded, embedded: props.embedded }"
    role="region"
    :aria-label="t('report.region')"
    data-testid="tt-final-report"
  >
    <header>
      <h2>{{ t('report.title') }}</h2>
      <button
        v-if="!props.embedded"
        class="close"
        :aria-label="t('report.close')"
        data-testid="tt-report-close"
        @click="store.reportOpen = false"
      >
        <TtIcon name="close" />
      </button>
    </header>
    <p
      class="reason"
      data-testid="tt-report-reason"
    >
      {{ heading }}
    </p>
    <p
      v-if="!report"
      class="muted"
    >
      {{ t('report.loading') }}
    </p>
    <template v-else>
      <p class="muted">
        {{ summary }}
      </p>

      <section
        class="card highlights"
        data-testid="tt-report-highlights"
      >
        <h3>{{ t('report.highlights') }}</h3>
        <ul v-if="highlights.length">
          <li
            v-for="(text, i) in highlights"
            :key="i"
          >
            {{ text }}
          </li>
        </ul>
        <p
          v-else
          class="muted"
        >
          {{ t('report.noHighlights') }}
        </p>
      </section>

      <section class="card">
        <h3>{{ t('report.headline') }}</h3>
        <dl class="kpis">
          <template
            v-for="item in headline"
            :key="item.id"
          >
            <dt>{{ item.label }}</dt>
            <dd :data-testid="`tt-report-${item.id}`">
              {{ item.text }}
            </dd>
          </template>
        </dl>
      </section>

      <section class="card">
        <h3>{{ t('report.cranes') }}</h3>
        <table>
          <thead>
            <tr>
              <th>{{ t('report.col.crane') }}</th>
              <th>{{ t('report.col.moves') }}</th>
              <th>{{ t('report.col.gross') }}</th>
              <th>{{ t('report.col.net') }}</th>
              <th>{{ t('report.col.waitShc') }}</th>
              <th>{{ t('report.col.waitWork') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in cranes"
              :key="c.id"
            >
              <th scope="row">
                {{ c.id }}
              </th>
              <td>{{ c.moves }}</td>
              <td>{{ c.gross }}</td>
              <td>{{ c.net }}</td>
              <td>{{ c.waitShc }}</td>
              <td>{{ c.waitWork }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h3>{{ t('report.vessels') }}</h3>
        <table>
          <thead>
            <tr>
              <th>{{ t('report.col.vessel') }}</th>
              <th>{{ t('report.col.sizeClass') }}</th>
              <th>{{ t('report.col.anchorage') }}</th>
              <th>{{ t('report.col.turnaround') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="v in vessels"
              :key="v.id"
            >
              <th scope="row">
                {{ v.id }}
              </th>
              <td>{{ v.sizeClass }}</td>
              <td>{{ v.anchorage }}</td>
              <td>{{ v.turnaround }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section
        v-if="handlers.length > 0"
        class="card"
        data-testid="tt-report-handlers"
      >
        <h3>{{ t('report.handlers') }}</h3>
        <table>
          <thead>
            <tr>
              <th>{{ t('report.col.handler') }}</th>
              <th>{{ t('report.col.calls') }}</th>
              <th>{{ t('report.col.fallbacks') }}</th>
              <th>{{ t('report.col.simLatency') }}</th>
              <th>{{ t('report.col.wallLatency') }}</th>
              <th>{{ t('report.col.equipmentIdle') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="h in handlers"
              :key="h.id"
            >
              <th
                scope="row"
                :title="h.handler"
              >
                {{ h.id }}
              </th>
              <td>{{ h.calls }}</td>
              <td>{{ h.fallbacks }}</td>
              <td>{{ h.simLatency }}</td>
              <td>{{ h.wallLatency }}</td>
              <td>{{ h.idle }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h3>{{ t('report.export') }}</h3>
        <div class="exports">
          <button
            v-for="e in EXPORTS"
            :key="e.kind"
            class="export-btn"
            :data-testid="`tt-export-${e.kind}`"
            @click="store.downloadExport(e.kind)"
          >
            {{ t(e.label) }}
          </button>
        </div>
      </section>
      <p class="muted hash">
        {{ t('report.hash', { hash: report.eventLogHash }) }}
      </p>
    </template>
  </component>
</template>

<style scoped>
.report {
  position: absolute;
  top: 0.6rem;
  right: 5rem;
  bottom: 0.8rem;
  z-index: 7;
  width: min(26rem, calc(100% - 1.6rem));
  overflow-y: auto;
  padding: 0.8rem 0.9rem;
  border-radius: 10px;
  border: 1px solid var(--tt-success);
  background: var(--tt-panel-strong);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  color: var(--tt-text);
  font-family: var(--tt-font);
  font-size: 0.85rem;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 {
  font-size: 1.1rem;
}

h3 {
  margin-bottom: 0.35rem;
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tt-text-muted);
}

.report.embedded {
  position: static;
  width: auto;
  max-width: 60rem;
  margin: 0 auto;
  border-color: var(--tt-border);
  background: transparent;
  overflow: visible;
}

.close,
.reopen,
.export-btn {
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  background: var(--tt-surface);
  color: var(--tt-text);
  cursor: pointer;
  font: inherit;
}

.close {
  padding: 0.1rem 0.45rem;
}

.close:hover,
.reopen:hover,
.export-btn:hover {
  background: var(--tt-surface-hover);
}

.reopen {
  position: absolute;
  right: 3.4rem;
  top: 0.6rem;
  z-index: 7;
  padding: 0.35rem 0.8rem;
  border-color: var(--tt-success);
}

.reason {
  margin: 0.4rem 0 0.2rem;
  font-weight: 600;
}

.muted {
  color: var(--tt-text-muted);
  font-size: 0.8rem;
}

.hash {
  margin-top: 0.6rem;
  word-break: break-all;
}

.card {
  margin-top: 0.7rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--tt-border);
  background: var(--tt-surface-sunken);
}

.highlights {
  border-color: var(--tt-accent);
}

.highlights ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.3rem;
}

.kpis {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.2rem 0.8rem;
  margin: 0;
}

.kpis dt {
  color: var(--tt-text-muted);
}

.kpis dd {
  margin: 0;
  text-align: right;
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 0.15rem 0.3rem;
  text-align: right;
  font-size: 0.76rem;
  font-weight: 400;
}

th:first-child {
  text-align: left;
}

thead th {
  color: var(--tt-text-muted);
  font-weight: 500;
}

.exports {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.export-btn {
  padding: 0.3rem 0.6rem;
}
</style>

<style scoped>
.report.shifted,
.reopen.shifted {
  right: 24rem;
}
</style>
