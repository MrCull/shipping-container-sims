<script setup lang="ts">
import TtIcon from '../ui/TtIcon.vue'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import LocaleDateTimeInput from '../LocaleDateTimeInput.vue'

/** Seed and start date/time of the run (shown under the dialog's Advanced section). */
const d = useSetupDraft()
</script>

<template>
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
          <TtIcon name="refresh" /> {{ t('setup.reroll') }}
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
</template>

<style scoped src="./setupSection.css"></style>

<style scoped>
.seed {
  display: flex;
  gap: 0.4rem;
}

.seed input {
  flex: 1;
}

.btn {
  padding: 0.45rem 0.9rem;
  background: var(--tt-bg);
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  color: var(--tt-text);
  font-size: 0.85rem;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  border-color: var(--tt-accent);
}
</style>
