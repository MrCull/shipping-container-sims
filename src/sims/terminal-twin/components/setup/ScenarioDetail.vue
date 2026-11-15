<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { resolveScenario, useTwinStore } from '../../store/twinStore'
import { terminalPresetInfo } from '../../terminals'
import { layoutSketch, pickerModel, scenarioDisplayName, scenarioDurationS, scenarioStats, statChips } from '../../modules/scenarioPicker'
import LayoutSketchView from './LayoutSketch.vue'

/**
 * Detail pane of the selected scenario or test bench (start screen, #145): plain name, what it shows and what to
 * watch for, the layout sketch, stat chips, size of the run and the set-up facts. Start sits in the setup dialog's pinned
 * footer (#161). No technical id is shown (#156): it stays in `data-scenario` on the pane.
 */

const d = useSetupDraft()
const store = useTwinStore()

const item = computed(() => {
  const model = pickerModel(d.catalogue)
  return [...model.scenarios, ...model.benches.flatMap((g) => g.items)].find((i) => i.id === d.name) ?? null
})
const isBench = computed(() => item.value?.section === 'benches')

/** The preset's bay count comes from a published capacity, not a layout drawing: say so. */
const derivedBaysNote = computed(() => terminalPresetInfo(d.name)?.derivedBays === true)

/** The chosen scenario as shipped (not as edited): its sketch, chips and run length. */
const base = computed(() => {
  try {
    return resolveScenario(d.name)
  } catch {
    return null
  }
})
const sketch = computed(() => (base.value ? layoutSketch(base.value) : null))
const chips = computed(() => (base.value ? statChips(scenarioStats(base.value)).map((chip) => ({ id: chip.id, label: t(chip.key, { value: chip.value }) })) : []))
const size = computed(() => {
  const config = base.value
  if (!config) return ''
  const duration = store.fmt.duration(scenarioDurationS(config))
  return config.vessels.length === 1
    ? t('setup.detail.sizeValueOne', { duration })
    : t('setup.detail.sizeValue', { vessels: config.vessels.length, duration })
})

/** Key figures of the scenario as edited, in the chosen units (the config itself stays SI). */
const summary = computed(() => {
  const config = d.draftConfig
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
</script>

<template>
  <section
    class="detail"
    data-testid="tt-scenario-detail"
    :data-scenario="d.name"
    :aria-label="t('setup.detail.title')"
  >
    <header class="head">
      <span class="kind">{{ isBench ? t('setup.kind.bench') : t('setup.kind.scenario') }}</span>
      <h3 data-testid="tt-detail-name">
        {{ item?.name ?? scenarioDisplayName(d.name) }}
      </h3>
      <p
        v-if="item?.summary"
        class="lead"
      >
        {{ item.summary }}
      </p>
    </header>

    <LayoutSketchView
      v-if="sketch"
      :sketch="sketch"
    />
    <ul
      v-if="chips.length"
      class="chips"
    >
      <li
        v-for="chip in chips"
        :key="chip.id"
        class="chip"
        :data-testid="`tt-chip-${chip.id}`"
      >
        {{ chip.label }}
      </li>
    </ul>

    <section class="block">
      <h4>{{ t('setup.detail.shows') }}</h4>
      <p
        class="text"
        data-testid="tt-detail-description"
      >
        {{ item?.description ?? d.selected?.description ?? '' }}
      </p>
    </section>
    <section
      v-if="item?.watch"
      class="block"
    >
      <h4>{{ t('setup.detail.watch') }}</h4>
      <p
        class="text"
        data-testid="tt-detail-watch"
      >
        {{ item.watch }}
      </p>
    </section>
    <section
      v-if="size"
      class="block"
    >
      <h4>{{ t('setup.detail.size') }}</h4>
      <p
        class="text"
        data-testid="tt-detail-size"
      >
        {{ size }}
      </p>
    </section>
    <p
      v-if="derivedBaysNote"
      class="hint"
      data-testid="tt-bays-assumption"
    >
      {{ t('setup.preset.baysAssumption') }}
    </p>

    <section
      v-if="summary.length"
      class="block"
    >
      <h4>{{ t('setup.detail.facts') }}</h4>
      <dl
        class="summary"
        :aria-label="t('setup.summary')"
        data-testid="tt-setup-summary"
      >
        <div
          v-for="entry in summary"
          :key="entry.testid"
          class="summary-item"
        >
          <dt>{{ entry.label }}</dt>
          <dd :data-testid="`tt-summary-${entry.testid}`">
            {{ entry.value }}
          </dd>
        </div>
      </dl>
    </section>
  </section>
</template>

<style scoped src="./setupSection.css"></style>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  min-width: 0;
  padding: 1.4rem 1.5rem 1.5rem;
  border: 1px solid var(--tt-hairline);
  border-radius: var(--tt-radius);
  background: var(--tt-surface-raised);
  scrollbar-width: thin;
}

/* The pane may scroll on its own (wide Scenario tab): its parts keep their size. */
.detail > * {
  flex: none;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.kind {
  align-self: flex-start;
  padding: 0.15rem 0.55rem;
  border: 1px solid var(--tt-accent-line);
  border-radius: 999px;
  color: var(--tt-accent);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h3 {
  margin-top: 0.2rem;
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

h4 {
  margin-bottom: 0.35rem;
  color: var(--tt-text-faint);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.lead {
  color: var(--tt-text-muted);
  font-size: 1rem;
  line-height: 1.45;
}

.text {
  max-width: 70ch;
  font-size: var(--tt-text-md);
  line-height: 1.6;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  padding: 0;
  margin: 0;
}

.chip {
  padding: 0.3rem 0.7rem;
  background: var(--tt-control);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
  color: var(--tt-text);
  font-family: var(--tt-font-mono);
  font-size: var(--tt-text-sm);
  font-variant-numeric: tabular-nums;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  overflow: hidden;
  background: var(--tt-border);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
}

@media (max-width: 560px) {
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.65rem 0.8rem;
  background: var(--tt-surface-sunken);
}

.summary dt {
  color: var(--tt-text-muted);
  font-size: var(--tt-text-xs);
}

.summary dd {
  margin: 0;
  font-family: var(--tt-font-mono);
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}
</style>
