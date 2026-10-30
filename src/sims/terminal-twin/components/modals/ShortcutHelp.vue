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
  background: rgba(10, 14, 26, 0.6);
}

.help {
  width: min(28rem, 100%);
  max-height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1.2rem 1.4rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  color: var(--color-text);
  font-family: var(--font-body);
}

h2 {
  font-size: 1.1rem;
  font-weight: 700;
}

table {
  border-collapse: collapse;
  font-size: 0.85rem;
}

th {
  width: 5.5rem;
  padding: 0.3rem 0.8rem 0.3rem 0;
  text-align: left;
  font-weight: 400;
}

td {
  padding: 0.3rem 0;
  color: var(--color-text);
}

kbd {
  display: inline-block;
  min-width: 1.6rem;
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--color-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--color-bg);
  font-family: var(--tt-font-mono);
  font-size: 0.78rem;
  text-align: center;
}

.note {
  color: var(--color-text-muted);
  font-size: 0.78rem;
}

.buttons {
  display: flex;
  justify-content: flex-end;
}

.btn {
  padding: 0.4rem 0.9rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.85rem;
}

.btn:hover {
  border-color: var(--color-primary);
}
</style>
