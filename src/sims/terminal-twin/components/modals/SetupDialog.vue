<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { randomSeed, resolveScenario, scenarioCatalogue, useTwinStore } from '../../store/twinStore'
import { fromLocalInputValue, toLocalInputValue } from '../../modules/time'
import { t } from '../../i18n/messages'
import { browserDisplayDefaults } from '../../i18n/display'
import { applyOverrides, LIMITS, validateOverrides, type OverrideCheck, type ScenarioOverrides } from '../../scenario/overrides'
import type { UnitSystem, VesselConfig } from '../../scenario/types'
import VesselTable from '../setup/VesselTable.vue'

const store = useTwinStore()
const catalogue = scenarioCatalogue()

/** Offered locales; the browser's and the current one are added if missing. */
const COMMON_LOCALES = ['en-GB', 'en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nl-NL', 'pt-BR', 'ja-JP', 'zh-CN']
const UNIT_SYSTEMS: UnitSystem[] = ['metric', 'imperial']
const browserLocale = browserDisplayDefaults(typeof navigator === 'undefined' ? [] : navigator.languages ?? []).locale

function localeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

const localeOptions = computed(() => {
  const tags = [...new Set([browserLocale, store.display.locale, ...COMMON_LOCALES])]
  return tags.map((tag) => {
    const name = `${localeName(tag)} · ${tag}`
    return { tag, label: tag === browserLocale ? t('setup.localeBrowser', { name }) : name }
  })
})

const preview = computed(() => {
  const fmt = store.fmt
  const sample = new Date(fromLocalInputValue(start.value) ?? Date.now())
  const { date, time } = fmt.dateTime(sample)
  return t('setup.preview', { date, time, number: fmt.number(1234567.89, 2), weekStart: fmt.weekdayName(fmt.firstDayOfWeek()) })
})

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
/** The scenario as it would start (selected fixture/preset + the edits above). */
const draftConfig = computed(() => {
  try {
    return applyOverrides(resolveScenario(name.value), overrides.value)
  } catch {
    return null
  }
})
const check = computed<OverrideCheck>(() => {
  try {
    return validateOverrides(applyOverrides(resolveScenario(name.value), overrides.value))
  } catch (err) {
    return { errors: [{ key: 'setup.check.invalid', params: { message: err instanceof Error ? err.message : String(err) } }], warnings: [] }
  }
})

/** Key figures of the scenario as edited, in the chosen units (the config itself stays SI). */
const summary = computed(() => {
  const config = draftConfig.value
  if (!config) return []
  const fmt = store.fmt
  const sts = config.kinematics.sts
  return [
    { label: t('setup.summary.quay'), value: fmt.length(config.quay.lengthM), testid: 'quay' },
    { label: t('setup.summary.sts'), value: fmt.number(config.sts.length, 0), testid: 'sts' },
    {
      label: t('setup.summary.containers'),
      value: fmt.number(config.vessels.reduce((n, v) => n + v.discharge, 0), 0),
      testid: 'containers',
    },
    { label: t('setup.summary.gantry'), value: fmt.speed(sts.gantry.vMax), testid: 'gantry' },
    { label: t('setup.summary.trolley'), value: fmt.speed(sts.trolley.vMax), testid: 'trolley' },
    { label: t('setup.summary.hoist'), value: fmt.speed(sts.hoistLoaded.vMax), testid: 'hoist' },
  ]
})

function reroll(): void {
  seed.value = randomSeed()
}

async function submit(): Promise<void> {
  const startAt = startDate.value
  if (!startAt) {
    formError.value = t('setup.errorStart')
    return
  }
  if (!Number.isInteger(seed.value) || seed.value < 0) {
    formError.value = t('setup.errorSeed')
    return
  }
  if (check.value.errors.length > 0) {
    formError.value = t(check.value.errors[0].key, check.value.errors[0].params)
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
        {{ t('setup.title') }}
      </h2>
      <p class="intro">
        {{ t('setup.intro') }}
      </p>

      <fieldset class="field">
        <legend>{{ t('setup.scenario') }}</legend>
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
          <span class="choice-kind">{{ t(`setup.kind.${c.kind}`) }}</span>
        </label>
        <p
          v-if="selected"
          class="hint"
        >
          {{ selected.description }}
        </p>
        <p class="hint muted">
          {{ t('setup.presetsSoon') }}
        </p>
        <dl
          v-if="summary.length"
          class="summary"
          :aria-label="t('setup.summary')"
          data-testid="tt-setup-summary"
        >
          <div
            v-for="item in summary"
            :key="item.testid"
            class="summary-item"
          >
            <dt>{{ item.label }}</dt>
            <dd :data-testid="`tt-summary-${item.testid}`">
              {{ item.value }}
            </dd>
          </div>
        </dl>
      </fieldset>

      <div class="row">
        <label class="field">
          <span>{{ t('setup.seed') }}</span>
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
              :title="t('setup.rerollHint')"
              @click="reroll"
            >
              {{ t('setup.reroll') }}
            </button>
          </span>
        </label>
        <label class="field">
          <span>{{ t('setup.start') }}</span>
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
          <span>{{ t('setup.quayLength') }}</span>
          <input
            v-model.number="quayLengthM"
            type="number"
            :min="LIMITS.quayLengthM.min"
            :max="LIMITS.quayLengthM.max"
            step="any"
            name="quayLength"
          >
        </label>
        <label class="field">
          <span>{{ t('setup.stsCount') }}</span>
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
        <legend>{{ t('setup.vessels') }}</legend>
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
          v-for="(e, i) in check.errors"
          :key="`e${i}`"
          class="error"
        >
          ⛔ {{ t(e.key, e.params) }}
        </li>
        <li
          v-for="(w, i) in check.warnings"
          :key="`w${i}`"
          class="warning"
        >
          ⚠ {{ t(w.key, w.params) }}
        </li>
      </ul>

      <fieldset class="field">
        <legend>{{ t('setup.display') }}</legend>
        <div class="row">
          <label class="field">
            <span>{{ t('setup.locale') }}</span>
            <select
              name="locale"
              data-testid="tt-locale"
              :value="store.display.locale"
              @change="store.setDisplay({ locale: ($event.target as HTMLSelectElement).value })"
            >
              <option
                v-for="o in localeOptions"
                :key="o.tag"
                :value="o.tag"
              >
                {{ o.label }}
              </option>
            </select>
          </label>
          <div
            class="field"
            role="radiogroup"
            :aria-label="t('setup.units')"
          >
            <span>{{ t('setup.units') }}</span>
            <label
              v-for="u in UNIT_SYSTEMS"
              :key="u"
              class="unit-choice"
            >
              <input
                type="radio"
                name="tt-units"
                :value="u"
                :checked="store.display.units === u"
                :data-testid="`tt-units-${u}`"
                @change="store.setDisplay({ units: u })"
              >
              {{ t(`setup.units.${u}`) }}
            </label>
          </div>
        </div>
        <p
          class="hint"
          data-testid="tt-display-preview"
        >
          {{ preview }}
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
          {{ t('setup.cancel') }}
        </button>
        <button
          type="submit"
          class="btn primary"
          :disabled="store.loading"
        >
          {{ store.loading ? t('setup.starting') : t('setup.startButton') }}
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
  min-width: 0;
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

.row > * {
  min-width: 0;
}

input[type='number'],
input[type='datetime-local'],
select {
  padding: 0.45rem 0.6rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--tt-font-mono);
  color-scheme: dark;
  min-width: 0;
  width: 100%;
}

.unit-choice {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem 1rem;
  margin-top: 0.6rem;
  font-size: 0.8rem;
}

@media (max-width: 560px) {
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.summary dt {
  color: var(--color-text-muted);
  font-size: 0.72rem;
}

.summary dd {
  margin: 0;
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
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
