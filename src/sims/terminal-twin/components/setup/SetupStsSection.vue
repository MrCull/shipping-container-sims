<script setup lang="ts">
import { useSetupDraft } from '../../composables/useSetupDraft'
import { computed } from 'vue'
import { t } from '../../i18n/messages'

const d = useSetupDraft()
import { stsReadout } from './stsValidation'

const round2 = (n: number) => Math.round(n * 100) / 100
const speedUnit = computed(() => t(d.imperial ? 'unit.label.mih' : 'unit.label.kmh'))
type StsAxisKey = 'gantry' | 'trolley' | 'hoistLoaded' | 'hoistEmpty'
// Speeds in display units, kept in SI; the cycle is derived live.
const stsFields = computed(() => [
  { id: 'sts-v-gantry', label: t('setup.sts.gantrySpeed', { unit: speedUnit.value }), axis: 'gantry' as StsAxisKey },
  { id: 'sts-v-trolley', label: t('setup.sts.trolleySpeed', { unit: speedUnit.value }), axis: 'trolley' as StsAxisKey },
  { id: 'sts-v-hoist-loaded', label: t('setup.sts.hoistLoadedSpeed', { unit: speedUnit.value }), axis: 'hoistLoaded' as StsAxisKey },
  { id: 'sts-v-hoist-empty', label: t('setup.sts.hoistEmptySpeed', { unit: speedUnit.value }), axis: 'hoistEmpty' as StsAxisKey },
])
function setStsSpeed(axis: StsAxisKey, raw: string): void {
  d.stsK[axis].vMax = Number(raw) / d.speedFactor
}
const readout = computed(() => stsReadout(d))
</script>

<template>
  <fieldset
    class="field"
    data-testid="tt-sts-kinematics"
  >
    <legend>{{ t('setup.sts.title') }}</legend>
    <div class="grid">
      <label
        v-for="f in stsFields"
        :key="f.id"
        class="mini"
      >
        <span>{{ f.label }}</span>
        <input
          type="number"
          min="0"
          step="any"
          :name="f.id"
          :value="round2(d.stsK[f.axis].vMax * d.speedFactor)"
          @input="setStsSpeed(f.axis, ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="mini">
        <span>{{ t('setup.sts.lockUnlock') }}</span>
        <span class="pair">
          <input
            v-model.number="d.stsK.lockS"
            type="number"
            min="0"
            step="any"
            name="sts-lock"
            :aria-label="t('setup.sts.lockTime')"
          >
          <input
            v-model.number="d.stsK.unlockS"
            type="number"
            min="0"
            step="any"
            name="sts-unlock"
            :aria-label="t('setup.sts.unlockTime')"
          >
        </span>
      </label>
      <label class="mini">
        <span>{{ t('setup.sts.variationPct') }}</span>
        <input
          v-model.number="d.moveVariationPct"
          type="number"
          min="0"
          max="100"
          step="any"
          name="move-variation"
          data-testid="tt-move-variation"
        >
      </label>
      <label
        v-if="d.scenarioShcs > 0"
        class="mini"
      >
        <span>{{ t('setup.shc.driverVariabilityPct') }}</span>
        <input
          v-model.number="d.driverVariabilityPct"
          type="number"
          min="0"
          max="100"
          step="any"
          name="driver-variability"
          data-testid="tt-driver-variability"
        >
      </label>
    </div>
    <p
      v-if="readout"
      class="hint"
      data-testid="tt-sts-readout"
    >
      {{ readout }}
    </p>
  </fieldset>
</template>

<style scoped src="./setupSection.css"></style>
