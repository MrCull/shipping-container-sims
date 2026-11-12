<script setup lang="ts">
import { t } from '../../i18n/messages'
import { useTwinStore } from '../../store/twinStore'

const store = useTwinStore()
</script>

<template>
  <fieldset class="field">
    <legend>{{ t('setup.strictChecks') }}</legend>
    <label class="unit-choice">
      <input
        type="checkbox"
        name="tt-strict-checks"
        data-testid="tt-strict-checks"
        :checked="store.strictChecks"
        @change="store.setStrictChecks(($event.target as HTMLInputElement).checked)"
      >
      {{ t('setup.strictChecks') }}
    </label>
    <p class="hint">
      {{ t('setup.strictChecksHint') }}
    </p>
  </fieldset>
</template>

<style scoped src="./setupSection.css"></style>
