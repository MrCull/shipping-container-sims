<script setup lang="ts">
import TtIcon from '../ui/TtIcon.vue'
import { provideSetupDraft } from '../../composables/useSetupDraft'
import { t, type MessageKey } from '../../i18n/messages'
import { useTwinStore } from '../../store/twinStore'
import { endConditionsFromFields } from '../../modules/endConditions'
import { scenarioDisplayName } from '../../modules/scenarioPicker'
import { SETUP_TABS, setupIssues, tabOfCheckKey, tabsWithIssues, type SetupTab } from '../../modules/setupTabs'
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
import { computed, nextTick, ref } from 'vue'
import heroImage from '../../assets/home-card.png?url'

/**
 * Shell of the setup dialog: owns the draft (`useSetupDraft`) and composes one component per section into four tabs
 * (#161): Scenario (picker and detail), Vessels, Yard and equipment, Advanced. Only the tab body scrolls; a footer
 * pinned to the bottom holds the selected scenario's plain name, Cancel and Start. Each section exports its own
 * validation message (`../setup/*Validation.ts`); `modules/setupTabs.ts` places every problem on the tab that holds
 * its field, where it is listed, and marks that tab.
 */
const store = useTwinStore()
const d = provideSetupDraft()
const form = ref<HTMLFormElement | null>(null)
const tab = ref<SetupTab>('scenario')
/** The tab holding the input the browser rejected (min, max, required) on the last Start, until every input is valid again. */
const invalidInputTab = ref<SetupTab | null>(null)

const TAB_LABELS: Record<SetupTab, MessageKey> = {
  scenario: 'setup.section.scenario',
  vessels: 'setup.section.vessels',
  yard: 'setup.section.yard',
  advanced: 'setup.section.advanced',
}

/** Every problem, live, each on its tab (in the order Start checks them). */
const issues = computed(() => {
  const end = d.endEdited ? endConditionsFromFields(d.endFields, d.vessels.length) : null
  return setupIssues({
    layout: validateLayout(d),
    checkErrors: d.check.errors.map((e) => ({ key: e.key, message: t(e.key, e.params) })),
    sts: validateSts(d),
    shc: validateShc(d),
    yard: validateYard(d),
    end: end && !end.ok ? t(end.error) : null,
  })
})
const warnings = computed(() => d.check.warnings.map((w) => ({ tab: tabOfCheckKey(w.key), message: t(w.key, w.params) })))
const marked = computed(() => tabsWithIssues(issues.value, invalidInputTab.value))
const markedLabels = computed(() => marked.value.map((id) => t(TAB_LABELS[id])).join(', '))
const selectedName = computed(() => scenarioDisplayName(d.name))

const issuesOn = (id: SetupTab) => issues.value.filter((i) => i.tab === id)
const warningsOn = (id: SetupTab) => warnings.value.filter((w) => w.tab === id)

function tabOf(el: Element): SetupTab | null {
  const id = el.closest<HTMLElement>('[data-setup-tab]')?.dataset.setupTab
  return SETUP_TABS.find((x) => x === id) ?? null
}

const INVALID_INPUT = 'input:invalid, select:invalid'

/** Clears the invalid-input mark once the browser accepts every input again. */
function recheckInputs(): void {
  if (invalidInputTab.value && !form.value?.querySelector(INVALID_INPUT)) invalidInputTab.value = null
}

/**
 * Start (also Enter in a field). The form is `novalidate` because the browser cannot show its message on an input in
 * a hidden tab: the first rejected input's tab opens and the browser reports it there. Else the first problem's tab
 * opens, where the problem is listed.
 */
async function submit(): Promise<void> {
  const bad = form.value?.querySelector<HTMLInputElement | HTMLSelectElement>(INVALID_INPUT)
  if (bad) {
    invalidInputTab.value = tabOf(bad)
    if (invalidInputTab.value) tab.value = invalidInputTab.value
    await nextTick()
    bad.reportValidity()
    return
  }
  invalidInputTab.value = null
  const first = issues.value[0]
  const startAt = d.startDate
  if (first || !startAt) {
    tab.value = first?.tab ?? 'advanced'
    return
  }
  const end = d.endEdited ? endConditionsFromFields(d.endFields, d.vessels.length) : null
  await store
    .startScenario({
      endConditions: end?.ok ? end.value : undefined,
      name: d.name,
      seed: d.seed,
      startDateTime: startAt.toISOString(),
      overrides: d.edits.overrides,
      shc: d.edits.shc,
      yard: d.edits.yard,
    })
    .catch(() => {})
}

/** Left and right arrows move between the tabs (WAI-ARIA tabs pattern). */
function onTabKey(e: KeyboardEvent, id: SetupTab): void {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = SETUP_TABS[(SETUP_TABS.indexOf(id) + step + SETUP_TABS.length) % SETUP_TABS.length]
  tab.value = next
  void nextTick(() => form.value?.querySelector<HTMLElement>(`#tt-setup-tab-${next}`)?.focus())
}
</script>

<template>
  <div class="backdrop">
    <form
      ref="form"
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tt-setup-title"
      novalidate
      @submit.prevent="submit"
      @input="recheckInputs"
      @change="recheckInputs"
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

      <div
        class="tabs"
        role="tablist"
        :aria-label="t('setup.sections')"
      >
        <button
          v-for="id in SETUP_TABS"
          :id="`tt-setup-tab-${id}`"
          :key="id"
          type="button"
          role="tab"
          class="tab"
          :class="{ on: tab === id, bad: marked.includes(id) }"
          :aria-selected="tab === id"
          :aria-controls="`tt-setup-panel-${id}`"
          :aria-label="marked.includes(id) ? t('setup.section.hasError', { tab: t(TAB_LABELS[id]) }) : undefined"
          :tabindex="tab === id ? 0 : -1"
          :data-testid="`tt-setup-tab-${id}`"
          :data-has-error="marked.includes(id) || undefined"
          @click="tab = id"
          @keydown="onTabKey($event, id)"
        >
          {{ t(TAB_LABELS[id]) }}
          <TtIcon
            v-if="marked.includes(id)"
            name="alert"
          />
        </button>
      </div>

      <div
        class="body"
        data-testid="tt-setup-body"
      >
        <section
          v-for="id in SETUP_TABS"
          v-show="tab === id"
          :id="`tt-setup-panel-${id}`"
          :key="id"
          class="panel"
          :class="`panel-${id}`"
          role="tabpanel"
          :aria-labelledby="`tt-setup-tab-${id}`"
          :data-setup-tab="id"
          :data-testid="id === 'advanced' ? 'tt-advanced' : `tt-setup-panel-${id}`"
        >
          <ul
            v-if="issuesOn(id).length || warningsOn(id).length"
            class="checks"
            :data-testid="`tt-setup-issues-${id}`"
          >
            <li
              v-for="(e, i) in issuesOn(id)"
              :key="`e${i}`"
              class="error"
            >
              <TtIcon name="alert" /> {{ e.message }}
            </li>
            <li
              v-for="(w, i) in warningsOn(id)"
              :key="`w${i}`"
              class="warning"
            >
              <TtIcon name="warn" /> {{ w.message }}
            </li>
          </ul>

          <ScenarioPicker v-if="id === 'scenario'">
            <ScenarioDetail />
          </ScenarioPicker>

          <SetupVesselsSection v-else-if="id === 'vessels'" />

          <div
            v-else-if="id === 'yard'"
            class="sections"
          >
            <SetupLayoutSection />
            <SetupStsSection />
            <SetupLandsideSection />
            <SetupShcSection />
            <SetupYardSection />
            <SetupModesSection />
          </div>

          <div
            v-else
            class="sections"
          >
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
            <SetupDisplaySection />
            <SetupDecisionsSection />
          </div>
        </section>
      </div>

      <footer
        class="footer"
        data-testid="tt-setup-footer"
      >
        <div class="selected">
          <span class="selected-label">{{ t('setup.footer.selected') }}</span>
          <strong
            class="selected-name"
            data-testid="tt-setup-footer-name"
            :data-scenario="d.name"
          >{{ selectedName }}</strong>
          <span
            v-if="marked.length"
            class="footer-error"
            data-testid="tt-setup-footer-fix"
          >
            <TtIcon name="alert" /> {{ t('setup.footer.fix', { tabs: markedLabels }) }}
          </span>
          <span
            v-else-if="store.error"
            class="footer-error"
            data-testid="tt-setup-error"
          >
            <TtIcon name="alert" /> {{ store.error }}
          </span>
        </div>
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
            class="start"
            data-testid="tt-setup-start-button"
            :disabled="store.loading || d.check.errors.length > 0"
          >
            {{ store.loading ? t('setup.starting') : t('setup.startButton') }}
          </button>
        </div>
      </footer>
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

/* About 90% of the sim area wide (max 1440 px) and capped to its height: the dialog itself never scrolls (#161). */
.dialog {
  width: min(90vw, 1440px, 100%);
  height: min(100%, 64rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  overflow: hidden;
  background: var(--tt-surface-sunken);
}

.hero-img {
  display: block;
  width: 100%;
  height: 9rem;
  object-fit: cover;
  object-position: 50% 40%;
}

.hero-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.8rem 1.5rem;
  border-width: 0 0 1px;
}

.hero:not(.compact) .hero-text {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

@media (min-height: 960px) {
  .hero-img {
    height: 13rem;
  }
}

/* Short screens and phones: no picture, so the tab body keeps the room. */
@media (max-height: 820px), (max-width: 760px) {
  .hero-img {
    display: none;
  }

  .hero:not(.compact) .hero-text {
    position: static;
  }
}

.kicker {
  color: var(--tt-accent);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h2 {
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.intro {
  color: var(--tt-text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

@media (max-width: 760px) {
  .intro {
    display: none;
  }

  .hero-text {
    padding: 0.6rem 1rem;
  }

  h2 {
    font-size: 1.15rem;
  }
}

.tabs {
  flex: none;
  display: flex;
  gap: 0.25rem;
  padding: 0 1.5rem;
  border-bottom: 1px solid var(--tt-border);
  overflow-x: auto;
  scrollbar-width: none;
}

.tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.7rem 1rem;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  color: var(--tt-text-muted);
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.tab:hover {
  color: var(--tt-text);
}

.tab:focus-visible {
  outline: none;
  box-shadow: inset var(--tt-ring);
}

.tab.on {
  color: var(--tt-accent);
  border-bottom-color: var(--tt-accent);
}

.tab.bad,
.tab.bad.on {
  color: var(--tt-danger);
}

.tab.bad.on {
  border-bottom-color: var(--tt-danger);
}

/* Phone: the four tabs share the width, long labels wrap. */
@media (max-width: 480px) {
  .tabs {
    padding: 0 0.4rem;
    gap: 0;
  }

  .tab {
    flex: 1 1 0;
    justify-content: center;
    padding: 0.5rem 0.25rem;
    font-size: 0.8rem;
    line-height: 1.2;
    text-align: center;
    white-space: normal;
  }
}

/* The only part that scrolls. */
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.5rem;
}

@media (max-width: 480px) {
  .body {
    padding: 0.8rem;
  }
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Wide: the picker fills the Scenario tab, its list and detail scroll on their own. */
@media (min-width: 761px) {
  .panel-scenario {
    height: 100%;
  }

  .panel-scenario > :last-child {
    flex: 1;
    min-height: 0;
  }
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}

.footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  border-top: 1px solid var(--tt-border);
  background: var(--tt-surface-sunken);
}

@media (max-width: 480px) {
  .footer {
    padding: 0.6rem 0.8rem;
    gap: 0.6rem;
  }
}

.selected {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.selected-label {
  color: var(--tt-text-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.selected-name {
  overflow: hidden;
  font-size: 0.95rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-error {
  overflow: hidden;
  color: var(--tt-danger);
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.buttons {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn {
  padding: 0.55rem 0.9rem;
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

.start {
  padding: 0.65rem 2.2rem;
  background: var(--tt-accent);
  border: 1px solid var(--tt-accent);
  border-radius: var(--tt-radius);
  color: var(--tt-on-accent);
  font-size: 1rem;
  font-weight: 700;
}

@media (max-width: 480px) {
  .start {
    padding: 0.6rem 1.4rem;
  }
}

.start:hover:not(:disabled) {
  background: var(--tt-accent-hover);
}

.start:disabled {
  opacity: 0.5;
}

.checks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0;
  margin: 0;
}

.error {
  color: var(--tt-danger);
  font-size: 0.85rem;
}

.warning {
  color: var(--tt-warn);
  font-size: 0.85rem;
}
</style>
