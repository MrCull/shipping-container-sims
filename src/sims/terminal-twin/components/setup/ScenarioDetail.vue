<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { useTwinStore } from '../../store/twinStore'
import { TTI_DERIVED_BAYS_PRESETS } from '../../scenario/presets'
import { presetCopy } from '../../modules/scenarioPicker'

/** Detail panel of the selected scenario (TT-R04): description, key figures and the one prominent Start button. */
defineProps<{ error: string | null }>()

const d = useSetupDraft()
const store = useTwinStore()

/** The preset's bay count comes from a published capacity, not a layout drawing: say so. */
const derivedBaysNote = computed(() => TTI_DERIVED_BAYS_PRESETS.includes(d.name))

const description = computed(() => {
  const copy = presetCopy(d.name)
  return copy ? t(copy.description) : (d.selected?.description ?? '')
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
    :aria-label="t('setup.detail.title')"
  >
    <div class="head">
      <h3 data-testid="tt-detail-name">
        {{ d.name }}
      </h3>
      <button
        type="submit"
        class="start"
        :disabled="store.loading || d.check.errors.length > 0"
      >
        {{ store.loading ? t('setup.starting') : t('setup.startButton') }}
      </button>
    </div>
    <p class="hint">
      {{ description }}
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
    <p
      v-if="error || store.error"
      class="error"
    >
      {{ error ?? store.error }}
    </p>
  </section>
</template>

<style scoped src="./setupSection.css"></style>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.8rem 1rem;
  border: 1px solid var(--color-primary);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

h3 {
  font-size: 1.05rem;
  font-weight: 700;
}

.start {
  padding: 0.65rem 2.2rem;
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: 8px;
  color: var(--color-text);
  font-size: 1rem;
  font-weight: 700;
}

.start:disabled {
  opacity: 0.5;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem 1rem;
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

.error {
  color: var(--color-danger);
  font-size: 0.85rem;
}
</style>
