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
import SetupStrictChecks from '../setup/SetupStrictChecks.vue'
import SetupDecisionsSection from '../setup/SetupDecisionsSection.vue'
import { validateLayout } from '../setup/layoutValidation'
import { validateSts } from '../setup/stsValidation'
import { validateShc } from '../setup/shcValidation'
import { validateYard } from '../setup/yardValidation'
import { computed, nextTick, ref } from 'vue'
import heroImage from '../../assets/home-card.png?url'

/**
 * Shell of the setup dialog: owns the draft (`useSetupDraft`) and composes one component per section into four tabs
 * (#161): Scenario (picker and detail), Vessels, Yard and equipment, Advanced. On a wide screen the title and the
 * tabs are a rail down the left side and the open tab fills the rest; on a narrow one they stack. Only the tab body
 * scrolls; a footer pinned to the bottom holds the selected scenario's plain name, Cancel and Start. Each section exports its own
 * validation message (`../setup/*Validation.ts`); `modules/setupTabs.ts` places every problem on the tab that holds
 * its field, where it is listed, and marks that tab.
 */
const store = useTwinStore()
const d = provideSetupDraft()
const form = ref<HTMLFormElement | null>(null)
const tab = ref<SetupTab>('scenario')
/** The tab holding the input the browser rejected (min, max, required) on the last Start, until every input is valid again. */
const invalidInputTab = ref<SetupTab | null>(null)

const TAB_ICONS: Record<SetupTab, 'target' | 'ship' | 'grid' | 'sliders'> = {
  scenario: 'target',
  vessels: 'ship',
  yard: 'grid',
  advanced: 'sliders',
}

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

/** Arrow keys move between the tabs (WAI-ARIA tabs pattern; the tabs are a column on a wide screen, a row on a phone). */
function onTabKey(e: KeyboardEvent, id: SetupTab): void {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = SETUP_TABS[(SETUP_TABS.indexOf(id) + step + SETUP_TABS.length) % SETUP_TABS.length]
  tab.value = next
  void nextTick(() => form.value?.querySelector<HTMLElement>(`#tt-setup-tab-${next}`)?.focus())
}
</script>

<template>
  <div
    class="backdrop"
    :class="{ first: !store.hasScenario }"
  >
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
        <div class="hero-text">
          <p class="kicker">
            <span class="mark"><TtIcon name="logo" /></span>
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
          <TtIcon
            class="tab-icon"
            :name="TAB_ICONS[id]"
          />
          <span class="tab-label">{{ t(TAB_LABELS[id]) }}</span>
          <TtIcon
            v-if="marked.includes(id)"
            class="tab-alert"
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
            <SetupStrictChecks />
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
            <TtIcon name="arrow" />
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
  padding: 1.25rem;
  background: var(--tt-scrim);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
}

/* First visit: nothing is running behind the dialog, so the terminal picture fills the screen under the scrim. */
.backdrop.first {
  background:
    linear-gradient(var(--tt-scrim), var(--tt-scrim)),
    url('../../assets/home-card.png') center / cover no-repeat,
    var(--tt-bg);
}

/* A rail (title, tabs) beside the open tab. Capped to the sim area: the dialog itself never scrolls (ticket 161). */
.dialog {
  width: min(94vw, 1360px, 100%);
  height: min(100%, 56rem);
  display: grid;
  grid-template-columns: 17.5rem minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'hero body'
    'tabs body'
    'tabs footer';
  overflow: hidden;
  background: var(--tt-surface);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-lg);
  box-shadow: var(--tt-shadow-lg);
  font-family: var(--tt-font);
  color: var(--tt-text);
}

.hero {
  grid-area: hero;
  position: relative;
  overflow: hidden;
  background: var(--tt-surface-sunken);
  border-right: 1px solid var(--tt-border);
}

.hero-img {
  display: block;
  width: 100%;
  height: 8.5rem;
  object-fit: cover;
  object-position: 32% 40%;
  -webkit-mask-image: linear-gradient(to bottom, black 35%, transparent);
  mask-image: linear-gradient(to bottom, black 35%, transparent);
}

.hero-text {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1.4rem 1.4rem 1rem;
}

.hero:not(.compact) .hero-text {
  margin-top: -2.2rem;
}

.kicker {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--tt-text-muted);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.09em;
  line-height: 1.35;
  text-transform: uppercase;
}

.mark {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9px;
  background: var(--tt-accent);
  color: var(--tt-on-accent);
  font-size: 1.05rem;
  box-shadow: var(--tt-glow);
}

h2 {
  margin-top: 0.35rem;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.intro {
  color: var(--tt-text-muted);
  font-size: var(--tt-text-sm);
  line-height: 1.55;
}

.tabs {
  grid-area: tabs;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.8rem 1rem;
  background: var(--tt-surface-sunken);
  border-right: 1px solid var(--tt-border);
  overflow: auto;
  scrollbar-width: none;
}

.tab {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.65rem 0.75rem;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--tt-radius);
  color: var(--tt-text-muted);
  font: inherit;
  font-size: var(--tt-text-md);
  font-weight: 550;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.12s var(--tt-ease),
    color 0.12s var(--tt-ease);
}

.tab-icon {
  font-size: 1.1rem;
}

.tab-label {
  flex: 1;
  min-width: 0;
}

.tab:hover {
  background: var(--tt-control);
  color: var(--tt-text);
}

.tab:focus-visible {
  outline: none;
  box-shadow: var(--tt-ring);
}

.tab.on {
  background: var(--tt-accent-soft);
  border-color: var(--tt-accent-line);
  color: var(--tt-text);
}

.tab.on .tab-icon {
  color: var(--tt-accent);
}

.tab.bad .tab-alert,
.tab.bad .tab-label {
  color: var(--tt-danger);
}

.tab.bad.on {
  background: var(--tt-danger-bg);
  border-color: var(--tt-danger-border);
}

/* The only part that scrolls. */
.body {
  grid-area: body;
  min-height: 0;
  overflow: auto;
  padding: 1.5rem 1.75rem;
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

/* One card per section, in a readable column. */
.sections {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 68rem;
}

.sections > :not(.hint) {
  padding: 1.15rem 1.25rem 1.25rem;
  background: var(--tt-surface-raised);
  border: 1px solid var(--tt-hairline);
  border-radius: var(--tt-radius);
}

.footer {
  grid-area: footer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.75rem;
  border-top: 1px solid var(--tt-border);
  background: var(--tt-surface-sunken);
}

.selected {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.selected-label {
  color: var(--tt-text-faint);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.selected-name {
  overflow: hidden;
  font-size: 1rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-error {
  overflow: hidden;
  color: var(--tt-danger);
  font-size: var(--tt-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.buttons {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.btn {
  height: 2.6rem;
  padding: 0 1.1rem;
  background: var(--tt-control);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius);
  color: var(--tt-text);
  font-size: var(--tt-text-md);
  font-weight: 550;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  background: var(--tt-control-hover);
  border-color: var(--tt-border-strong);
}

.start {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  height: 2.6rem;
  padding: 0 1.4rem 0 1.6rem;
  background: var(--tt-accent);
  border: 1px solid var(--tt-accent);
  border-radius: var(--tt-radius);
  color: var(--tt-on-accent);
  font-size: 0.95rem;
  font-weight: 700;
  box-shadow: var(--tt-glow);
  transition:
    background 0.12s var(--tt-ease),
    transform 0.12s var(--tt-ease);
}

.start:hover:not(:disabled) {
  background: var(--tt-accent-hover);
}

.start:active:not(:disabled) {
  transform: translateY(1px);
}

.start:disabled {
  opacity: 0.45;
  box-shadow: none;
}

.checks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0;
  margin: 0;
  max-width: 68rem;
}

.error,
.warning {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.8rem;
  border: 1px solid var(--tt-danger-border);
  border-radius: var(--tt-radius-sm);
  background: var(--tt-danger-bg);
  color: var(--tt-danger);
  font-size: var(--tt-text-sm);
}

.warning {
  border-color: var(--tt-warn-border);
  background: var(--tt-warn-bg);
  color: var(--tt-warn);
}

/* Short screens: no picture, so the rail keeps room for the tabs. */
@media (max-height: 760px) {
  .hero-img {
    display: none;
  }

  .hero:not(.compact) .hero-text {
    margin-top: 0;
  }
}

/* Narrow screens and phones: title, a row of tabs, the tab body and the footer, stacked. */
@media (max-width: 900px) {
  .backdrop {
    padding: 0.6rem;
  }

  .dialog {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    grid-template-areas:
      'hero'
      'tabs'
      'body'
      'footer';
  }

  .hero,
  .tabs {
    border-right: none;
  }

  .hero-img,
  .intro {
    display: none;
  }

  .hero:not(.compact) .hero-text {
    margin-top: 0;
  }

  .hero-text {
    padding: 0.8rem 1rem 0.4rem;
  }

  h2 {
    margin-top: 0;
    font-size: 1.2rem;
  }

  .mark {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 7px;
    font-size: 0.85rem;
  }

  .tabs {
    flex-direction: row;
    padding: 0.4rem 0.6rem 0.6rem;
    border-bottom: 1px solid var(--tt-border);
  }

  .tab {
    padding: 0.5rem 0.7rem;
    white-space: nowrap;
  }

  .body {
    padding: 1rem;
  }

  .footer {
    padding: 0.7rem 1rem;
  }
}

/* Phone: the four tabs share the width, icons go, long labels wrap. */
@media (max-width: 480px) {
  .tabs {
    padding: 0.3rem 0.4rem 0.5rem;
    gap: 0.1rem;
  }

  .tab {
    flex: 1 1 0;
    justify-content: center;
    padding: 0.45rem 0.25rem;
    font-size: 0.8rem;
    line-height: 1.2;
    text-align: center;
    white-space: normal;
  }

  .tab-icon {
    display: none;
  }

  .tab-label {
    flex: 0 1 auto;
  }

  .body {
    padding: 0.8rem;
  }

  .footer {
    padding: 0.6rem 0.8rem;
    gap: 0.6rem;
  }

  .start {
    padding: 0 1rem 0 1.2rem;
  }
}
</style>
