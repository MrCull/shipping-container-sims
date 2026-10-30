<script setup lang="ts">
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { LIMITS } from '../../scenario/overrides'
import PlanPreview from './PlanPreview.vue'

const d = useSetupDraft()
</script>

<template>
  <div class="layout">
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

</style>
