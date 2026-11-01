<script setup lang="ts">
import TtIcon from '../ui/TtIcon.vue'
/**
 * Editable vessel table (one row per vessel call) plus the "Generate N
 * vessels" helper. Arrivals are shown as local date-times relative to the
 * scenario start; the table stores seconds from the start.
 */
import { computed, reactive, ref } from 'vue'
import { t, type MessageKey } from '../../i18n/messages'
import { makeVesselCall } from '../../scenario/builder'
import type { VesselConfig, VesselSizeClass } from '../../scenario/types'
import { VESSEL_CLASSES, VESSEL_SIZE_CLASSES } from '../../scenario/vesselClasses'
import { DEFAULT_CALL_MOVES, flowMixOf, generateVessels, TTI_FLOW_MIX } from '../../scenario/vesselGenerator'
import { fromLocalInputValue, toLocalInputValue } from '../../modules/time'
import LocaleDateTimeInput from '../LocaleDateTimeInput.vue'

const props = defineProps<{ startDateTime: Date | null }>()
const vessels = defineModel<VesselConfig[]>({ required: true })

const start = computed(() => props.startDateTime ?? new Date(0))

const COUNT_FIELDS: { field: 'discharge' | 'dischargeTransshipment' | 'load' | 'transshipment' | 'maxSts'; label: MessageKey; min: number }[] = [
  { field: 'discharge', label: 'vessels.col.discharge', min: 0 },
  { field: 'dischargeTransshipment', label: 'vessels.col.tsIn', min: 0 },
  { field: 'load', label: 'vessels.col.load', min: 0 },
  { field: 'transshipment', label: 'vessels.col.transshipment', min: 0 },
  { field: 'maxSts', label: 'vessels.col.maxSts', min: 1 },
]

/** Empty 40 ft containers a vessel loads (the table edits one requirement; richer ones come from scenario JSON). */
function emptiesOf(v: VesselConfig): number {
  return (v.empties ?? []).reduce((n, e) => n + e.count, 0)
}

function setEmpties(v: VesselConfig, value: number): void {
  const count = Math.max(0, Math.round(Number(value) || 0))
  if (count === 0) delete v.empties
  else v.empties = [{ size: '40', line: v.line ?? 'MSC', count }]
}

function mixText(v: VesselConfig): string {
  const m = flowMixOf(v)
  return t('vessels.mix', { imp: Math.round(m.import), exp: Math.round(m.export), ts: Math.round(m.transshipment) })
}

function arrivalInput(v: VesselConfig): string {
  return toLocalInputValue(new Date(start.value.getTime() + v.arrivalS * 1000))
}

function setArrival(v: VesselConfig, value: string): void {
  const d = fromLocalInputValue(value)
  if (d) v.arrivalS = Math.round((d.getTime() - start.value.getTime()) / 1000)
}

function nextId(): string {
  let n = vessels.value.length + 1
  const taken = new Set(vessels.value.map((v) => v.id))
  while (taken.has(`V${String(n).padStart(3, '0')}`)) n++
  return `V${String(n).padStart(3, '0')}`
}

function addVessel(): void {
  const last = vessels.value[vessels.value.length - 1]
  const id = nextId()
  const sizeClass = last?.sizeClass ?? 'panamax'
  // #165: a new row discharges a typical full-size call of its class (moves scale 1)
  vessels.value.push(makeVesselCall(id, { name: id, sizeClass, arrivalS: (last?.arrivalS ?? 0) + 3600, discharge: DEFAULT_CALL_MOVES[sizeClass].discharge }))
}

function removeVessel(i: number): void {
  vessels.value.splice(i, 1)
}

// ── Generate N vessels ──────────────────────────────────────────────────────
const gen = reactive({
  count: 6,
  start: '',
  intervalH: 6,
  jitterMin: 60,
  seed: 1,
  movesScale: 1, // #165: full-size calls by default
  mix: Object.fromEntries(VESSEL_SIZE_CLASSES.map((c) => [c, c === 'panamax' || c === 'neo-panamax' ? 1 : 0])) as Record<
    VesselSizeClass,
    number
  >,
})
const flow = reactive({ import: 35, export: 35, transshipment: 30 })
const genError = ref<MessageKey | null>(null)

function generate(): void {
  const startDate = gen.start ? fromLocalInputValue(gen.start) : start.value
  if (!startDate) {
    genError.value = 'vessels.generate.errorStart'
    return
  }
  if (!(gen.count >= 1 && gen.count <= 60)) {
    genError.value = 'vessels.generate.errorCount'
    return
  }
  if (!Object.values(gen.mix).some((w) => w > 0)) {
    genError.value = 'vessels.generate.errorMix'
    return
  }
  if (!(flow.import > 0 || flow.export > 0 || flow.transshipment > 0)) {
    genError.value = 'vessels.generate.errorFlow'
    return
  }
  genError.value = null
  vessels.value = generateVessels({
    flowMix: { ...flow },
    count: gen.count,
    startS: Math.max(0, Math.round((startDate.getTime() - start.value.getTime()) / 1000)),
    intervalS: gen.intervalH * 3600,
    jitterS: gen.jitterMin * 60,
    sizeMix: { ...gen.mix },
    seed: gen.seed,
    movesScale: gen.movesScale,
  })
}
</script>

<template>
  <div class="vessels">
    <div class="table-wrap">
      <table :aria-label="t('vessels.table')">
        <thead>
          <tr>
            <th>{{ t('vessels.col.vessel') }}</th>
            <th>{{ t('vessels.col.arrival') }}</th>
            <th>{{ t('vessels.col.sizeClass') }}</th>
            <th :title="t('vessels.col.dischargeHint')">
              {{ t('vessels.col.discharge') }}
            </th>
            <th :title="t('vessels.col.tsInHint')">
              {{ t('vessels.col.tsIn') }}
            </th>
            <th :title="t('vessels.col.loadHint')">
              {{ t('vessels.col.load') }}
            </th>
            <th :title="t('vessels.col.transshipmentHint')">
              {{ t('vessels.col.transshipment') }}
            </th>
            <th :title="t('vessels.col.emptiesHint')">
              {{ t('vessels.col.empties') }}
            </th>
            <th :title="t('vessels.col.maxStsHint')">
              {{ t('vessels.col.maxSts') }}
            </th>
            <th :title="t('vessels.col.mixHint')">
              {{ t('vessels.col.mix') }}
            </th>
            <th>
              <span class="sr-only">{{ t('vessels.col.remove') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(v, i) in vessels"
            :key="v.id"
          >
            <td>
              <span class="mono">{{ v.id }}</span>
              <span class="name">{{ v.name }}</span>
            </td>
            <td>
              <LocaleDateTimeInput
                :model-value="arrivalInput(v)"
                :aria-label="t('vessels.field', { id: v.id, field: t('vessels.col.arrival') })"
                @update:model-value="setArrival(v, $event)"
              />
            </td>
            <td>
              <select
                v-model="v.sizeClass"
                :aria-label="t('vessels.field', { id: v.id, field: t('vessels.col.sizeClass') })"
              >
                <option
                  v-for="c in VESSEL_SIZE_CLASSES"
                  :key="c"
                  :value="c"
                >
                  {{ t('vessels.classOption', { label: VESSEL_CLASSES[c].label, loa: VESSEL_CLASSES[c].loaM }) }}
                </option>
              </select>
            </td>
            <td
              v-for="f in COUNT_FIELDS"
              :key="f.field"
            >
              <input
                v-model.number="v[f.field]"
                type="number"
                :min="f.min"
                step="1"
                :aria-label="t('vessels.field', { id: v.id, field: t(f.label) })"
              >
            </td>
            <td>
              <input
                :value="emptiesOf(v)"
                type="number"
                min="0"
                step="1"
                :aria-label="t('vessels.field', { id: v.id, field: t('vessels.col.empties') })"
                @change="setEmpties(v, ($event.target as HTMLInputElement).valueAsNumber)"
              >
            </td>
            <td class="mono mixcell">
              {{ mixText(v) }}
            </td>
            <td>
              <button
                type="button"
                class="icon"
                :aria-label="t('vessels.remove', { id: v.id })"
                :title="t('vessels.remove', { id: v.id })"
                @click="removeVessel(i)"
              >
                <TtIcon name="close" />
              </button>
            </td>
          </tr>
          <tr v-if="vessels.length === 0">
            <td
              colspan="11"
              class="empty"
            >
              {{ t('vessels.empty') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button
      type="button"
      class="btn small"
      @click="addVessel"
    >
      {{ t('vessels.add') }}
    </button>

    <details class="generator">
      <summary>{{ t('vessels.generate.title') }}</summary>
      <div class="gen-grid">
        <label>
          <span>{{ t('vessels.generate.count') }}</span>
          <input
            v-model.number="gen.count"
            type="number"
            min="1"
            max="60"
          >
        </label>
        <label>
          <span>{{ t('vessels.generate.firstArrival') }}</span>
          <LocaleDateTimeInput v-model="gen.start" />
        </label>
        <label>
          <span>{{ t('vessels.generate.intervalH') }}</span>
          <input
            v-model.number="gen.intervalH"
            type="number"
            min="0"
            step="any"
          >
        </label>
        <label>
          <span>{{ t('vessels.generate.jitterMin') }}</span>
          <input
            v-model.number="gen.jitterMin"
            type="number"
            min="0"
            step="any"
          >
        </label>
        <label :title="t('vessels.generate.movesScaleHint')">
          <span>{{ t('vessels.generate.movesScale') }}</span>
          <input
            v-model.number="gen.movesScale"
            type="number"
            min="0.01"
            step="any"
          >
        </label>
        <label>
          <span>{{ t('vessels.generate.seed') }}</span>
          <input
            v-model.number="gen.seed"
            type="number"
            min="0"
            step="1"
          >
        </label>
      </div>
      <fieldset class="mix">
        <legend>{{ t('vessels.generate.mix') }}</legend>
        <label
          v-for="c in VESSEL_SIZE_CLASSES"
          :key="c"
        >
          <span>{{ VESSEL_CLASSES[c].label }}</span>
          <input
            v-model.number="gen.mix[c]"
            type="number"
            min="0"
            step="any"
            :aria-label="t('vessels.generate.weight', { label: VESSEL_CLASSES[c].label })"
          >
        </label>
      </fieldset>
      <fieldset class="mix">
        <legend>{{ t('vessels.generate.flow') }}</legend>
        <label>
          <span>{{ t('vessels.generate.flowImport') }}</span>
          <input
            v-model.number="flow.import"
            type="number"
            min="0"
            step="any"
          >
        </label>
        <label>
          <span>{{ t('vessels.generate.flowExport') }}</span>
          <input
            v-model.number="flow.export"
            type="number"
            min="0"
            step="any"
          >
        </label>
        <label>
          <span>{{ t('vessels.generate.flowTs') }}</span>
          <input
            v-model.number="flow.transshipment"
            type="number"
            min="0"
            step="any"
          >
        </label>
        <button
          type="button"
          class="btn small"
          @click="Object.assign(flow, TTI_FLOW_MIX)"
        >
          {{ t('vessels.generate.flowTti') }}
        </button>
      </fieldset>
      <p
        v-if="genError"
        class="error"
      >
        {{ t(genError) }}
      </p>
      <button
        type="button"
        class="btn small"
        @click="generate"
      >
        {{ t('vessels.generate.run') }}
      </button>
    </details>
  </div>
</template>

<style scoped>
.vessels {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.table-wrap {
  max-height: 14rem;
  overflow: auto;
  border: 1px solid var(--tt-border);
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

th {
  position: sticky;
  top: 0;
  background: var(--tt-surface-hover);
  color: var(--tt-text-muted);
  font-weight: 600;
  text-align: left;
  padding: 0.35rem 0.4rem;
  white-space: nowrap;
}

td {
  padding: 0.25rem 0.4rem;
  border-top: 1px solid var(--tt-border);
  vertical-align: middle;
}

.mono {
  font-family: var(--tt-font-mono);
  display: block;
}

.name {
  color: var(--tt-text-muted);
  font-size: 0.72rem;
  white-space: nowrap;
}

input,
select {
  padding: 0.3rem 0.4rem;
  background: var(--tt-bg);
  border: 1px solid var(--tt-border);
  border-radius: 5px;
  color: var(--tt-text);
  font-family: var(--tt-font-mono);
  font-size: 0.78rem;
  color-scheme: dark;
  min-width: 0;
}

td input[type='number'] {
  width: 3.8rem;
}

.icon {
  background: none;
  border: none;
  color: var(--tt-text-muted);
  cursor: pointer;
  padding: 0.2rem 0.4rem;
}

.icon:hover {
  color: var(--tt-danger);
}

.empty {
  color: var(--tt-text-muted);
  font-style: italic;
  text-align: center;
  padding: 0.8rem;
}

.btn {
  align-self: flex-start;
  padding: 0.35rem 0.75rem;
  background: var(--tt-bg);
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  color: var(--tt-text);
  font-size: 0.8rem;
}

.btn:hover {
  border-color: var(--tt-accent);
}

.generator {
  border: 1px dashed var(--tt-border);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
}

.generator summary {
  cursor: pointer;
  color: var(--tt-text-muted);
  font-size: 0.8rem;
}

.generator[open] {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.gen-grid,
.mix {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.mix {
  border: none;
  padding: 0;
}

.mix legend {
  color: var(--tt-text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.gen-grid label,
.mix label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.74rem;
  color: var(--tt-text-muted);
}

.error {
  color: var(--tt-danger);
  font-size: 0.8rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
