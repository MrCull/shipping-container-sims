<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { useTwinStore } from '../../store/twinStore'
import { LIMITS } from '../../scenario/overrides'
import { TTI_DERIVED_BAYS_PRESETS } from '../../scenario/presets'
import PlanPreview from './PlanPreview.vue'
import LocaleDateTimeInput from '../LocaleDateTimeInput.vue'

const d = useSetupDraft()
const store = useTwinStore()

/** The preset's bay count comes from a published capacity, not a layout drawing: say so. */
const derivedBaysNote = computed(() => TTI_DERIVED_BAYS_PRESETS.includes(d.name))

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
  <div class="layout">
    <fieldset class="field">
      <legend>{{ t('setup.scenario') }}</legend>
      <label
        v-for="c in d.catalogue"
        :key="c.name"
        class="choice"
        :class="{ active: c.name === d.name }"
      >
        <input
          v-model="d.name"
          type="radio"
          name="tt-scenario"
          :value="c.name"
        >
        <span class="choice-name">{{ c.name }}</span>
        <span class="choice-kind">{{ t(`setup.kind.${c.kind}`) }}</span>
      </label>
      <p
        v-if="d.selected"
        class="hint"
      >
        {{ d.selected.description }}
      </p>
      <p
        v-if="derivedBaysNote"
        class="hint"
        data-testid="tt-bays-assumption"
      >
        {{ t('setup.preset.baysAssumption') }}
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
            v-model.number="d.seed"
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
            @click="d.reroll()"
          >
            {{ t('setup.reroll') }}
          </button>
        </span>
      </label>
      <label class="field">
        <span>{{ t('setup.start') }}</span>
        <LocaleDateTimeInput
          v-model="d.start"
          name="start"
          required
          test-id="tt-setup-start"
        />
      </label>
    </div>

    <div class="row">
      <label class="field">
        <span>{{ t('setup.quayLength') }}</span>
        <input
          v-model.number="d.quayLengthM"
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
          v-model.number="d.stsCount"
          type="number"
          :min="LIMITS.sts.min"
          :max="LIMITS.sts.max"
          step="1"
          name="stsCount"
        >
      </label>
    </div>

    <fieldset class="field">
      <legend>{{ t('setup.plan.title') }}</legend>
      <PlanPreview :config="d.draftConfig" />
      <p
        v-if="d.isPreset"
        class="hint"
      >
        {{ t('setup.plan.derived') }}
      </p>
    </fieldset>
  </div>
</template>

<style scoped src="./setupSection.css"></style>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.choice-name {
  font-family: var(--tt-font-mono);
}

.choice-kind {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--color-text-muted);
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
</style>
