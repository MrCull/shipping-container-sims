<script setup lang="ts">
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import VesselTable from './VesselTable.vue'

const d = useSetupDraft()
</script>

<template>
  <fieldset class="field">
    <legend>{{ t('setup.vessels') }}</legend>
    <VesselTable
      v-model="d.vessels"
      :start-date-time="d.startDate"
    />
  </fieldset>

  <fieldset
    class="field"
    data-testid="tt-flows"
  >
    <legend>{{ t('setup.flows.title') }}</legend>
    <p class="hint">
      {{ t('setup.flows.hint') }}
    </p>
    <div class="grid">
      <label>
        <span>{{ t('setup.flows.dwellMedianH') }}</span>
        <input
          v-model.number="d.dwellMedianH"
          type="number"
          min="0.1"
          step="any"
          name="dwellMedianH"
        >
      </label>
      <label>
        <span>{{ t('setup.flows.poolCount') }}</span>
        <input
          v-model.number="d.poolCount"
          type="number"
          min="0"
          step="1"
          name="poolCount"
        >
      </label>
      <label>
        <span>{{ t('setup.flows.poolAgeDays') }}</span>
        <input
          v-model.number="d.poolAgeDays"
          type="number"
          min="0"
          step="any"
          name="poolAgeDays"
        >
      </label>
    </div>
  </fieldset>
</template>

<style scoped src="./setupSection.css"></style>
