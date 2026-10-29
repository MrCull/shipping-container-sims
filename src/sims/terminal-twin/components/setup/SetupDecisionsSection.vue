<script setup lang="ts">
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import DecisionSettings from './DecisionSettings.vue'

const d = useSetupDraft()
</script>

<template>
  <fieldset class="field">
    <legend>{{ t('setup.decisions.title') }}</legend>
    <details data-testid="tt-decisions-details">
      <summary>{{ t('setup.decisions.summary') }}</summary>
      <DecisionSettings v-model="d.decisions" />
    </details>
  </fieldset>
</template>

<style scoped src="./setupSection.css"></style>
