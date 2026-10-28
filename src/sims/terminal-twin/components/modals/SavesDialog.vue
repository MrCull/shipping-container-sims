<script setup lang="ts">
import { ref } from 'vue'
import { useTwinStore } from '../../store/twinStore'
import { t } from '../../i18n/messages'

const store = useTwinStore()
const name = ref('')
const interval = ref(store.rewindIntervalMin)
const fileInput = ref<HTMLInputElement | null>(null)

function metaTime(savedAt: string): string {
  const d = store.fmt.dateTime(new Date(savedAt))
  return `${d.date} ${d.time}`
}

function simTime(s: number): string {
  return store.fmt.clock(store.choice.startDateTime, s).elapsed
}

function pointTime(s: number): string {
  const c = store.fmt.clock(store.choice.startDateTime, s)
  return `${c.time} · ${c.elapsed}`
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await store.importSaveText(await file.text())
}

async function jump(index: number): Promise<void> {
  await store.rewindTo(index).catch(() => {})
  store.closeSaves()
}

async function load(id: string): Promise<void> {
  const result = await store.loadSaved(id)
  if (result === 'loaded') store.closeSaves()
}

async function importAndClose(e: Event): Promise<void> {
  await onFile(e)
  if (store.savesMessage?.kind === 'info' && !store.versionPrompt) store.closeSaves()
}

async function applyInterval(): Promise<void> {
  if (interval.value > 0) await store.setRewindInterval(interval.value)
}
</script>

<template>
  <div
    class="backdrop"
    @click.self="store.closeSaves()"
  >
    <section
      class="saves"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tt-saves-title"
      data-testid="tt-saves-dialog"
    >
      <h2 id="tt-saves-title">
        {{ t('saves.title') }}
      </h2>

      <p
        v-if="store.storage === 'unavailable'"
        class="msg error"
        role="alert"
        data-testid="tt-saves-storage-warning"
      >
        {{ t('saves.storageUnavailable') }}
      </p>

      <div
        v-if="store.versionPrompt"
        class="msg warn"
        role="alert"
        data-testid="tt-version-warning"
      >
        <p>
          {{ t('saves.versionWarning', { name: store.versionPrompt.name, saved: store.versionPrompt.savedEngineVersion, current: store.versionPrompt.currentEngineVersion }) }}
        </p>
        <div class="row">
          <button
            type="button"
            class="btn primary"
            data-testid="tt-version-restart"
            @click="store.restartFromEmbeddedConfig().then(() => store.closeSaves())"
          >
            {{ t('saves.restartFromConfig') }}
          </button>
          <button
            type="button"
            class="btn"
            data-testid="tt-version-cancel"
            @click="store.dismissVersionPrompt()"
          >
            {{ t('saves.cancel') }}
          </button>
        </div>
      </div>

      <label class="field">
        <span>{{ t('saves.nameLabel') }}</span>
        <input
          v-model="name"
          type="text"
          data-testid="tt-save-name"
          :placeholder="t('saves.namePlaceholder')"
        >
      </label>
      <div class="row">
        <button
          type="button"
          class="btn primary"
          data-testid="tt-save-config"
          :disabled="store.storage === 'unavailable' || store.busy"
          :title="t('saves.saveConfigHint')"
          @click="store.saveToBrowser('config', name)"
        >
          {{ t('saves.saveConfig') }}
        </button>
        <button
          type="button"
          class="btn primary"
          data-testid="tt-save-snapshot"
          :disabled="store.storage === 'unavailable' || store.busy"
          :title="t('saves.saveSnapshotHint')"
          @click="store.saveToBrowser('snapshot', name)"
        >
          {{ t('saves.saveSnapshot') }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="tt-export-config"
          @click="store.exportToFile('config', name)"
        >
          {{ t('saves.exportConfig') }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="tt-export-snapshot"
          @click="store.exportToFile('snapshot', name)"
        >
          {{ t('saves.exportSnapshot') }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="tt-import-button"
          @click="fileInput?.click()"
        >
          {{ t('saves.importFile') }}
        </button>
        <input
          ref="fileInput"
          class="hidden"
          type="file"
          accept=".json,application/json"
          data-testid="tt-import-file"
          @change="importAndClose"
        >
      </div>

      <p
        v-if="store.savesMessage"
        class="msg"
        :class="store.savesMessage.kind"
        role="status"
        data-testid="tt-saves-message"
      >
        {{ store.savesMessage.text }}
      </p>

      <template v-if="store.storage !== 'unavailable'">
        <h3>{{ t('saves.listTitle') }}</h3>
        <p
          v-if="store.saves.length === 0"
          class="note"
        >
          {{ t('saves.empty') }}
        </p>
        <ul
          v-else
          class="list"
          data-testid="tt-saves-list"
        >
          <li
            v-for="s in store.saves"
            :key="s.id"
            data-testid="tt-saves-item"
          >
            <span class="kind">{{ t(`saves.type.${s.type}`) }}</span>
            <span class="label">{{ s.name }}</span>
            <span class="note">{{ metaTime(s.savedAt) }}<template v-if="s.simTimeS !== undefined"> · {{ t('saves.at', { time: simTime(s.simTimeS) }) }}</template></span>
            <button
              type="button"
              class="btn"
              data-testid="tt-save-load"
              @click="load(s.id)"
            >
              {{ t('saves.load') }}
            </button>
            <button
              type="button"
              class="btn"
              @click="store.exportSaved(s.id)"
            >
              {{ t('saves.export') }}
            </button>
            <button
              type="button"
              class="btn"
              data-testid="tt-save-delete"
              @click="store.deleteSaved(s.id)"
            >
              {{ t('saves.delete') }}
            </button>
          </li>
        </ul>
      </template>

      <h3>{{ t('rewind.title') }}</h3>
      <label class="field inline">
        <span>{{ t('rewind.intervalLabel') }}</span>
        <input
          v-model.number="interval"
          type="number"
          min="1"
          step="1"
          data-testid="tt-rewind-interval"
          @change="applyInterval"
        >
      </label>
      <p class="note">
        {{ t('rewind.intervalNote') }}
      </p>
      <p
        v-if="store.rewindPoints.length === 0"
        class="note"
      >
        {{ t('rewind.empty') }}
      </p>
      <div
        v-else
        class="points"
        data-testid="tt-rewind-points"
      >
        <button
          v-for="(p, i) in store.rewindPoints"
          :key="p.t"
          type="button"
          class="btn"
          data-testid="tt-rewind-point"
          :disabled="store.busy"
          @click="jump(i)"
        >
          {{ t('rewind.jump', { time: pointTime(p.t) }) }}
        </button>
      </div>

      <div class="row end">
        <button
          type="button"
          class="btn"
          data-testid="tt-saves-close"
          @click="store.closeSaves()"
        >
          {{ t('saves.close') }}
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

.saves {
  width: min(44rem, 100%);
  max-height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
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

h3 {
  margin-top: 0.4rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.row.end {
  justify-content: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--color-text-muted);
}

.field.inline {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
}

.field input {
  padding: 0.35rem 0.5rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--tt-font-mono);
}

.field.inline input {
  width: 5rem;
}

.hidden {
  display: none;
}

.btn {
  padding: 0.35rem 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.82rem;
}

.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.msg {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 0.82rem;
}

.msg.error {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.msg.warn {
  border-color: var(--color-accent);
}

.msg.info {
  border-color: var(--color-success);
}

.note {
  color: var(--color-text-muted);
  font-size: 0.78rem;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  list-style: none;
  padding: 0;
  margin: 0;
}

.list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--color-border);
}

.kind {
  min-width: 5rem;
  font-size: 0.75rem;
  color: var(--color-accent);
}

.label {
  flex: 1;
  min-width: 8rem;
  font-size: 0.85rem;
}

.points {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  max-height: 10rem;
  overflow: auto;
}
</style>
