<script setup lang="ts">
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
import { generateVessels } from '../../scenario/vesselGenerator'
import { fromLocalInputValue, toLocalInputValue } from '../../modules/time'

const props = defineProps<{ startDateTime: Date | null }>()
const vessels = defineModel<VesselConfig[]>({ required: true })

const start = computed(() => props.startDateTime ?? new Date(0))

const COUNT_FIELDS: { field: 'discharge' | 'load' | 'transshipment' | 'maxSts'; label: MessageKey; min: number }[] = [
  { field: 'discharge', label: 'vessels.col.discharge', min: 0 },
  { field: 'load', label: 'vessels.col.load', min: 0 },
  { field: 'transshipment', label: 'vessels.col.transshipment', min: 0 },
  { field: 'maxSts', label: 'vessels.col.maxSts', min: 1 },
]

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
  vessels.value.push(
    makeVesselCall(id, { name: id, sizeClass: last?.sizeClass ?? 'panamax', arrivalS: (last?.arrivalS ?? 0) + 3600, discharge: 40 }),
  )
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
  movesScale: 0.1,
  mix: Object.fromEntries(VESSEL_SIZE_CLASSES.map((c) => [c, c === 'panamax' || c === 'neo-panamax' ? 1 : 0])) as Record<
    VesselSizeClass,
    number
  >,
})
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
  genError.value = null
  vessels.value = generateVessels({
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
            <th :title="t('vessels.col.loadHint')">
              {{ t('vessels.col.load') }}
            </th>
            <th :title="t('vessels.col.transshipmentHint')">
              {{ t('vessels.col.transshipment') }}
            </th>
            <th :title="t('vessels.col.maxStsHint')">
              {{ t('vessels.col.maxSts') }}
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
              <input
                type="datetime-local"
                :value="arrivalInput(v)"
                :aria-label="t('vessels.field', { id: v.id, field: t('vessels.col.arrival') })"
                @change="setArrival(v, ($event.target as HTMLInputElement).value)"
              >
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
              <button
                type="button"
                class="icon"
                :aria-label="t('vessels.remove', { id: v.id })"
                :title="t('vessels.remove', { id: v.id })"
                @click="removeVessel(i)"
              >
                ✕
              </button>
            </td>
          </tr>
          <tr v-if="vessels.length === 0">
            <td
              colspan="8"
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
          <input
            v-model="gen.start"
            type="datetime-local"
          >
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
  border: 1px solid var(--color-border);
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
  background: var(--color-bg-card-hover);
  color: var(--color-text-muted);
  font-weight: 600;
  text-align: left;
  padding: 0.35rem 0.4rem;
  white-space: nowrap;
}

td {
  padding: 0.25rem 0.4rem;
  border-top: 1px solid var(--color-border);
  vertical-align: middle;
}

.mono {
  font-family: var(--tt-font-mono);
  display: block;
}

.name {
  color: var(--color-text-muted);
  font-size: 0.72rem;
  white-space: nowrap;
}

input,
select {
  padding: 0.3rem 0.4rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  color: var(--color-text);
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
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0.2rem 0.4rem;
}

.icon:hover {
  color: var(--color-danger);
}

.empty {
  color: var(--color-text-muted);
  font-style: italic;
  text-align: center;
  padding: 0.8rem;
}

.btn {
  align-self: flex-start;
  padding: 0.35rem 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.8rem;
}

.btn:hover {
  border-color: var(--color-primary);
}

.generator {
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
}

.generator summary {
  cursor: pointer;
  color: var(--color-text-muted);
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
  color: var(--color-text-muted);
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
  color: var(--color-text-muted);
}

.error {
  color: var(--color-danger);
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
