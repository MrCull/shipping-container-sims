<script setup lang="ts">
import { SCALE_LIMITS } from '../../scenario/limits'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'

const d = useSetupDraft()
</script>

<template>
  <fieldset
    v-if="d.scenarioHasLandside"
    class="field"
    data-testid="tt-landside"
  >
    <legend>{{ t('setup.landside.title') }}</legend>
    <div class="grid">
      <label class="mini">
        <span>{{ t('setup.landside.peakTrucks') }}</span>
        <input
          v-model.number="d.peakTrucks"
          type="number"
          min="0"
          :max="SCALE_LIMITS.trucksPerHour"
          step="1"
          name="peak-trucks"
          data-testid="tt-peak-trucks"
        >
      </label>
      <label class="mini">
        <span>{{ t('setup.landside.gateIn') }}</span>
        <input
          v-model.number="d.gateIn"
          type="number"
          min="1"
          max="12"
          step="1"
          name="gate-in"
        >
      </label>
      <label class="mini">
        <span>{{ t('setup.landside.gateOut') }}</span>
        <input
          v-model.number="d.gateOut"
          type="number"
          min="1"
          max="12"
          step="1"
          name="gate-out"
        >
      </label>
    </div>
  </fieldset>
</template>

<style scoped src="./setupSection.css"></style>
