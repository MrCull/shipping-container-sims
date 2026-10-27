<script setup lang="ts">
/**
 * Editable vessel table (one row per vessel call) plus the "Generate N
 * vessels" helper. Arrivals are shown as local date-times relative to the
 * scenario start; the table stores seconds from the start.
 */
import { computed, reactive, ref } from 'vue'
import { makeVesselCall } from '../../scenario/builder'
import type { VesselConfig, VesselSizeClass } from '../../scenario/types'
import { VESSEL_CLASSES, VESSEL_SIZE_CLASSES } from '../../scenario/vesselClasses'
import { generateVessels } from '../../scenario/vesselGenerator'
import { fromLocalInputValue, toLocalInputValue } from '../../modules/time'

const props = defineProps<{ startDateTime: Date | null }>()
const vessels = defineModel<VesselConfig[]>({ required: true })

const start = computed(() => props.startDateTime ?? new Date(0))

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
const genError = ref<string | null>(null)

function generate(): void {
  const startDate = gen.start ? fromLocalInputValue(gen.start) : start.value
  if (!startDate) {
    genError.value = 'Enter a valid first arrival'
    return
  }
  if (!(gen.count >= 1 && gen.count <= 60)) {
    genError.value = 'Generate 1–60 vessels'
    return
  }
  if (!Object.values(gen.mix).some((w) => w > 0)) {
    genError.value = 'Give at least one size class a weight'
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
      <table aria-label="Vessel table">
        <thead>
          <tr>
            <th>Vessel</th>
            <th>Arrival</th>
            <th>Size class</th>
            <th title="Boxes discharged">
              Disch.
            </th>
            <th title="Export boxes loaded (slots reserved)">
              Load
            </th>
            <th title="Transshipment boxes loaded (slots reserved)">
              T/S
            </th>
            <th title="Maximum STS cranes">
              Max STS
            </th>
            <th><span class="sr-only">Remove</span></th>
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
                :aria-label="`${v.id} arrival`"
                @change="setArrival(v, ($event.target as HTMLInputElement).value)"
              >
            </td>
            <td>
              <select
                v-model="v.sizeClass"
                :aria-label="`${v.id} size class`"
              >
                <option
                  v-for="c in VESSEL_SIZE_CLASSES"
                  :key="c"
                  :value="c"
                >
                  {{ VESSEL_CLASSES[c].label }} ({{ VESSEL_CLASSES[c].loaM }} m)
                </option>
              </select>
            </td>
            <td>
              <input
                v-model.number="v.discharge"
                type="number"
                min="0"
                step="1"
                :aria-label="`${v.id} discharge`"
              >
            </td>
            <td>
              <input
                v-model.number="v.load"
                type="number"
                min="0"
                step="1"
                :aria-label="`${v.id} load`"
              >
            </td>
            <td>
              <input
                v-model.number="v.transshipment"
                type="number"
                min="0"
                step="1"
                :aria-label="`${v.id} transshipment`"
              >
            </td>
            <td>
              <input
                v-model.number="v.maxSts"
                type="number"
                min="1"
                max="24"
                step="1"
                :aria-label="`${v.id} max STS`"
              >
            </td>
            <td>
              <button
                type="button"
                class="icon"
                :aria-label="`Remove ${v.id}`"
                title="Remove"
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
              No vessels yet. Add one, or generate a schedule below.
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
      + Add vessel
    </button>

    <details class="generator">
      <summary>Generate N vessels…</summary>
      <div class="gen-grid">
        <label>
          <span>Vessels</span>
          <input
            v-model.number="gen.count"
            type="number"
            min="1"
            max="60"
            aria-label="Number of vessels"
          >
        </label>
        <label>
          <span>First arrival</span>
          <input
            v-model="gen.start"
            type="datetime-local"
            aria-label="First arrival"
          >
        </label>
        <label>
          <span>Interval (h)</span>
          <input
            v-model.number="gen.intervalH"
            type="number"
            min="0"
            step="0.5"
            aria-label="Interval in hours"
          >
        </label>
        <label>
          <span>Jitter ± (min)</span>
          <input
            v-model.number="gen.jitterMin"
            type="number"
            min="0"
            step="5"
            aria-label="Jitter in minutes"
          >
        </label>
        <label>
          <span>Moves scale</span>
          <input
            v-model.number="gen.movesScale"
            type="number"
            min="0.01"
            step="0.05"
            aria-label="Moves scale"
            title="1 = typical moves per call for each class"
          >
        </label>
        <label>
          <span>Seed</span>
          <input
            v-model.number="gen.seed"
            type="number"
            min="0"
            step="1"
            aria-label="Generator seed"
          >
        </label>
      </div>
      <fieldset class="mix">
        <legend>Size mix (weights)</legend>
        <label
          v-for="c in VESSEL_SIZE_CLASSES"
          :key="c"
        >
          <span>{{ VESSEL_CLASSES[c].label }}</span>
          <input
            v-model.number="gen.mix[c]"
            type="number"
            min="0"
            step="1"
            :aria-label="`${VESSEL_CLASSES[c].label} weight`"
          >
        </label>
      </fieldset>
      <p
        v-if="genError"
        class="error"
      >
        {{ genError }}
      </p>
      <button
        type="button"
        class="btn small"
        @click="generate"
      >
        Generate (replaces the table)
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
  width: 4.6rem;
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
