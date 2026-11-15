<script setup lang="ts">
import { SHORTCUT_HELP } from '../../modules/shortcuts'
import { t } from '../../i18n/messages'
import { useTwinStore } from '../../store/twinStore'

const store = useTwinStore()
</script>

<template>
  <div
    class="backdrop"
    @click.self="store.setHelpOpen(false)"
  >
    <section
      class="help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tt-help-title"
      data-testid="tt-shortcut-help"
    >
      <h2 id="tt-help-title">
        {{ t('shortcuts.title') }}
      </h2>
      <table>
        <tbody>
          <tr
            v-for="row in SHORTCUT_HELP"
            :key="row.keys"
          >
            <th scope="row">
              <kbd>{{ t(row.keys) }}</kbd>
            </th>
            <td>{{ t(row.action) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        {{ t('shortcuts.inputsNote') }}
      </p>
      <div class="buttons">
        <button
          type="button"
          class="btn"
          @click="store.setHelpOpen(false)"
        >
          {{ t('shortcuts.close') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: var(--tt-scrim);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  animation: tt-fade 0.16s var(--tt-ease);
}

@keyframes tt-fade {
  from {
    opacity: 0;
  }
}

.help {
  width: min(30rem, 100%);
  max-height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.5rem 1.6rem;
  background: var(--tt-surface);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-lg);
  box-shadow: var(--tt-shadow-lg);
  color: var(--tt-text);
  font-family: var(--tt-font);
  scrollbar-width: thin;
}

h2 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}

table {
  border-collapse: collapse;
  font-size: var(--tt-text-md);
}

tr + tr {
  border-top: 1px solid var(--tt-hairline);
}

th {
  width: 6.5rem;
  padding: 0.45rem 0.8rem 0.45rem 0;
  text-align: left;
  font-weight: 400;
  white-space: nowrap;
}

td {
  padding: 0.45rem 0;
  color: var(--tt-text-muted);
}

kbd {
  display: inline-block;
  min-width: 1.7rem;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--tt-border-strong);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--tt-surface-raised);
  color: var(--tt-text);
  font-family: var(--tt-font-mono);
  font-size: 0.76rem;
  text-align: center;
}

.note {
  color: var(--tt-text-muted);
  font-size: var(--tt-text-sm);
}

.buttons {
  display: flex;
  justify-content: flex-end;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 2.1rem;
  padding: 0 0.85rem;
  background: var(--tt-control);
  border: 1px solid var(--tt-hairline);
  border-radius: var(--tt-radius-sm);
  color: var(--tt-text);
  font-size: var(--tt-text-sm);
  font-weight: 550;
  white-space: nowrap;
  transition:
    background 0.12s var(--tt-ease),
    border-color 0.12s var(--tt-ease);
}

.btn:hover:not(:disabled) {
  background: var(--tt-control-hover);
  border-color: var(--tt-border-strong);
}

.btn.primary {
  background: var(--tt-accent);
  border-color: var(--tt-accent);
  color: var(--tt-on-accent);
  font-weight: 650;
}

.btn.primary:hover:not(:disabled) {
  background: var(--tt-accent-hover);
  border-color: var(--tt-accent-hover);
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
