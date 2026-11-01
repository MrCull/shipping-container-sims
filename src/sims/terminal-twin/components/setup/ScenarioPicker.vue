<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { pickerModel, pickerSectionOf, type PickerItem, type PickerSection } from '../../modules/scenarioPicker'

/**
 * Start screen picker (#145): a Scenarios tab (the presets) and a Test benches tab (the engine fixtures under five
 * headings), each a list of plain names. Choosing a row sets `d.name`; the detail pane (the default slot, shown
 * beside the list and below it on a phone) describes it and holds the one Start button. Technical ids are never shown
 * (#156); rows carry them in `data-scenario`.
 */
const d = useSetupDraft()

const model = computed(() => pickerModel(d.catalogue))

const tab = ref<PickerSection>(pickerSectionOf(model.value, d.name))
/** The last choice in each tab, so switching back returns to it. */
const remembered: Partial<Record<PickerSection, string>> = { [tab.value]: d.name }

const select = (item: PickerItem): void => {
  d.name = item.id
  remembered[item.section] = item.id
}

function openTab(next: PickerSection): void {
  tab.value = next
  const first = next === 'scenarios' ? model.value.scenarios[0] : model.value.benches[0]?.items[0]
  const id = remembered[next] ?? first?.id
  if (id) d.name = id
}
</script>

<template>
  <div class="picker">
    <div
      class="tabs"
      role="tablist"
      :aria-label="t('setup.tabs')"
    >
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ on: tab === 'scenarios' }"
        :aria-selected="tab === 'scenarios'"
        data-testid="tt-tab-scenarios"
        @click="openTab('scenarios')"
      >
        {{ t('setup.tab.scenarios') }}
        <small data-testid="tt-count-scenarios">{{ model.scenarios.length }}</small>
      </button>
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ on: tab === 'benches' }"
        :aria-selected="tab === 'benches'"
        data-testid="tt-tab-benches"
        @click="openTab('benches')"
      >
        {{ t('setup.tab.benches') }}
        <small data-testid="tt-count-benches">{{ model.benchCount }}</small>
      </button>
    </div>
    <p class="hint">
      {{ tab === 'scenarios' ? t('setup.tab.scenariosHint') : t('setup.tab.benchesHint') }}
    </p>

    <div class="split">
      <div
        class="list"
        role="radiogroup"
        :aria-label="tab === 'scenarios' ? t('setup.list.scenarios') : t('setup.list.benches')"
        data-testid="tt-pick-list"
      >
        <template v-if="tab === 'scenarios'">
          <div
            v-for="item in model.scenarios"
            :key="item.id"
            class="row-item"
            :class="{ active: item.id === d.name }"
            role="radio"
            tabindex="0"
            :aria-checked="item.id === d.name"
            data-testid="tt-preset-card"
            :data-scenario="item.id"
            @click="select(item)"
            @keydown.enter.prevent="select(item)"
            @keydown.space.prevent="select(item)"
          >
            {{ item.name }}
          </div>
        </template>
        <template v-else>
          <section
            v-for="g in model.benches"
            :key="g.id"
            class="group"
            :data-group="g.id"
          >
            <h4>{{ g.title }}</h4>
            <div
              v-for="item in g.items"
              :key="item.id"
              class="row-item"
              :class="{ active: item.id === d.name }"
              role="radio"
              tabindex="0"
              :aria-checked="item.id === d.name"
              data-testid="tt-fixture-row"
              :data-scenario="item.id"
              @click="select(item)"
              @keydown.enter.prevent="select(item)"
              @keydown.space.prevent="select(item)"
            >
              {{ item.name }}
            </div>
          </section>
        </template>
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped src="./setupSection.css"></style>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--tt-border);
}

.tab {
  padding: 0.6rem 1rem;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  color: var(--tt-text-muted);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.tab:hover {
  color: var(--tt-text);
}

.tab:focus-visible {
  outline: none;
  box-shadow: var(--tt-ring);
}

.tab.on {
  color: var(--tt-accent);
  border-bottom-color: var(--tt-accent);
}

.tab small {
  margin-left: 0.3rem;
  padding: 0 0.45rem;
  background: var(--tt-surface-sunken);
  border-radius: 999px;
  font-size: 0.78rem;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 1rem;
  align-items: start;
}

@media (max-width: 760px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.list {
  max-height: 34rem;
  overflow: auto;
  background: var(--tt-surface);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius);
}

@media (max-width: 760px) {
  .list {
    max-height: 18rem;
  }
}

.group h4 {
  position: sticky;
  top: 0;
  margin: 0;
  padding: 0.5rem 0.8rem 0.3rem;
  background: var(--tt-surface-sunken);
  border-bottom: 1px solid var(--tt-border);
  color: var(--tt-text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.row-item {
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid var(--tt-border);
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
}

.row-item:last-child {
  border-bottom: none;
}

.row-item:hover {
  background: var(--tt-surface-hover);
}

.row-item:focus-visible {
  outline: none;
  box-shadow: inset var(--tt-ring);
}

.row-item.active {
  background: var(--tt-accent-soft);
  box-shadow: inset 3px 0 0 var(--tt-accent);
}
</style>
