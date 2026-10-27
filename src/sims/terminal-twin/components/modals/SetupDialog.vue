<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { travelTime } from '../../engine'
import { DEFAULT_SHC_KINEMATICS } from '../../scenario/builder'
import type { ShcKinematics } from '../../scenario/types'
import { randomSeed, resolveScenario, scenarioCatalogue, useTwinStore } from '../../store/twinStore'
import { fromLocalInputValue, toLocalInputValue } from '../../modules/time'

/** Spec scale limit for the SHC fleet. */
const MAX_SHC = 120

const store = useTwinStore()
const catalogue = scenarioCatalogue()

const name = ref(store.choice.name)
const seed = ref(store.choice.seed)
const start = ref(toLocalInputValue(new Date(store.choice.startDateTime)))
const formError = ref<string | null>(null)

const selected = computed(() => catalogue.find((c) => c.name === name.value))

// SHC fleet and kinematics (only for scenarios that have SHCs).
const scenarioShcs = computed(() => (name.value ? (resolveScenario(name.value).shcs?.length ?? 0) : 0))
const shcCount = ref(0)
/** Plain deep copy (structuredClone cannot copy Vue reactive proxies). */
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const shcK = ref<ShcKinematics>(copy(DEFAULT_SHC_KINEMATICS))
function loadShcDefaults(): void {
  const base = name.value ? resolveScenario(name.value) : null
  const previous = store.choice.name === name.value ? store.choice.shc : undefined
  shcCount.value = previous?.count ?? base?.shcs?.length ?? 0
  shcK.value = copy(previous?.kinematics ?? base?.kinematics.shc ?? DEFAULT_SHC_KINEMATICS)
}
loadShcDefaults()
watch(name, loadShcDefaults)

/** Derived readout: a nominal 300 m empty + 300 m loaded trip with lock, lift, lower and unlock. */
const nominalTrip = computed(() => {
  const k = shcK.value
  const valid = [k.driveEmpty, k.driveLoaded, k.lift].every((p) => p.vMax > 0 && p.accel > 0 && p.decel > 0)
  if (!valid) return null
  const seconds =
    travelTime(300, k.driveEmpty) +
    travelTime(300, k.driveLoaded) +
    2 * travelTime(k.liftHeightM, k.lift) +
    k.lockS +
    k.unlockS
  return { seconds, perHour: 3600 / seconds }
})

function reroll(): void {
  seed.value = randomSeed()
}

async function submit(): Promise<void> {
  const startDate = fromLocalInputValue(start.value)
  if (!startDate) {
    formError.value = 'Enter a valid start date and time'
    return
  }
  if (!Number.isInteger(seed.value) || seed.value < 0) {
    formError.value = 'The seed must be a whole number ≥ 0'
    return
  }
  if (scenarioShcs.value > 0 && (!Number.isInteger(shcCount.value) || shcCount.value < 1 || shcCount.value > MAX_SHC)) {
    formError.value = `SHC count must be a whole number from 1 to ${MAX_SHC}`
    return
  }
  if (scenarioShcs.value > 0 && !nominalTrip.value) {
    formError.value = 'SHC speeds and accelerations must be greater than 0'
    return
  }
  formError.value = null
  await store
    .startScenario({
      name: name.value,
      seed: seed.value,
      startDateTime: startDate.toISOString(),
      shc: scenarioShcs.value > 0 ? { count: shcCount.value, kinematics: copy(shcK.value) } : undefined,
    })
    .catch(() => {})
}
</script>

<template>
  <div class="backdrop">
    <form
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tt-setup-title"
      @submit.prevent="submit"
    >
      <h2 id="tt-setup-title">
        New scenario
      </h2>
      <p class="intro">
        Pick a scenario, set the seed and the start date/time. The same seed always gives the same run.
      </p>

      <fieldset class="field">
        <legend>Scenario</legend>
        <label
          v-for="c in catalogue"
          :key="c.name"
          class="choice"
          :class="{ active: c.name === name }"
        >
          <input
            v-model="name"
            type="radio"
            name="tt-scenario"
            :value="c.name"
          >
          <span class="choice-name">{{ c.name }}</span>
          <span class="choice-kind">{{ c.kind }}</span>
        </label>
        <p
          v-if="selected"
          class="hint"
        >
          {{ selected.description }}
        </p>
        <p class="hint muted">
          Presets (TTI Algeciras, Small automated, Stress test) are coming soon.
        </p>
      </fieldset>

      <div class="row">
        <label class="field">
          <span>Seed</span>
          <span class="seed">
            <input
              v-model.number="seed"
              type="number"
              min="0"
              step="1"
              name="seed"
              required
            >
            <button
              type="button"
              class="btn"
              title="Random seed"
              @click="reroll"
            >
              ↻ Re-roll
            </button>
          </span>
        </label>
        <label class="field">
          <span>Start date/time</span>
          <input
            v-model="start"
            type="datetime-local"
            name="start"
            required
          >
        </label>
      </div>

      <fieldset
        v-if="scenarioShcs > 0"
        class="field shc"
      >
        <legend>Shuttle carriers (SHC)</legend>
        <div class="grid">
          <label class="mini">
            <span>Count</span>
            <input
              v-model.number="shcCount"
              type="number"
              min="1"
              :max="MAX_SHC"
              step="1"
              name="shc-count"
            >
          </label>
          <label class="mini">
            <span>Empty speed (m/s)</span>
            <input
              v-model.number="shcK.driveEmpty.vMax"
              type="number"
              min="0.1"
              step="any"
              name="shc-v-empty"
            >
          </label>
          <label class="mini">
            <span>Loaded speed (m/s)</span>
            <input
              v-model.number="shcK.driveLoaded.vMax"
              type="number"
              min="0.1"
              step="any"
              name="shc-v-loaded"
            >
          </label>
          <label class="mini">
            <span>Accel. (m/s²)</span>
            <input
              v-model.number="shcK.driveEmpty.accel"
              type="number"
              min="0.05"
              step="any"
              name="shc-accel"
            >
          </label>
          <label class="mini">
            <span>Decel. (m/s²)</span>
            <input
              v-model.number="shcK.driveEmpty.decel"
              type="number"
              min="0.05"
              step="any"
              name="shc-decel"
            >
          </label>
          <label class="mini">
            <span>Lock / unlock (s)</span>
            <span class="pair">
              <input
                v-model.number="shcK.lockS"
                type="number"
                min="0"
                step="any"
                name="shc-lock"
                aria-label="Lock time (s)"
              >
              <input
                v-model.number="shcK.unlockS"
                type="number"
                min="0"
                step="any"
                name="shc-unlock"
                aria-label="Unlock time (s)"
              >
            </span>
          </label>
        </div>
        <p
          v-if="nominalTrip"
          class="hint"
          data-testid="tt-shc-readout"
        >
          Nominal 300 m empty + 300 m loaded trip:
          <span class="mono">{{ nominalTrip.seconds.toFixed(0) }} s</span>
          (<span class="mono">{{ nominalTrip.perHour.toFixed(1) }}</span> trips/h per SHC). Loaded acceleration
          stays at the scenario's value.
        </p>
      </fieldset>

      <p
        v-if="formError || store.error"
        class="error"
      >
        {{ formError ?? store.error }}
      </p>

      <div class="buttons">
        <button
          v-if="store.hasScenario"
          type="button"
          class="btn"
          @click="store.cancelSetup()"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn primary"
          :disabled="store.loading"
        >
          {{ store.loading ? 'Starting…' : 'Start' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(10, 14, 26, 0.72);
  backdrop-filter: blur(3px);
}

.dialog {
  width: min(34rem, 100%);
  max-height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.4rem 1.5rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  font-family: var(--font-body);
  color: var(--color-text);
}

h2 {
  font-size: 1.25rem;
  font-weight: 700;
}

.intro,
.hint {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.muted {
  font-style: italic;
}

fieldset {
  border: none;
  padding: 0;
  margin: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.85rem;
}

legend,
.field > span {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.4rem;
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
}

.choice.active {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}

.choice-name {
  font-family: var(--tt-font-mono);
}

.choice-kind {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
  }
}

input[type='number'],
input[type='datetime-local'] {
  padding: 0.45rem 0.6rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--tt-font-mono);
  color-scheme: dark;
  min-width: 0;
}

.seed {
  display: flex;
  gap: 0.4rem;
}

.seed input {
  flex: 1;
}

.btn {
  padding: 0.45rem 0.9rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.85rem;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  font-weight: 600;
  min-width: 6rem;
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.error {
  color: var(--color-danger);
  font-size: 0.85rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
}

@media (max-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.mini {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.pair {
  display: flex;
  gap: 0.3rem;
}

.pair input {
  width: 50%;
}

.mono {
  font-family: var(--tt-font-mono);
  color: var(--color-text);
}
</style>
