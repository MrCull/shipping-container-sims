<script setup lang="ts">
/**
 * Full-screen dashboard tab (TT-16): zoomable KPI time series per group, the
 * yard fill heatmap and a vessel/crane Gantt, plus the final report as a tab.
 * Apache ECharts is loaded lazily (dynamic import) the first time this
 * component mounts, so the 3D view never pays for it.
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, shallowRef, ref, watch } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import { useTwinStore, type DashboardRendered } from '../store/twinStore'
import FinalReport from './FinalReport.vue'
import {
  buildGroupCharts,
  buildLandsideSummary,
  buildYardHeatmap,
  groupsWithData,
  kpiLabelKey,
  landsideLabelKey,
  type Bucketing,
  type KpiGroupId,
} from '../modules/dashboardModel'
import {
  buildGanttModel,
  ganttOption,
  heatmapOption,
  lineChartOption,
  phaseLabelKey,
  type ChartFormat,
} from '../modules/dashboardOptions'
import { PHASE_COLOURS, SEQUENTIAL_BLUE, seriesStyle, type TimelinePhase } from '../modules/dashboardPalette'
import { t } from '../i18n/messages'

type ChartLib = typeof import('../modules/chartLib')
type Instance = ReturnType<ChartLib['echarts']['init']>

const store = useTwinStore()
const fmt = computed(() => store.fmt)
const data = computed(() => store.dashboardData)

const lib = shallowRef<ChartLib | null>(null)
const libError = ref('')

onMounted(async () => {
  try {
    lib.value = markRaw(await import('../modules/chartLib'))
  } catch (err) {
    libError.value = err instanceof Error ? err.message : String(err)
  }
})

// ------------------------------------------------------------------- selection

const groups = computed<KpiGroupId[]>(() => (data.value ? groupsWithData(data.value.series) : []))
const group = computed<KpiGroupId>(() =>
  groups.value.includes(store.dashboardGroup) ? store.dashboardGroup : (groups.value[0] ?? 'quay'),
)
const bucketing = computed<Bucketing>(() => store.dashboardBucketing)
const BUCKETS: Bucketing[] = ['hour', 'shift']

const charts = computed(() => (data.value ? buildGroupCharts(data.value.series, group.value, bucketing.value) : []))
const heatmap = computed(() => (data.value ? buildYardHeatmap(data.value.series) : null))
const gantt = computed(() => (data.value ? buildGanttModel(data.value.timeline) : null))
const liveFill = computed(() => data.value?.yard ?? [])

const showYard = computed(() => group.value === 'yard')
const showGantt = computed(() => group.value === 'quay')
const showLandside = computed(() => group.value === 'landside')
const landsideRows = computed(() => buildLandsideSummary(data.value?.landside))

// ----------------------------------------------------------------- formatting

const chartFormat = computed<ChartFormat>(() => {
  const f = fmt.value
  const start = store.config?.startDateTime ?? new Date(0).toISOString()
  return {
    time: (s) => {
      const c = f.clock(start, s)
      return `${c.day} ${c.time}`
    },
    value: (unit, v) => {
      switch (unit) {
        case 'moves/h':
          return f.movesPerHour(v)
        case 's':
          return f.seconds(v)
        case 'pct':
          return f.percent(v)
        case 'ratio':
          return f.number(v, 2)
        case 'm':
          return f.length(v)
        default:
          return f.number(v, 0)
      }
    },
  }
})

const timeLabel = (s: number) => chartFormat.value.time(s)

// ---------------------------------------------------------------------- charts

const elements = new Map<string, HTMLElement>()
const instances = new Map<string, Instance>()
const zooms = new Map<string, { start: number; end: number }>()

function setEl(key: string, el: unknown): void {
  if (el instanceof HTMLElement) elements.set(key, el)
  else elements.delete(key)
}

const options = computed(() => {
  const out = new Map<string, EChartsCoreOption>()
  if (!data.value) return out
  const f = chartFormat.value
  for (const c of charts.value) out.set(`kpi:${c.kpiId}`, lineChartOption(c, f))
  if (showYard.value && heatmap.value && heatmap.value.blocks.length > 0) out.set('heatmap', heatmapOption(heatmap.value, f))
  if (showGantt.value && gantt.value && gantt.value.rows.length > 0) out.set('gantt', ganttOption(gantt.value, f))
  return out
})

function applyCharts(): void {
  const l = lib.value
  if (!l || store.dashboardTab !== 'charts') return
  for (const [key, inst] of instances) {
    if (!options.value.has(key) || !elements.has(key) || inst.getDom() !== elements.get(key)) {
      inst.dispose()
      instances.delete(key)
      zooms.delete(key)
    }
  }
  for (const [key, option] of options.value) {
    const el = elements.get(key)
    if (!el) continue
    let inst = instances.get(key)
    if (!inst) {
      inst = markRaw(l.echarts.init(el, undefined, { renderer: 'canvas' }))
      inst.on('datazoom', () => {
        const dz = (inst!.getOption() as { dataZoom?: { start: number; end: number }[] }).dataZoom?.[0]
        if (dz) zooms.set(key, { start: dz.start, end: dz.end })
        publish()
      })
      instances.set(key, inst)
    }
    inst.setOption(option)
  }
  publish()
}

function publish(): void {
  const rendered: DashboardRendered = {
    chartLibLoaded: !!lib.value,
    charts: charts.value.map((c) => ({
      kpiId: c.kpiId,
      lines: c.lines.map((x) => x.entity),
      points: c.x.length,
      zoom: zooms.get(`kpi:${c.kpiId}`) ?? null,
      drawn: instances.has(`kpi:${c.kpiId}`),
    })),
    heatmap:
      showYard.value && heatmap.value
        ? {
            blocks: heatmap.value.blocks,
            hours: heatmap.value.hours,
            values: heatmap.value.values,
            liveFill: Object.fromEntries(liveFill.value.map((y) => [y.id, y.fillPct])),
          }
        : null,
    landside: showLandside.value ? landsideRows.value.map((r) => ({ id: r.id, value: r.value, unit: r.unit })) : null,
    gantt:
      showGantt.value && gantt.value
        ? {
            rows: gantt.value.rows.map((r) => r.id),
            bars: gantt.value.bars.map((b) => ({
              row: gantt.value!.rows[b.row].id,
              phase: b.phase,
              startS: b.startS,
              endS: b.endS,
            })),
          }
        : null,
  }
  store.dashboardRendered = markRaw(rendered)
}

watch([options, lib, () => store.dashboardTab], () => void nextTick(applyCharts), { flush: 'post', immediate: true })

let observer: ResizeObserver | null = null
const root = ref<HTMLElement | null>(null)
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  observer = new ResizeObserver(() => instances.forEach((i) => i.resize()))
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  instances.forEach((i) => i.dispose())
  instances.clear()
  store.dashboardRendered = null
})

// ----------------------------------------------------------------- table views

function totalOf(kpiId: string, entity: string): string {
  const s = data.value?.series.series[kpiId]
  const v = s?.entities[entity]?.total ?? null
  return v === null || !s ? t('unit.none') : chartFormat.value.value(s.unit, v)
}

const PHASES = Object.keys(PHASE_COLOURS) as TimelinePhase[]
const ganttTable = computed(() =>
  (gantt.value?.bars ?? []).map((b) => ({
    row: gantt.value!.rows[b.row].label,
    phase: t(phaseLabelKey(b.phase)),
    from: timeLabel(b.startS),
    to: timeLabel(b.endS),
  })),
)

const tabs: ('charts' | 'report')[] = ['charts', 'report']
</script>

<template>
  <section
    ref="root"
    class="dashboard"
    data-testid="tt-dashboard"
    :aria-label="t('dashboard.title')"
  >
    <header class="head">
      <h2>{{ t('dashboard.title') }}</h2>
      <div
        class="seg"
        role="tablist"
        :aria-label="t('dashboard.tabs')"
      >
        <button
          v-for="tab in tabs"
          :key="tab"
          role="tab"
          class="seg-btn"
          :class="{ active: store.dashboardTab === tab }"
          :aria-selected="store.dashboardTab === tab"
          :data-testid="`tt-dashboard-tab-${tab}`"
          @click="store.setDashboardTab(tab)"
        >
          {{ t(`dashboard.tab.${tab}`) }}
        </button>
      </div>
      <span class="hint">{{ t('dashboard.hint') }}</span>
      <button
        class="close"
        :aria-label="t('dashboard.close')"
        data-testid="tt-dashboard-close"
        @click="store.toggleDashboard()"
      >
        ✕
      </button>
    </header>

    <div
      v-if="store.dashboardTab === 'report'"
      class="body"
      data-testid="tt-dashboard-report"
    >
      <FinalReport
        v-if="store.runEnded"
        embedded
      />
      <p
        v-else
        class="muted"
      >
        {{ t('dashboard.reportPending') }}
      </p>
    </div>

    <div
      v-else
      class="body"
      data-testid="tt-dashboard-charts"
    >
      <div class="controls">
        <div
          class="seg"
          role="tablist"
          :aria-label="t('dashboard.groups')"
        >
          <button
            v-for="g in groups"
            :key="g"
            role="tab"
            class="seg-btn"
            :class="{ active: group === g }"
            :aria-selected="group === g"
            :data-testid="`tt-dashboard-group-${g}`"
            @click="store.dashboardGroup = g"
          >
            {{ t(`dashboard.group.${g}`) }}
          </button>
        </div>
        <div
          class="seg"
          role="group"
          :aria-label="t('dashboard.bucketing')"
        >
          <button
            v-for="b in BUCKETS"
            :key="b"
            class="seg-btn"
            :class="{ active: bucketing === b }"
            :aria-pressed="bucketing === b"
            :data-testid="`tt-dashboard-bucket-${b}`"
            @click="store.dashboardBucketing = b"
          >
            {{ t(`dashboard.bucket.${b}`) }}
          </button>
        </div>
        <span class="muted">{{ t('dashboard.zoomHint') }}</span>
      </div>

      <p
        v-if="libError"
        class="muted"
        role="alert"
      >
        {{ t('dashboard.loadFailed', { error: libError }) }}
      </p>
      <p
        v-else-if="!lib || !data"
        class="muted"
        role="status"
      >
        {{ t('dashboard.loadingCharts') }}
      </p>
      <p
        v-else-if="groups.length === 0"
        class="muted"
      >
        {{ t('dashboard.noData') }}
      </p>

      <template v-if="data">
        <section
          v-if="showGantt"
          class="panel wide"
          data-testid="tt-dashboard-gantt"
        >
          <h3>{{ t('dashboard.gantt.title') }}</h3>
          <p
            v-if="!gantt || gantt.rows.length === 0"
            class="muted"
          >
            {{ t('dashboard.gantt.none') }}
          </p>
          <template v-else>
            <ul
              class="legend"
              data-testid="tt-gantt-legend"
            >
              <li
                v-for="p in PHASES"
                :key="p"
              >
                <span
                  class="swatch"
                  :class="`pattern-${p}`"
                  :style="{ background: PHASE_COLOURS[p] }"
                />
                {{ t(phaseLabelKey(p)) }}
              </li>
            </ul>
            <div
              :ref="(el) => setEl('gantt', el)"
              class="chart gantt"
              :style="{ height: `${Math.max(180, gantt.rows.length * 34 + 110)}px` }"
              role="img"
              :aria-label="t('dashboard.gantt.title')"
            />
            <details class="table-view">
              <summary>{{ t('dashboard.tableView') }}</summary>
              <table>
                <thead>
                  <tr>
                    <th>{{ t('dashboard.gantt.table.row') }}</th>
                    <th>{{ t('dashboard.gantt.table.phase') }}</th>
                    <th>{{ t('dashboard.gantt.table.from') }}</th>
                    <th>{{ t('dashboard.gantt.table.to') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(r, i) in ganttTable"
                    :key="i"
                  >
                    <th scope="row">
                      {{ r.row }}
                    </th>
                    <td>{{ r.phase }}</td>
                    <td>{{ r.from }}</td>
                    <td>{{ r.to }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </template>
        </section>

        <section
          v-if="showYard"
          class="panel wide"
          data-testid="tt-dashboard-heatmap"
        >
          <h3>{{ t('dashboard.yard.title') }}</h3>
          <p
            v-if="!heatmap || heatmap.blocks.length === 0"
            class="muted"
          >
            {{ t('dashboard.yard.none') }}
          </p>
          <template v-else>
            <ul
              class="fill-list"
              data-testid="tt-yard-fill"
            >
              <li
                v-for="y in liveFill"
                :key="y.id"
                :data-block="y.id"
              >
                <span
                  class="swatch"
                  :style="{ background: SEQUENTIAL_BLUE[Math.min(SEQUENTIAL_BLUE.length - 1, Math.floor((y.fillPct / 100) * SEQUENTIAL_BLUE.length))] }"
                />
                <strong>{{ y.id }}</strong>
                {{ t('dashboard.yard.now') }}: {{ chartFormat.value('pct', y.fillPct) }}
              </li>
            </ul>
            <div
              :ref="(el) => setEl('heatmap', el)"
              class="chart heat"
              :style="{ height: `${Math.max(200, heatmap.blocks.length * 40 + 110)}px` }"
              role="img"
              :aria-label="t('dashboard.yard.title')"
            />
          </template>
        </section>

        <section
          v-if="showLandside && landsideRows.length > 0"
          class="panel wide"
          data-testid="tt-dashboard-landside"
        >
          <h3>{{ t('dashboard.landside.title') }}</h3>
          <table>
            <tbody>
              <tr
                v-for="r in landsideRows"
                :key="r.id"
                :data-metric="r.id"
              >
                <th scope="row">
                  {{ t(landsideLabelKey(r.id)) }}
                </th>
                <td>{{ chartFormat.value(r.unit, r.value) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div class="grid">
          <section
            v-for="c in charts"
            :key="c.kpiId"
            class="panel"
            :data-testid="`tt-chart-${c.kpiId}`"
          >
            <h3>{{ t(kpiLabelKey(c.kpiId)) }}</h3>
            <div
              :ref="(el) => setEl(`kpi:${c.kpiId}`, el)"
              class="chart"
              role="img"
              :aria-label="t('dashboard.chartLabel', { kpi: t(kpiLabelKey(c.kpiId)) })"
            />
            <p
              v-if="c.hiddenEntities > 0"
              class="muted"
            >
              {{ t('dashboard.hiddenEntities', { count: c.hiddenEntities }) }}
            </p>
            <details class="table-view">
              <summary>{{ t('dashboard.tableView') }}</summary>
              <table>
                <thead>
                  <tr>
                    <th>{{ t('dashboard.table.entity') }}</th>
                    <th>{{ t('dashboard.table.total') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(line, i) in c.lines"
                    :key="line.entity"
                  >
                    <th scope="row">
                      <span
                        class="swatch"
                        :style="{ background: seriesStyle(i).colour }"
                      />
                      {{ line.entity }}
                    </th>
                    <td>{{ totalOf(c.kpiId, line.entity) }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </section>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.dashboard {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

h2 {
  font-size: 1.1rem;
}

h3 {
  margin-bottom: 0.4rem;
  font-size: 0.8rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.hint,
.muted {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.hint {
  margin-left: auto;
}

.close {
  padding: 0.15rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
}

.close:hover {
  background: var(--color-bg-card-hover);
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.8rem 1rem 1.2rem;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.8rem;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.seg-btn {
  padding: 0.3rem 0.8rem;
  border: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}

.seg-btn:last-child {
  border-right: 0;
}

.seg-btn:hover {
  background: var(--color-bg-card-hover);
  color: var(--color-text);
}

.seg-btn.active {
  background: var(--color-primary);
  color: #fff;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 28rem), 1fr));
  gap: 0.9rem;
}

.panel {
  padding: 0.7rem 0.8rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: #1a1a19;
  min-width: 0;
}

.panel.wide {
  margin-bottom: 0.9rem;
}

.chart {
  width: 100%;
  height: 300px;
}

.legend,
.fill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin-bottom: 0.4rem;
  list-style: none;
  padding: 0;
  font-size: 0.82rem;
}

.swatch {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  margin-right: 0.3rem;
  border-radius: 2px;
  vertical-align: -0.1rem;
}

/* Gantt legend swatches carry the same texture as the bars (state is never colour alone) */
.pattern-anchorage {
  background-image: repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.4) 0 2px, transparent 2px 5px);
}

.pattern-mooring {
  background-image: radial-gradient(rgba(0, 0, 0, 0.4) 1.2px, transparent 1.4px);
  background-size: 5px 5px;
}

.pattern-unmooring {
  background-image: repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.4) 0 2px, transparent 2px 5px);
}

.pattern-package {
  background-image: linear-gradient(90deg, rgba(0, 0, 0, 0.4) 0 2px, transparent 2px 5px);
}

.table-view {
  margin-top: 0.4rem;
  font-size: 0.8rem;
}

.table-view summary {
  cursor: pointer;
  color: var(--color-text-muted);
}

table {
  width: 100%;
  margin-top: 0.3rem;
  border-collapse: collapse;
}

th,
td {
  padding: 0.15rem 0.4rem;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  font-weight: 400;
}
</style>
