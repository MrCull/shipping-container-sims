<script setup lang="ts">
/**
 * Crane plan view (#288): the whole vessel's plan, bays across in quay order, time down, one band per crane, the
 * actual progress over the plan, a now line and the predicted conflicts. All the geometry is the pure model in
 * `modules/cranePlanView.ts`; this only draws it. Every bay column is headed by its crane id (each crane has a stable
 * colour); hover a crane (header, bar or key) to highlight all its packages, click it to pin the highlight and select the
 * crane in the 3D view. Click a package to land on its bay in the Bays view. The key sits right of the chart when the
 * panel is wide enough (a container query), under it otherwise.
 */
import { computed, ref } from 'vue'
import { buildCranePlanModel, type PlanBar } from '../modules/cranePlanView'
import { useTwinStore } from '../store/twinStore'
import { t, type MessageKey } from '../i18n/messages'

const store = useTwinStore()

const COL_PX = 50
const GUTTER_PX = 70
const MAX_HEIGHT_PX = 640
const MIN_HEIGHT_PX = 160
/** A bar at least this tall (px) shows its move count. */
const LABEL_MIN_PX = 13

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
const colourOf = (sts: string): number | undefined => model.value?.bands.find((b) => b.stsId === sts)?.colour

/** Highlight: the crane under the pointer, or the one pinned by a click (the pin wins while the pointer is away). */
const hoverSts = ref<string | null>(null)
const pinnedSts = ref<string | null>(null)
const lit = computed(() => hoverSts.value ?? pinnedSts.value)
const dim = (sts: string): boolean => lit.value !== null && lit.value !== sts

function pin(sts: string): void {
  const same = pinnedSts.value === sts
  pinnedSts.value = same ? null : sts
  if (!same) store.select(sts) // the crane in the 3D view and the inspector
}

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

const conflictTitle = (c: { stsA: string; stsB: string; obstacle: boolean; fromS: number; toS: number }): string =>
  t(c.obstacle ? 'cranePlan.conflictObstacle' : 'cranePlan.conflict', { a: c.stsA, b: c.stsB, from: dur(c.fromS), to: dur(c.toS) })

/** The key's mark entries: one per mark, drawn with the same classes as the chart. */
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
]

/** A bay range as text: "18 to 12". */
function bayRangeText(nums: number[]): string {
  if (nums.length === 0) return ''
  const a = pad2(nums[0])
  const b = pad2(nums[nums.length - 1])
  return a === b ? a : t('cranePlan.key.bays', { from: a, to: b })
}
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
      <div class="layout">
        <div class="scroll">
          <div
            class="chart"
            :style="{ width: `${widthPx}px` }"
          >
            <div
              class="head-row"
              :aria-label="t('cranePlan.bayAxis')"
            >
              <button
                v-for="(c, i) in model.columns"
                :key="c.bay"
                type="button"
                class="col-head"
                :class="[`crane-${colourOf(c.stsId)}`, { dim: dim(c.stsId), pinned: pinnedSts === c.stsId }]"
                :data-testid="`tt-crane-plan-col-${c.number}`"
                :data-sts="c.stsId"
                :style="{ left: `${GUTTER_PX + i * COL_PX}px`, width: `${COL_PX}px` }"
                :title="t('cranePlan.colTip', { sts: c.stsId, bay: pad2(c.number) })"
                @mouseenter="hoverSts = c.stsId"
                @mouseleave="hoverSts = null"
                @click="pin(c.stsId)"
              >
                <span class="col-sts">{{ c.stsId }}</span>
                <span class="col-bay">{{ pad2(c.number) }}</span>
              </button>
            </div>
            <div
              class="body"
              :style="{ height: `${heightPx}px` }"
              :aria-label="t('cranePlan.timeAxis')"
            >
              <template
                v-for="s in model.ticks"
                :key="s"
              >
                <span
                  class="grid"
                  :style="{ top: `${y(s)}px`, left: `${GUTTER_PX}px`, width: `${model.columns.length * COL_PX}px` }"
                />
                <span
                  class="tick"
                  :style="{ top: `${y(s)}px` }"
                >{{ dur(s) }}</span>
              </template>
              <div
                v-for="b in model.bands"
                :key="b.stsId"
                class="band"
                :class="[`crane-${b.colour}`, { dim: dim(b.stsId) }]"
                :data-testid="`tt-crane-plan-band-${b.stsId}`"
                :style="{ left: `${GUTTER_PX + b.colFrom * COL_PX}px`, width: `${(b.colTo - b.colFrom + 1) * COL_PX}px` }"
              />
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
                  :class="{ dim: dim(b.stsId) }"
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
                  :class="[`kind-${b.kind}`, `status-${b.status}`, `crane-${colourOf(b.stsId)}`, { actual: b.actual, dim: dim(b.stsId), lit: lit === b.stsId }]"
                  :data-testid="`tt-crane-plan-pkg-${b.id}`"
                  :data-kind="b.kind"
                  :data-status="b.status"
                  :data-sts="b.stsId"
                  :title="barTitle(b)"
                  :style="{
                    left: `${GUTTER_PX + b.col * COL_PX + 3}px`,
                    width: `${COL_PX - 6}px`,
                    top: `${y(b.fromS)}px`,
                    height: `${Math.max(3, (b.toS - b.fromS) * scale)}px`,
                  }"
                  @mouseenter="hoverSts = b.stsId"
                  @mouseleave="hoverSts = null"
                  @click="store.showBayFromPlan(b.bay)"
                >
                  <span
                    v-if="(b.toS - b.fromS) * scale >= LABEL_MIN_PX && b.moves > 0"
                    class="moves"
                  >{{ b.moves }}</span>
                </button>
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
                <span>{{ t('cranePlan.now') }} {{ dur(model.nowS) }}</span>
              </div>
            </div>
          </div>
        </div>
        <aside
          class="key"
          data-testid="tt-crane-plan-key"
        >
          <h4>{{ t('cranePlan.key') }}</h4>
          <h5>{{ t('cranePlan.key.cranes') }}</h5>
          <ul class="cranes">
            <li
              v-for="b in model.bands"
              :key="b.stsId"
            >
              <button
                type="button"
                class="crane-chip"
                :class="[`crane-${b.colour}`, { dim: dim(b.stsId), pinned: pinnedSts === b.stsId }]"
                :data-testid="`tt-crane-plan-key-crane-${b.stsId}`"
                :title="t('cranePlan.chipTip', { sts: b.stsId })"
                @mouseenter="hoverSts = b.stsId"
                @mouseleave="hoverSts = null"
                @click="pin(b.stsId)"
              >
                <span class="dot" />
                <span class="chip-sts">{{ b.stsId }}</span>
                <span class="chip-bays">{{ t('cranePlan.key.baysOf', { bays: bayRangeText(b.bayNumbers) }) }}</span>
              </button>
            </li>
          </ul>
          <h5>{{ t('cranePlan.key.marks') }}</h5>
          <ul>
            <li
              v-for="k in KEY"
              :key="k.id"
              :data-testid="`tt-crane-plan-key-${k.id}`"
            >
              <span
                class="swatch"
                :class="k.swatch"
              />
              <span>{{ t(`cranePlan.key.${k.id}` as MessageKey) }}</span>
            </li>
          </ul>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crane-plan {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  container-type: inline-size;
}
.muted,
.summary {
  margin: 0;
  color: var(--tt-text-muted);
  font-size: 12px;
}
.layout {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
@container (min-width: 640px) {
  .layout {
    flex-direction: row;
    align-items: flex-start;
  }
  .key {
    flex: 0 0 220px;
    border-top: 0;
    border-left: 1px solid var(--tt-border);
    padding: 0 0 0 10px;
  }
  .key ul {
    grid-template-columns: 1fr;
  }
}
.scroll {
  overflow: auto;
  flex: 1 1 auto;
  min-width: 0;
}
.chart {
  position: relative;
}
.head-row {
  position: sticky;
  top: 0;
  z-index: 5;
  height: 34px;
  background: var(--tt-panel-strong);
}
.col-head {
  position: absolute;
  top: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 1px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.15;
  background: color-mix(in srgb, var(--band) 22%, transparent);
  border: 0;
  border-bottom: 2px solid var(--band);
  color: var(--tt-text);
  cursor: pointer;
  font: inherit;
}
.col-head.dim,
.crane-chip.dim {
  opacity: 0.35;
}
.col-head.pinned,
.crane-chip.pinned {
  outline: 2px solid var(--band);
  outline-offset: -2px;
}
.col-sts {
  font-size: 10px;
  font-weight: 600;
  color: var(--band);
}
.col-bay {
  font-size: 11px;
  color: var(--tt-text-muted);
}
.body {
  position: relative;
}
.grid {
  position: absolute;
  height: 0;
  border-top: 1px solid var(--tt-hairline);
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
  background: color-mix(in srgb, var(--band) 12%, transparent);
}
.band.dim {
  background: transparent;
}
.crane-0 { --band: var(--tt-data-0); }
.crane-1 { --band: var(--tt-data-1); }
.crane-2 { --band: var(--tt-data-2); }
.crane-3 { --band: var(--tt-data-3); }
.crane-4 { --band: var(--tt-data-4); }
.crane-5 { --band: var(--tt-data-5); }
.crane-6 { --band: var(--tt-data-6); }
.crane-7 { --band: var(--tt-data-7); }
.bar {
  position: absolute;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--tt-border);
  border-left: 3px solid var(--band, var(--tt-border));
  border-radius: 2px;
  cursor: pointer;
  background: color-mix(in srgb, var(--tt-data-discharge) 35%, transparent);
  opacity: 0.8;
  color: var(--tt-text);
  font: inherit;
  font-size: 10px;
  line-height: 1;
  text-align: center;
}
.bar.actual {
  opacity: 1;
}
.bar.dim {
  opacity: 0.2;
}
.bar.lit {
  box-shadow: 0 0 0 2px var(--band);
  opacity: 1;
  z-index: 2;
}
.bar .moves {
  display: block;
  padding-top: 1px;
  text-shadow: 0 0 2px var(--tt-bg);
}
.bar.status-complete {
  border-color: var(--tt-data-done);
  border-left-color: var(--band, var(--tt-data-done));
}
.bar.status-active {
  border-color: var(--tt-data-active);
  border-left-color: var(--band, var(--tt-data-active));
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
.ghost.dim {
  opacity: 0.25;
}
.conflict {
  position: absolute;
  background: color-mix(in srgb, var(--tt-danger) 35%, transparent);
  border: 1px solid var(--tt-danger);
  z-index: 3;
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
  border-top: 3px solid var(--tt-data-active);
  z-index: 4;
  pointer-events: none;
}
.now span {
  position: absolute;
  left: 0;
  top: -9px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--tt-bg);
  background: var(--tt-data-active);
}

/* key */
.key {
  font-size: 11px;
  color: var(--tt-text-muted);
  border-top: 1px solid var(--tt-border);
  padding-top: 6px;
  min-width: 0;
}
.key h4,
.key h5 {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--tt-text);
}
.key h5 {
  margin-top: 8px;
  font-weight: 500;
  color: var(--tt-text-muted);
}
.key ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
  border-left-width: 1px;
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
  border-top: 3px solid var(--tt-data-active);
}
.crane-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--tt-text);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.crane-chip:hover {
  background: var(--tt-surface-hover);
}
.crane-chip .dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--band);
}
.chip-sts {
  font-weight: 600;
}
.chip-bays {
  color: var(--tt-text-muted);
}
</style>
