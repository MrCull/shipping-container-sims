<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { randomSeed, resolveScenario, scenarioCatalogue, useTwinStore } from '../../store/twinStore'
import { fromLocalInputValue, toLocalInputValue } from '../../modules/time'
import { applyOverrides, LIMITS, validateOverrides, type ScenarioOverrides } from '../../scenario/overrides'
import type { VesselConfig } from '../../scenario/types'
import VesselTable from '../setup/VesselTable.vue'

const store = useTwinStore()
const catalogue = scenarioCatalogue()

const name = ref(store.choice.name)
const seed = ref(store.choice.seed)
const start = ref(toLocalInputValue(new Date(store.choice.startDateTime)))
const formError = ref<string | null>(null)

const selected = computed(() => catalogue.find((c) => c.name === name.value))

// Editable quay, cranes and vessel table, initialised from the chosen scenario.
const quayLengthM = ref(0)
const stsCount = ref(0)
const vessels = ref<VesselConfig[]>([])

function loadDraft(scenario: string, overrides: ScenarioOverrides = {}): void {
  try {
    const config = applyOverrides(resolveScenario(scenario), overrides)
    quayLengthM.value = config.quay.lengthM
    stsCount.value = config.sts.length
    vessels.value = JSON.parse(JSON.stringify(config.vessels))
  } catch {
    vessels.value = []
  }
}
loadDraft(name.value, store.choice.name === name.value ? store.choice.overrides : {})
watch(name, (n) => loadDraft(n))

const startDate = computed(() => fromLocalInputValue(start.value))
const overrides = computed<ScenarioOverrides>(() => ({
  quayLengthM: quayLengthM.value,
  stsCount: stsCount.value,
  vessels: vessels.value,
}))
const check = computed(() => {
  try {
    return validateOverrides(applyOverrides(resolveScenario(name.value), overrides.value))
  } catch (err) {
    return { errors: [err instanceof Error ? err.message : String(err)], warnings: [] }
  }
})

function reroll(): void {
  seed.value = randomSeed()
}

async function submit(): Promise<void> {
  const startAt = startDate.value
  if (!startAt) {
    formError.value = 'Enter a valid start date and time'
    return
  }
  if (!Number.isInteger(seed.value) || seed.value < 0) {
    formError.value = 'The seed must be a whole number ≥ 0'
    return
  }
  if (check.value.errors.length > 0) {
    formError.value = check.value.errors[0]
    return
  }
  formError.value = null
  await store
    .startScenario({
      name: name.value,
      seed: seed.value,
      startDateTime: startAt.toISOString(),
      overrides: JSON.parse(JSON.stringify(overrides.value)),
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

      <div class="row">
        <label class="field">
          <span>Quay length (m)</span>
          <input
            v-model.number="quayLengthM"
            type="number"
            :min="LIMITS.quayLengthM.min"
            :max="LIMITS.quayLengthM.max"
            step="10"
            name="quayLength"
          >
        </label>
        <label class="field">
          <span>STS cranes</span>
          <input
            v-model.number="stsCount"
            type="number"
            :min="LIMITS.sts.min"
            :max="LIMITS.sts.max"
            step="1"
            name="stsCount"
          >
        </label>
      </div>

      <fieldset class="field">
        <legend>Vessels</legend>
        <VesselTable
          v-model="vessels"
          :start-date-time="startDate"
        />
      </fieldset>

      <ul
        v-if="check.errors.length || check.warnings.length"
        class="checks"
      >
        <li
          v-for="e in check.errors"
          :key="e"
          class="error"
        >
          ⛔ {{ e }}
        </li>
        <li
          v-for="w in check.warnings"
          :key="w"
          class="warning"
        >
          ⚠ {{ w }}
        </li>
      </ul>

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
  width: min(52rem, 100%);
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

.checks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0;
  margin: 0;
}

.warning {
  color: var(--color-accent);
  font-size: 0.85rem;
}
</style>
