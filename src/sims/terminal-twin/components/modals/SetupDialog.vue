<script setup lang="ts">
import TtIcon from '../ui/TtIcon.vue'
import { provideSetupDraft } from '../../composables/useSetupDraft'
import { t } from '../../i18n/messages'
import { useTwinStore } from '../../store/twinStore'
import { endConditionsFromFields } from '../../modules/endConditions'
import ScenarioPicker from '../setup/ScenarioPicker.vue'
import ScenarioDetail from '../setup/ScenarioDetail.vue'
import SetupSeedStart from '../setup/SetupSeedStart.vue'
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
import heroImage from '../../assets/home-card.png?url'

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
      <header
        class="hero"
        :class="{ compact: store.hasScenario }"
        data-testid="tt-setup-hero"
      >
        <img
          v-if="!store.hasScenario"
          class="hero-img"
          :src="heroImage"
          :alt="t('setup.heroAlt')"
          width="1200"
          height="630"
        >
        <div class="hero-text tt-frost">
          <p class="kicker">
            {{ t('setup.heroKicker') }}
          </p>
          <h2 id="tt-setup-title">
            {{ t('setup.title') }}
          </h2>
          <p class="intro">
            {{ t('setup.intro') }}
          </p>
        </div>
      </header>

      <ScenarioPicker>
        <ScenarioDetail :error="formError" />
      </ScenarioPicker>
      <SetupLayoutSection />
      <SetupVesselsSection />

      <details
        class="advanced"
        data-testid="tt-advanced"
      >
        <summary>{{ t('setup.advanced') }}</summary>
        <p class="hint">
          {{ t('setup.advancedHint') }}
        </p>
        <SetupSeedStart />
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
      </details>

      <ul
        v-if="d.check.errors.length || d.check.warnings.length"
        class="checks"
      >
        <li
          v-for="(e, i) in d.check.errors"
          :key="`e${i}`"
          class="error"
        >
          <TtIcon name="alert" /> {{ t(e.key, e.params) }}
        </li>
        <li
          v-for="(w, i) in d.check.warnings"
          :key="`w${i}`"
          class="warning"
        >
          <TtIcon name="warn" /> {{ t(w.key, w.params) }}
        </li>
      </ul>

      <SetupDisplaySection />
      <SetupStsSection />
      <SetupLandsideSection />
      <SetupShcSection />
      <SetupYardSection />
      <SetupModesSection />
      <SetupDecisionsSection />

      <div
        v-if="store.hasScenario"
        class="buttons"
      >
        <button
          type="button"
          class="btn"
          @click="store.cancelSetup()"
        >
          {{ t('setup.cancel') }}
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
  background: var(--tt-scrim);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
}

.dialog {
  width: min(56rem, 100%);
  max-height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.4rem 1.5rem;
  background: var(--tt-surface);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-lg);
  box-shadow: var(--tt-shadow-lg);
  font-family: var(--tt-font);
  color: var(--tt-text);
}

.hero {
  position: relative;
  flex: none;
  margin: -1.4rem -1.5rem 0;
  border-radius: var(--tt-radius-lg) var(--tt-radius-lg) 0 0;
  overflow: hidden;
  background: var(--tt-surface-sunken);
}

.hero-img {
  display: block;
  width: 100%;
  height: 15rem;
  object-fit: cover;
  object-position: 50% 40%;
}

.hero-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.9rem 1.5rem;
  border-width: 1px 0 0;
}

.hero:not(.compact) .hero-text {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

.hero.compact {
  border-radius: var(--tt-radius-lg) var(--tt-radius-lg) 0 0;
}

.kicker {
  color: var(--tt-accent);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h2 {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.intro {
  color: var(--tt-text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.btn {
  padding: 0.45rem 0.9rem;
  background: var(--tt-bg);
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  color: var(--tt-text);
  font-size: 0.85rem;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  border-color: var(--tt-accent);
}

.advanced > summary {
  cursor: pointer;
  color: var(--tt-text-muted);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.advanced[open] > summary {
  margin-bottom: 0.5rem;
}

.advanced {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.error {
  color: var(--tt-danger);
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
  color: var(--tt-warn);
  font-size: 0.85rem;
}
</style>
