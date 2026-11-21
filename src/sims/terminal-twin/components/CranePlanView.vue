<script setup lang="ts">
/**
 * Crane plan view (#288): the whole vessel's plan, bays across in quay order, time down, one band per crane, the
 * actual progress over the plan, a now line and the predicted conflicts. All the geometry is the pure model in
 * `modules/cranePlanView.ts`; this only draws it. Click a package to land on its bay in the Bays view.
 */
import { computed } from 'vue'
import { buildCranePlanModel, type PlanBar } from '../modules/cranePlanView'
import { useTwinStore } from '../store/twinStore'
import { t, type MessageKey } from '../i18n/messages'

const store = useTwinStore()

const COL_PX = 46
const GUTTER_PX = 70
const MAX_HEIGHT_PX = 420
const MIN_HEIGHT_PX = 140

const model = computed(() => {
  const data = store.cranePlanData
  const size = store.config?.vessels.find((v) => v.id === store.bayViewerVesselId)?.sizeClass
  if (!data || !size) return null
  try {
    return buildCranePlanModel(data, size, store.displayTime)
  } catch {
    return null
  }
})

const scale = computed(() => {
  const m = model.value
  if (!m) return 1
  const span = m.t1 - m.t0
  return Math.max(MIN_HEIGHT_PX, Math.min(MAX_HEIGHT_PX, span * 0.5)) / span
})
const heightPx = computed(() => (model.value ? Math.ceil((model.value.t1 - model.value.t0) * scale.value) : 0))
const widthPx = computed(() => GUTTER_PX + (model.value?.columns.length ?? 0) * COL_PX)
const y = (s: number): number => (s - (model.value?.t0 ?? 0)) * scale.value
const pad2 = (n: number): string => String(n).padStart(2, '0')
const dur = (s: number): string => store.fmt.duration(s)

const ticks = computed(() => {
  const m = model.value
  if (!m) return []
  const span = m.t1 - m.t0
  const step = [60, 300, 600, 1800, 3600, 7200, 14400, 21600].find((s) => span / s <= 8) ?? 21600
  const out: number[] = []
  for (let s = Math.ceil(m.t0 / step) * step; s <= m.t1; s += step) out.push(s)
  return out
})

function range(from: number, to: number | null): string {
  return to === null ? t('cranePlan.rangeOpen', { from: dur(from) }) : t('cranePlan.range', { from: dur(from), to: dur(to) })
}

function barTitle(b: PlanBar): string {
  const d = b.details
  const lines = [
    `${t('cranePlan.tip.crane')}: ${d.stsId}`,
    `${t('cranePlan.tip.bay')}: ${pad2(model.value?.columns[b.col].number ?? 0)}`,
    `${t('cranePlan.tip.section')}: ${t(`bayViewer.${d.section}` as MessageKey)}`,
    `${t('cranePlan.tip.kind')}: ${t(`bayViewer.pkg.${d.kind}` as MessageKey)}`,
    `${t('cranePlan.tip.moves')}: ${d.moves}`,
    `${t('cranePlan.tip.state')}: ${t(`bayViewer.pkgState.${d.status}` as MessageKey)}`,
    `${t('cranePlan.tip.planned')}: ${range(d.plannedStartS, d.plannedEndS)}`,
  ]
  if (d.status !== 'complete') lines.push(`${t('cranePlan.tip.predicted')}: ${range(d.predictedStartS, d.predictedEndS)}`)
  if (d.actualStartS !== null) lines.push(`${t('cranePlan.tip.actual')}: ${range(d.actualStartS, d.actualEndS)}`)
  lines.push(t('cranePlan.tip.open'))
  return lines.join('\n')
}

/** The key under the chart: one entry per mark, drawn with the same classes as the chart. */
const KEY: { id: string; swatch: string[] }[] = [
  { id: 'discharge', swatch: ['bar', 'kind-discharge'] },
  { id: 'load', swatch: ['bar', 'kind-load'] },
  { id: 'hatch', swatch: ['bar', 'kind-hatch-remove'] },
  { id: 'actual', swatch: ['bar', 'kind-discharge', 'actual', 'status-complete'] },
  { id: 'active', swatch: ['bar', 'kind-discharge', 'actual', 'status-active'] },
  { id: 'predicted', swatch: ['bar', 'kind-discharge'] },
  { id: 'ghost', swatch: ['ghost'] },
  { id: 'conflict', swatch: ['conflict'] },
  { id: 'obstacle', swatch: ['obstacle'] },
  { id: 'now', swatch: ['now'] },
  { id: 'band', swatch: ['band', 'crane-0'] },
  { id: 'bay', swatch: ['bayno'] },
]

const conflictTitle = (c: { stsA: string; stsB: string; obstacle: boolean; fromS: number; toS: number }): string =>
  t(c.obstacle ? 'cranePlan.conflictObstacle' : 'cranePlan.conflict', { a: c.stsA, b: c.stsB, from: dur(c.fromS), to: dur(c.toS) })
</script>

<template>
  <div
    class="crane-plan"
    data-testid="tt-crane-plan"
  >
    <p
      v-if="!store.cranePlanData"
      class="muted"
      data-testid="tt-crane-plan-empty"
    >
      {{ store.bayViewData ? t('cranePlan.none') : t('cranePlan.loading') }}
    </p>
    <template v-else-if="model">
      <p
        class="summary"
        data-testid="tt-crane-plan-summary"
      >
        {{ t('cranePlan.summary', { strategy: model.strategy, revision: model.revision, windows: model.conflicts.length, seconds: Math.round(model.conflictS) }) }}
      </p>
      <div class="scroll">
        <div
          class="chart"
          :style="{ width: `${widthPx}px` }"
        >
          <div
            class="head-row"
            :aria-label="t('cranePlan.bayAxis')"
          >
            <span
              v-for="(c, i) in model.columns"
              :key="c.bay"
              class="col-head"
              :style="{ left: `${GUTTER_PX + i * COL_PX}px`, width: `${COL_PX}px` }"
            >{{ pad2(c.number) }}</span>
          </div>
          <div
            class="body"
            :style="{ height: `${heightPx}px` }"
            :aria-label="t('cranePlan.timeAxis')"
          >
            <span
              v-for="s in ticks"
              :key="s"
              class="tick"
              :style="{ top: `${y(s)}px` }"
            >{{ dur(s) }}</span>
            <div
              v-for="b in model.bands"
              :key="b.stsId"
              class="band"
              :class="`crane-${b.colour % 6}`"
              :data-testid="`tt-crane-plan-band-${b.stsId}`"
              :style="{ left: `${GUTTER_PX + b.colFrom * COL_PX}px`, width: `${(b.colTo - b.colFrom + 1) * COL_PX}px` }"
            >
              <span class="band-label">{{ b.stsId }}</span>
            </div>
            <div
              v-for="c in model.conflicts"
              :key="`${c.stsA}-${c.stsB}-${c.fromS}`"
              class="conflict"
              data-testid="tt-crane-plan-conflict"
              :title="conflictTitle(c)"
              :style="{
                left: `${GUTTER_PX + (Math.min(c.colA, c.colB) + 0.5) * COL_PX}px`,
                width: `${Math.max(6, Math.abs(c.colB - c.colA) * COL_PX)}px`,
                top: `${y(c.fromS)}px`,
                height: `${Math.max(2, (c.toS - c.fromS) * scale)}px`,
              }"
            />
            <template
              v-for="b in model.bars"
              :key="b.id"
            >
              <div
                v-if="b.ghost"
                class="ghost"
                :style="{
                  left: `${GUTTER_PX + b.col * COL_PX + 1}px`,
                  width: `${COL_PX - 2}px`,
                  top: `${y(b.ghost.fromS)}px`,
                  height: `${Math.max(3, (b.ghost.toS - b.ghost.fromS) * scale)}px`,
                }"
              />
              <button
                type="button"
                class="bar"
                :class="[`kind-${b.kind}`, `status-${b.status}`, { actual: b.actual }]"
                :data-testid="`tt-crane-plan-pkg-${b.id}`"
                :data-kind="b.kind"
                :data-status="b.status"
                :title="barTitle(b)"
                :style="{
                  left: `${GUTTER_PX + b.col * COL_PX + 3}px`,
                  width: `${COL_PX - 6}px`,
                  top: `${y(b.fromS)}px`,
                  height: `${Math.max(3, (b.toS - b.fromS) * scale)}px`,
                }"
                @click="store.showBayFromPlan(b.bay)"
              />
            </template>
            <div
              v-for="o in model.obstacles"
              :key="o.stsId"
              class="obstacle"
              data-testid="tt-crane-plan-obstacle"
              :title="t('cranePlan.obstacle', { sts: o.stsId, vessel: o.vesselId })"
              :style="{ left: `${GUTTER_PX + (o.col + 0.5) * COL_PX}px` }"
            >
              <span>{{ o.stsId }}</span>
            </div>
            <div
              class="now"
              data-testid="tt-crane-plan-now"
              :style="{ top: `${y(model.nowS)}px` }"
            >
              <span>{{ t('cranePlan.now') }}</span>
            </div>
          </div>
        </div>
      </div>
      <details
        class="key"
        open
        data-testid="tt-crane-plan-key"
      >
        <summary>{{ t('cranePlan.key') }}</summary>
        <ul>
          <li
            v-for="k in KEY"
            :key="k.id"
            :data-testid="`tt-crane-plan-key-${k.id}`"
          >
            <span
              class="swatch"
              :class="k.swatch"
            >{{ k.id === 'bay' ? pad2(12) : '' }}</span>
            <span>{{ t(`cranePlan.key.${k.id}` as MessageKey) }}</span>
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>

<style scoped>
.crane-plan {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.muted,
.summary {
  margin: 0;
  color: var(--tt-text-muted);
  font-size: 12px;
}
.scroll {
  overflow: auto;
  max-height: 460px;
}
.chart {
  position: relative;
}
.head-row {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 20px;
  background: var(--tt-panel-strong);
}
.col-head {
  position: absolute;
  top: 0;
  text-align: center;
  font-size: 11px;
  color: var(--tt-text-muted);
}
.body {
  position: relative;
  border-top: 1px solid var(--tt-border);
}
.tick {
  position: absolute;
  left: 0;
  width: 66px;
  white-space: nowrap;
  font-size: 10px;
  color: var(--tt-text-muted);
  transform: translateY(-50%);
}
.band {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--tt-border);
  border-right: 1px solid var(--tt-border);
  background: color-mix(in srgb, var(--band) 14%, transparent);
}
.band-label {
  position: absolute;
  top: 2px;
  left: 3px;
  font-size: 10px;
  color: var(--band);
}
.crane-0 { --band: var(--tt-data-0); }
.crane-1 { --band: var(--tt-data-1); }
.crane-2 { --band: var(--tt-data-2); }
.crane-3 { --band: var(--tt-data-3); }
.crane-4 { --band: var(--tt-data-4); }
.crane-5 { --band: var(--tt-data-5); }
.bar {
  position: absolute;
  padding: 0;
  border: 1px solid var(--tt-border);
  border-radius: 2px;
  cursor: pointer;
  background: color-mix(in srgb, var(--tt-data-discharge) 35%, transparent);
  opacity: 0.8;
}
.bar.actual {
  opacity: 1;
}
.bar.status-complete {
  border-color: var(--tt-data-done);
}
.bar.status-active {
  border-color: var(--tt-data-active);
  box-shadow: 0 0 0 1px var(--tt-data-active);
}
.bar.kind-discharge { background: color-mix(in srgb, var(--tt-data-discharge) 70%, transparent); }
.bar.kind-load { background: color-mix(in srgb, var(--tt-data-load) 70%, transparent); }
.bar.kind-hatch-remove,
.bar.kind-hatch-replace {
  background: repeating-linear-gradient(45deg, var(--tt-data-rob) 0 3px, transparent 3px 6px);
}
.ghost {
  position: absolute;
  border: 1px dashed var(--tt-text-muted);
  border-radius: 2px;
  pointer-events: none;
}
.conflict {
  position: absolute;
  background: color-mix(in srgb, var(--tt-danger) 35%, transparent);
  border: 1px solid var(--tt-danger);
  z-index: 2;
}
.obstacle {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 2px dashed var(--tt-text-muted);
  z-index: 1;
  pointer-events: none;
}
.obstacle span {
  font-size: 10px;
  margin-left: 2px;
  color: var(--tt-text-muted);
}
.now {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 2px solid var(--tt-data-active);
  z-index: 4;
  pointer-events: none;
}
.now span {
  font-size: 10px;
  color: var(--tt-data-active);
}

.key {
  font-size: 11px;
  color: var(--tt-text-muted);
}
.key summary {
  cursor: pointer;
}
.key ul {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 3px 10px;
}
.key li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.key .swatch {
  position: static;
  flex: none;
  display: inline-block;
  width: 22px;
  height: 12px;
  box-sizing: border-box;
}
.key .swatch.bar {
  opacity: 1;
}
.key .swatch.conflict {
  position: static;
}
.key .swatch.obstacle {
  width: 0;
  height: 12px;
  margin: 0 11px;
  border-left: 2px dashed var(--tt-text-muted);
}
.key .swatch.now {
  height: 0;
  margin: 6px 0;
  border-top: 2px solid var(--tt-data-active);
}
.key .swatch.band {
  border: 1px solid var(--tt-border);
}
.key .swatch.bayno {
  font-size: 10px;
  width: auto;
}
</style>
