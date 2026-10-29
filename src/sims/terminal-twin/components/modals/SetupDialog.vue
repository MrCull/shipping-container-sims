<script setup lang="ts">
import { provideSetupDraft } from '../../composables/useSetupDraft'
import { t } from '../../i18n/messages'
import { useTwinStore } from '../../store/twinStore'
import { endConditionsFromFields } from '../../modules/endConditions'
import SetupLayoutSection from '../setup/SetupLayoutSection.vue'
import SetupVesselsSection from '../setup/SetupVesselsSection.vue'
import SetupDisplaySection from '../setup/SetupDisplaySection.vue'
import SetupStsSection from '../setup/SetupStsSection.vue'
import SetupLandsideSection from '../setup/SetupLandsideSection.vue'
import SetupShcSection from '../setup/SetupShcSection.vue'
import SetupYardSection from '../setup/SetupYardSection.vue'
import SetupModesSection from '../setup/SetupModesSection.vue'
import SetupDecisionsSection from '../setup/SetupDecisionsSection.vue'
import { validateLayout } from '../setup/layoutValidation'
import { validateSts } from '../setup/stsValidation'
import { validateShc } from '../setup/shcValidation'
import { validateYard } from '../setup/yardValidation'
import { ref } from 'vue'

/**
 * Shell of the setup dialog: owns the draft (`useSetupDraft`), composes one component per section
 * and runs their validators in order on submit. Each section edits its own part of the draft and
 * exports its own validation message (`../setup/*Validation.ts`).
 */
const store = useTwinStore()
const d = provideSetupDraft()
const formError = ref<string | null>(null)

async function submit(): Promise<void> {
  const startAt = d.startDate
  const checkError = d.check.errors[0]
  const message =
    validateLayout(d) ??
    (checkError ? t(checkError.key, checkError.params) : null) ??
    validateSts(d) ??
    validateShc(d) ??
    validateYard(d)
  if (message || !startAt) {
    formError.value = message
    return
  }
  const end = d.endEdited ? endConditionsFromFields(d.endFields, d.vessels.length) : null
  if (end && !end.ok) {
    formError.value = t(end.error)
    return
  }
  formError.value = null
  await store
    .startScenario({
      endConditions: end?.value,
      name: d.name,
      seed: d.seed,
      startDateTime: startAt.toISOString(),
      overrides: d.edits.overrides,
      shc: d.edits.shc,
      yard: d.edits.yard,
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

      <SetupLayoutSection />
      <SetupVesselsSection />

      <fieldset
        class="field"
        data-testid="tt-end-conditions"
      >
        <legend>{{ t('setup.end.title') }}</legend>
        <p class="hint">
          {{ t('setup.end.hint') }}
        </p>
        <div class="grid">
          <label class="mini">
            <span>{{ t('setup.end.vessels') }}</span>
            <input
              v-model="d.endFields.vessels"
              type="number"
              step="any"
              name="end-vessels"
              :placeholder="t('setup.end.vesselsPlaceholder')"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.end.hours') }}</span>
            <input
              v-model="d.endFields.hours"
              type="number"
              step="any"
              name="end-hours"
              :placeholder="t('setup.end.off')"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.end.moves') }}</span>
            <input
              v-model="d.endFields.moves"
              type="number"
              step="any"
              name="end-moves"
              :placeholder="t('setup.end.off')"
            >
          </label>
        </div>
      </fieldset>

      <ul
        v-if="d.check.errors.length || d.check.warnings.length"
        class="checks"
      >
        <li
          v-for="(e, i) in d.check.errors"
          :key="`e${i}`"
          class="error"
        >
          ⛔ {{ t(e.key, e.params) }}
        </li>
        <li
          v-for="(w, i) in d.check.warnings"
          :key="`w${i}`"
          class="warning"
        >
          ⚠ {{ t(w.key, w.params) }}
        </li>
      </ul>

      <SetupDisplaySection />
      <SetupStsSection />
      <SetupLandsideSection />
      <SetupShcSection />
      <SetupYardSection />
      <SetupModesSection />
      <SetupDecisionsSection />

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
          :disabled="store.loading || d.check.errors.length > 0"
        >
          {{ store.loading ? t('setup.starting') : t('setup.startButton') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped src="../setup/setupSection.css"></style>

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

.intro {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
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
