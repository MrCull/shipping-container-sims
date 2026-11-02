<script setup lang="ts">
import TtIcon from './ui/TtIcon.vue'
/**
 * Bay viewer popup (spec #106, #115): one bay of a vessel at a time as hold and deck cross-sections (row x tier),
 * prev/next buttons and a bay strip, a hover tooltip with the box's properties and a side list of the bay's work
 * packages. All the grouping and status logic is the pure view-model in `modules/bayView.ts`; this only draws it.
 * A Load plan | Discharge plan switch (#162) shows one plan at a time (the store keeps the choice for the run).
 * Refreshes a few times a second while open (never per frame).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BAY_PLANS, buildBayView, type BayCell, type BayView, type CellStatus } from '../modules/bayView'
import { useTwinStore } from '../store/twinStore'
import { t, type MessageKey } from '../i18n/messages'
import { colourKeyLabel } from '../modules/colourLabels'

const store = useTwinStore()

const REFRESH_MS = 1000
/** Widest one panel's cross-section may get (px; two panels sit side by side); a cell is as large as fits, up to MAX_CELL_PX. */
const SECTION_WIDTH_PX = 210
const MAX_CELL_PX = 24

let timer: ReturnType<typeof setInterval> | null = null

const vesselName = computed(() => store.config?.vessels.find((v) => v.id === store.bayViewerVesselId)?.name ?? store.bayViewerVesselId ?? '')

const view = computed<BayView | null>(() => {
  const data = store.bayViewData
  if (!data) return null
  const locate = (id: string): string => store.locations.vesselSlot(id)?.notation ?? id
  try {
    return buildBayView(data, store.bayViewerBay, { colourMode: store.colourBy, locate, robDisplay: store.robDisplay, plan: store.bayPlan })
  } catch {
    return null
  }
})

const pad2 = (n: number): string => String(n).padStart(2, '0')
const cellPx = computed(() => {
  const rows = view.value?.sections[0].rowNumbers.length ?? 8
  return Math.max(8,Math.min(MAX_CELL_PX, Math.floor((SECTION_WIDTH_PX - 2 * (rows - 1)) / rows)))
})

function cellClass(c: BayCell): string[] {
  const out = [`st-${c.status}`]
  if (c.colour !== null) out.push('coloured')
  return out
}

/** The property modes fill a cell with the colour the 3D view uses for that value (the state shows in marks over it). */
const cellStyle = (c: BayCell): { backgroundColor: string } | undefined => (c.colour === null ? undefined : { backgroundColor: c.colour })

/** `default` shows the state of each cell; every other mode is the Colour by menu's. */
const stateMode = computed(() => store.colourBy === 'default')

/** A done cell reads "Loaded" in the load plan and "Discharged" in the discharge plan. */
const statusText = (s: CellStatus): string => t((s === 'done' ? `bayViewer.status.done.${store.bayPlan}` : `bayViewer.status.${s}`) as MessageKey)
const stripTitle = (e: BayView['strip'][number]): string =>
  `${t('bayViewer.stripBay', { bay: pad2(e.number), state: t(`bayViewer.stripState.${e.state}` as MessageKey) })}${e.total > 0 ? ` · ${t('bayViewer.stripProgress', { done: e.done, total: e.total })}` : ''}`

function legendText(key: string): string {
  return stateMode.value ? statusText(key as CellStatus) : colourKeyLabel(store.colourBy, key)
}

/** Hover: the cell under the pointer and where to draw its tooltip (client coordinates). */
const hovered = ref<{ cell: BayCell; x: number; y: number } | null>(null)
function hover(cell: BayCell, e: MouseEvent): void {
  hovered.value = { cell, x: e.clientX, y: e.clientY }
}

const tipRows = computed(() => {
  const h = hovered.value
  if (!h) return []
  const d = h.cell.details
  const rows: { label: string; value: string }[] = [
    { label: t('bayViewer.tip.location'), value: d.location },
    { label: t('bayViewer.tip.status'), value: statusText(d.status) },
  ]
  if (d.boxId) rows.push({ label: t('bayViewer.tip.container'), value: d.boxId })
  if (d.size) rows.push({ label: t('inspector.fact.size'), value: d.size })
  if (d.isoType) rows.push({ label: t('inspector.fact.isoType'), value: d.isoType })
  if (d.line) rows.push({ label: t('inspector.fact.line'), value: d.line })
  if (d.direction) rows.push({ label: t('inspector.fact.direction'), value: t(`inspector.direction.${d.direction}` as MessageKey) })
  if (d.pol) rows.push({ label: t('inspector.fact.pol'), value: d.pol })
  if (d.pod) rows.push({ label: t('inspector.fact.pod'), value: d.pod })
  if (d.grossKg !== undefined) rows.push({ label: t('inspector.fact.grossWeight'), value: t('inspector.kg', { n: store.fmt.number(d.grossKg, 0) }) })
  if (d.weightClass) rows.push({ label: t('inspector.fact.weightClass'), value: t(`inspector.weightClass.${d.weightClass}` as MessageKey) })
  if (d.full !== undefined) rows.push({ label: t('inspector.fact.load'), value: t(`inspector.load.${d.full ? 'full' : 'empty'}` as MessageKey) })
  if (d.emptyFor) rows.push({ label: t('bayViewer.tip.emptyFor'), value: [d.emptyFor.isoType ?? d.emptyFor.size, d.emptyFor.line].join(' · ') })
  return rows
})

const tipStyle = computed(() => {
  const h = hovered.value
  if (!h) return {}
  const x = Math.min(h.x + 14, window.innerWidth - 250)
  const y = Math.min(h.y + 14, window.innerHeight - 260)
  return { left: `${x}px`, top: `${y}px` }
})

function go(bay: number | null): void {
  if (bay !== null) store.setBayViewerBay(bay)
}

onMounted(() => {
  timer = setInterval(() => {
    if (store.bayViewerVesselId && !store.busy) void store.refreshBayView()
  }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section
    class="bay-viewer"
    data-testid="tt-bay-viewer"
    role="dialog"
    :aria-label="t('bayViewer.title')"
    @mouseleave="hovered = null"
  >
    <header class="head">
      <h2 data-testid="tt-bay-heading">
        {{ view ? t('bayViewer.heading', { vessel: vesselName, bay: pad2(view.bayNumber) }) : t('bayViewer.title') }}
      </h2>
      <button
        type="button"
        class="icon-btn"
        data-testid="tt-bay-close"
        :title="t('bayViewer.close')"
        :aria-label="t('bayViewer.close')"
        @click="store.closeBayViewer()"
      >
        <TtIcon name="close" />
      </button>
    </header>

    <p
      v-if="!view"
      class="muted"
    >
      {{ t('bayViewer.noVessel') }}
    </p>

    <template v-else>
      <div class="nav">
        <button
          type="button"
          class="btn"
          data-testid="tt-bay-prev"
          :disabled="view.prev === null"
          :title="t('bayViewer.prev')"
          :aria-label="t('bayViewer.prev')"
          @click="go(view.prev)"
        >
          <TtIcon name="prev" /> {{ t('bayViewer.prevShort') }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="tt-bay-next"
          :disabled="view.next === null"
          :title="t('bayViewer.next')"
          :aria-label="t('bayViewer.next')"
          @click="go(view.next)"
        >
          {{ t('bayViewer.nextShort') }} <TtIcon name="next" />
        </button>
        <div
          class="seg"
          role="radiogroup"
          data-testid="tt-bay-plan"
          :data-plan="store.bayPlan"
          :aria-label="t('bayViewer.plan')"
        >
          <button
            v-for="p in BAY_PLANS"
            :key="p"
            type="button"
            role="radio"
            class="seg-btn"
            :class="{ active: store.bayPlan === p }"
            :aria-checked="store.bayPlan === p"
            :data-testid="`tt-bay-plan-${p}`"
            @click="store.setBayPlan(p)"
          >
            {{ t(`bayViewer.plan.${p}` as MessageKey) }}
          </button>
        </div>
        <p
          class="mode-note"
          data-testid="tt-bay-colour-mode"
          :title="t('bayViewer.colourFromMenu')"
        >
          {{ t('bayViewer.colourBy') }}: {{ stateMode ? t('bayViewer.mode.status') : t(`colourBy.mode.${store.colourBy}` as MessageKey) }}
        </p>
      </div>

      <ol
        class="strip"
        data-testid="tt-bay-strip"
        :aria-label="t('bayViewer.strip')"
      >
        <li
          v-for="e in view.strip"
          :key="e.bay"
        >
          <button
            type="button"
            class="strip-bay"
            :class="[`state-${e.state}`, { current: e.bay === view.bay }]"
            :data-testid="`tt-bay-strip-${e.bay}`"
            :data-state="e.state"
            :aria-current="e.bay === view.bay ? 'true' : undefined"
            :title="stripTitle(e)"
            @click="go(e.bay)"
          >
            <span class="strip-no">{{ pad2(e.number) }}</span>
            <span
              class="strip-bar"
              :style="{ '--done': e.total > 0 ? `${Math.round((100 * e.done) / e.total)}%` : '0%' }"
            />
          </button>
        </li>
      </ol>

      <div class="body">
        <div class="plan">
          <p
            v-if="view.rob"
            class="rob-note"
            data-testid="tt-bay-rob-note"
          >
            {{ t('bayViewer.robBay') }}
          </p>
          <div class="panels">
            <div
              v-for="(panel, pi) in view.panels"
              :key="panel.half"
              class="panel"
              :class="{ second: pi > 0 }"
              :data-testid="`tt-bay-panel-${panel.half}`"
              :data-bay-number="panel.bayNumber"
            >
              <h3
                class="panel-title"
                data-testid="tt-bay-panel-title"
              >
                {{ t('bayViewer.panelBay', { bay: pad2(panel.bayNumber) }) }}
              </h3>
              <template
                v-for="(section, si) in panel.sections"
                :key="section.deck ? 'deck' : 'hold'"
              >
                <h3 class="section-title">
                  {{ section.deck ? t('bayViewer.deck') : t('bayViewer.hold') }}
                </h3>
                <div
                  class="section"
                  :data-testid="section.deck ? 'tt-bay-deck' : 'tt-bay-hold'"
                  :style="{ '--cols': section.rowNumbers.length, '--cell': `${cellPx}px` }"
                >
                  <div
                    v-if="si === 0"
                    class="axis"
                    :aria-label="t('bayViewer.rowsAxis')"
                  >
                    <span
                      v-if="pi === 0"
                      class="tier-no"
                    />
                    <span
                      v-for="(n, i) in section.rowNumbers"
                      :key="i"
                      class="row-no"
                    >{{ pad2(n) }}</span>
                  </div>
                  <div
                    v-for="tier in section.tiers"
                    :key="tier.tier"
                    class="tier"
                  >
                    <span
                      v-if="pi === 0"
                      class="tier-no"
                    >{{ pad2(tier.number) }}</span>
                    <div
                      v-for="(c, ci) in tier.cells"
                      :key="ci"
                      class="pos"
                    >
                      <span
                        v-if="c.absent"
                        class="cell absent"
                        data-testid="tt-bay-absent"
                        aria-hidden="true"
                      />
                      <span
                        v-else
                        class="cell"
                        :class="cellClass(c)"
                        :style="cellStyle(c)"
                        data-testid="tt-bay-cell"
                        :data-slot="c.slotId"
                        :data-status="c.status"
                        :data-key="c.colourKey ?? ''"
                        :data-continuation="c.continuation ? 'true' : undefined"
                        :data-rob="c.rob ? 'true' : undefined"
                        @mouseenter="hover(c, $event)"
                        @mousemove="hover(c, $event)"
                      >{{ c.continuation ? t('bayViewer.continuation') : '' }}</span>
                    </div>
                  </div>
                </div>
                <div
                  v-if="si === 0"
                  class="hatch-line"
                  aria-hidden="true"
                />
              </template>
            </div>
          </div>
        </div>

        <aside class="side">
          <h3 class="section-title">
            {{ t('bayViewer.packages') }}
          </h3>
          <p
            v-if="view.packages.length === 0"
            class="muted"
          >
            {{ t('bayViewer.noPackages') }}
          </p>
          <ul
            v-else
            class="packages"
            data-testid="tt-bay-packages"
          >
            <li
              v-for="p in view.packages"
              :key="p.id"
              class="pkg"
              :data-package="p.id"
              :data-status="p.status"
            >
              <div class="pkg-head">
                <span class="pkg-kind">{{ t('bayViewer.pkgLine', { kind: t(`bayViewer.pkg.${p.kind}` as MessageKey), section: p.section === 'deck' ? t('bayViewer.deck') : t('bayViewer.hold') }) }}</span>
                <span
                  class="badge"
                  :class="`badge-${p.status}`"
                >{{ t(`bayViewer.pkgState.${p.status}` as MessageKey) }}</span>
              </div>
              <div class="pkg-meta">
                <span>{{ t('bayViewer.pkgSts', { sts: p.stsId }) }}</span>
                <span v-if="p.total !== null">{{ t('bayViewer.progress', { done: p.done ?? 0, total: p.total }) }}</span>
              </div>
              <div
                v-if="p.total"
                class="pkg-bar"
                :style="{ '--done': `${Math.round((100 * (p.done ?? 0)) / p.total)}%` }"
              />
            </li>
          </ul>

          <h3 class="section-title">
            {{ t('bayViewer.legend') }}
          </h3>
          <ul
            class="legend"
            data-testid="tt-bay-legend"
          >
            <li
              v-for="l in view.legend"
              :key="l.key"
            >
              <span
                class="cell swatch"
                :class="[l.index === null ? `st-${l.key}` : 'st-planned-discharge']"
                :style="l.hex ? { backgroundColor: l.hex } : undefined"
              />
              <span>{{ legendText(l.key) }}</span>
              <span
                v-if="stateMode"
                class="count"
              >{{ view.counts[l.key as CellStatus] }}</span>
            </li>
          </ul>
        </aside>
      </div>
    </template>

    <div
      v-if="hovered"
      class="tip"
      data-testid="tt-bay-tooltip"
      :style="tipStyle"
    >
      <dl>
        <template
          v-for="r in tipRows"
          :key="r.label"
        >
          <dt>{{ r.label }}</dt>
          <dd>{{ r.value }}</dd>
        </template>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.bay-viewer {
  --bv-planned-discharge: var(--tt-data-discharge);
  --bv-planned-load: var(--tt-data-load);
  --bv-in-progress: var(--tt-data-active);
  --bv-done: var(--tt-data-done);
  --bv-rob: var(--tt-data-rob);
  position: absolute;
  top: 3.6rem;
  left: 0.9rem;
  z-index: 8;
  width: min(46rem, calc(100% - 1.8rem));
  max-height: calc(100% - 8.2rem);
  overflow-y: auto;
  padding: 0.7rem 0.85rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--tt-border);
  background: var(--tt-panel-strong);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  color: var(--tt-text);
  font-size: 0.8rem;
  box-shadow: var(--tt-shadow);
  pointer-events: auto;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

h2 {
  font-size: 0.95rem;
  font-weight: 700;
}

.icon-btn {
  border: 1px solid var(--tt-border);
  background: transparent;
  color: var(--tt-text-muted);
  border-radius: 6px;
  width: 1.7rem;
  height: 1.7rem;
  line-height: 1;
}

.icon-btn:hover {
  color: var(--tt-text);
  background: var(--tt-surface-hover);
}

.muted {
  color: var(--tt-text-muted);
}

.nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.btn {
  border: 1px solid var(--tt-border);
  background: var(--tt-surface);
  color: var(--tt-text);
  border-radius: 6px;
  padding: 0.25rem 0.6rem;
  font-size: 0.78rem;
}

.btn:hover:not(:disabled) {
  background: var(--tt-surface-hover);
}

.btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  overflow: hidden;
}

.seg-btn {
  padding: 0.25rem 0.6rem;
  border: 0;
  border-right: 1px solid var(--tt-border);
  background: var(--tt-surface);
  color: var(--tt-text-muted);
  font: inherit;
  font-size: 0.78rem;
}

.seg-btn:last-child {
  border-right: 0;
}

.seg-btn:hover {
  background: var(--tt-surface-hover);
  color: var(--tt-text);
}

.seg-btn.active {
  background: var(--tt-accent);
  color: var(--tt-on-accent);
}

.mode-note {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--tt-text-muted);
}

.strip {
  list-style: none;
  display: flex;
  gap: 3px;
  margin-bottom: 0.6rem;
  overflow-x: auto;
  padding-bottom: 2px;
}

.strip li {
  flex: 1 0 1.9rem;
  min-width: 1.9rem;
}

.strip-bay {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 3px 2px 2px;
  border: 1px solid var(--tt-border);
  border-radius: 5px;
  background: var(--tt-bg);
  color: var(--tt-text-muted);
  font-size: 0.68rem;
}

.strip-bay.current {
  border-color: var(--tt-accent-hover);
  color: var(--tt-text);
  box-shadow: 0 0 0 1px var(--tt-accent-hover);
}

.strip-no {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.strip-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--tt-border);
  background-image: linear-gradient(to right, var(--bv-in-progress) var(--done), transparent var(--done));
}

.state-rob .strip-bar {
  background-image: repeating-linear-gradient(45deg, var(--bv-rob) 0 3px, transparent 3px 6px);
}

.state-empty {
  opacity: 0.55;
}

.state-complete .strip-bar {
  background: var(--tt-success);
}

.body {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(11rem, 1fr);
  gap: 0.9rem;
  align-items: start;
}

@media (max-width: 760px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.plan {
  min-width: 0;
  overflow-x: auto;
}

.rob-note {
  margin-bottom: 0.4rem;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  border: 1px dashed var(--bv-rob);
  color: var(--tt-text-muted);
  max-width: 28rem;
}

.panels {
  display: flex;
  gap: 0.5rem;
  width: max-content;
}

.panel-title {
  margin: 0 0 0.1rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--tt-text);
}

.panel.second .tier,
.panel.second .axis {
  grid-template-columns: repeat(var(--cols), var(--cell));
}

/* The second half of a 40 ft box: hatched and labelled so the two panels read as one box. */
.cell[data-continuation='true'] {
  background-image: repeating-linear-gradient(135deg, var(--tt-hatch) 0 2px, transparent 2px 5px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 0.5rem;
  line-height: 1;
  white-space: nowrap;
  color: var(--tt-text);
}

.section-title {
  margin: 0.2rem 0 0.25rem;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--tt-text-muted);
}

.section {
  width: max-content;
  padding: 4px;
  border-radius: 6px;
  background: var(--tt-surface-sunken);
  border: 1px solid var(--tt-border);
}

.axis,
.tier {
  display: grid;
  grid-template-columns: 1.4rem repeat(var(--cols), var(--cell));
  gap: 2px;
  margin-bottom: 2px;
}

.tier-no,
.row-no {
  font-size: 0.6rem;
  line-height: var(--cell);
  color: var(--tt-text-muted);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.axis .row-no {
  line-height: 1.1;
  margin-bottom: 1px;
}

.hatch-line {
  height: 5px;
  margin: 4px 0 0;
  border-radius: 2px;
  background: repeating-linear-gradient(90deg, var(--tt-border-strong) 0 10px, var(--tt-text-muted) 10px 12px);
}

.pos {
  display: flex;
  gap: 1px;
  height: var(--cell);
}

.cell {
  position: relative;
  flex: 1;
  min-width: 0;
  border-radius: 2px;
  border: 1px solid transparent;
  background: var(--tt-surface-sunken);
}

.cell.st-empty {
  border-color: var(--tt-border);
}

/* Outside the hull profile: no cell, so the hold reads as a V (the grid keeps the rows aligned). */
.cell.absent {
  visibility: hidden;
}

/* Fill: by state, or inline by the colour mode (the same colours as the 3D view). */
.cell.st-planned-discharge {
  background: var(--bv-planned-discharge);
}
.cell.st-planned-load {
  background: var(--bv-planned-load);
}
.cell.st-in-progress {
  background: var(--bv-in-progress);
}
.cell.st-done {
  background: var(--bv-done);
}
.cell.st-rob {
  background: var(--bv-rob);
}

/* State marks that survive any fill: outline = planned discharge, dashed = planned load, glow = in progress, faded = done, stripes = ROB. */
.cell.st-planned-discharge {
  border-color: var(--tt-text);
}
.cell.st-planned-load {
  border: 1px dashed var(--tt-text);
}
.cell.st-in-progress {
  border-color: var(--tt-text);
  box-shadow: 0 0 0 2px var(--tt-panel-strong), 0 0 8px 2px var(--bv-in-progress);
  z-index: 1;
  animation: bv-pulse 1s ease-in-out infinite alternate;
}
.cell.st-done {
  opacity: 0.4;
}
.cell.st-rob {
  background-image: repeating-linear-gradient(45deg, var(--tt-hatch) 0 2px, transparent 2px 5px);
}
.cell.st-rob.coloured {
  border-color: var(--tt-border-strong);
}
.cell.st-done::after {
  content: '';
  position: absolute;
  left: 25%;
  top: 15%;
  width: 28%;
  height: 48%;
  border: solid var(--tt-text);
  border-width: 0 2px 2px 0;
  transform: rotate(40deg);
}

@keyframes bv-pulse {
  to {
    box-shadow: 0 0 0 2px var(--tt-focus), 0 0 3px 1px var(--bv-in-progress);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cell.st-in-progress {
    animation: none;
  }
}

.side {
  min-width: 0;
}

.packages,
.legend {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.7rem;
}

.pkg {
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--tt-border);
  background: var(--tt-bg);
}

.pkg-head,
.pkg-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.pkg-kind {
  font-weight: 600;
}

.pkg-meta {
  margin-top: 0.15rem;
  color: var(--tt-text-muted);
  font-size: 0.72rem;
}

.pkg-bar {
  height: 3px;
  margin-top: 0.3rem;
  border-radius: 2px;
  background: var(--tt-border) linear-gradient(to right, var(--bv-in-progress) var(--done), transparent var(--done));
}

.badge {
  padding: 0 0.4rem;
  border-radius: 999px;
  font-size: 0.68rem;
  border: 1px solid var(--tt-border);
  color: var(--tt-text-muted);
}

.badge-active {
  color: var(--tt-success);
  background: var(--tt-success-bg);
  border-color: var(--tt-success-border);
  font-weight: 600;
}

.badge-released {
  color: var(--tt-accent);
  border-color: var(--tt-accent);
}

.badge-complete {
  color: var(--tt-success);
  border-color: var(--tt-success);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.swatch {
  flex: 0 0 14px;
  height: 14px;
}

.legend .count {
  margin-left: auto;
  color: var(--tt-text-muted);
  font-variant-numeric: tabular-nums;
}

.tip {
  position: fixed;
  z-index: 20;
  min-width: 11rem;
  max-width: 16rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--tt-border);
  background: var(--tt-panel-strong);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  box-shadow: var(--tt-shadow);
  pointer-events: none;
  font-size: 0.74rem;
}

.tip dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.1rem 0.6rem;
}

.tip dt {
  color: var(--tt-text-muted);
}

.tip dd {
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}
</style>
