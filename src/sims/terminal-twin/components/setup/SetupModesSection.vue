<script setup lang="ts">
import { MODES, MODE_ROWS, useSetupDraft } from '../../composables/useSetupDraft'
import { t } from '../../i18n/messages'

const d = useSetupDraft()
</script>

<template>
  <fieldset
    class="field"
    data-testid="tt-subsystem-modes"
  >
    <legend>{{ t('setup.modes.title') }}</legend>
    <p class="hint">
      {{ t('setup.modes.note') }}
    </p>
    <div
      v-for="row in MODE_ROWS"
      :key="row"
      class="grid"
      role="radiogroup"
      :aria-label="t(`setup.modes.${row}`)"
    >
      <span class="blockname">{{ t(`setup.modes.${row}`) }}</span>
      <label
        v-for="m in MODES"
        :key="m"
        class="unit-choice"
      >
        <input
          v-model="d.modes[row]"
          type="radio"
          :name="`mode-${row}`"
          :value="m"
          :data-testid="`tt-mode-${row}-${m}`"
        >
        {{ t(`setup.modes.${m}`) }}
      </label>
    </div>
  </fieldset>
</template>

<style scoped src="./setupSection.css"></style>
