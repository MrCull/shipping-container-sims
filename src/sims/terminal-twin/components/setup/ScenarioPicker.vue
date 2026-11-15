<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { pickerModel, pickerSectionOf, type PickerItem, type PickerSection } from '../../modules/scenarioPicker'

/**
 * Start screen picker (#145): a Scenarios tab (the presets) and a Test benches tab (the engine fixtures under five
 * headings), each a list of plain names. Choosing a row sets `d.name`; the detail pane (the default slot, shown
 * beside the list and below it on a phone) describes it. Start is in the setup dialog's footer (#161). On a wide
 * screen the picker fills the Scenario tab and the list and the detail scroll on their own. Technical ids are never
 * shown (#156); rows carry them in `data-scenario`.
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
      <p class="hint">
        {{ tab === 'scenarios' ? t('setup.tab.scenariosHint') : t('setup.tab.benchesHint') }}
      </p>
    </div>

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
            <span class="dot" />
            <span class="row-text">
              <span class="row-name">{{ item.name }}</span>
              <span
                v-if="item.summary"
                class="row-sum"
              >{{ item.summary }}</span>
            </span>
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
              <span class="dot" />
              <span class="row-text">
                <span class="row-name">{{ item.name }}</span>
                <span
                  v-if="item.summary"
                  class="row-sum"
                >{{ item.summary }}</span>
              </span>
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
  gap: 1rem;
}

/* The two lists: a segmented control, with what the open list holds beside it. */
.tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.25rem;
  padding: 0 0.9rem;
  background: var(--tt-control);
  border: 1px solid var(--tt-border);
  color: var(--tt-text-muted);
  font: inherit;
  font-size: var(--tt-text-md);
  font-weight: 550;
  cursor: pointer;
}

.tab:first-child {
  border-radius: var(--tt-radius-sm) 0 0 var(--tt-radius-sm);
}

.tab:nth-child(2) {
  margin-left: calc(-0.25rem - 1px);
  border-radius: 0 var(--tt-radius-sm) var(--tt-radius-sm) 0;
}

.tab:hover {
  color: var(--tt-text);
}

.tab:focus-visible {
  outline: none;
  box-shadow: var(--tt-ring);
  position: relative;
}

.tab.on {
  position: relative;
  background: var(--tt-accent-soft);
  border-color: var(--tt-accent-line);
  color: var(--tt-text);
}

.tab small {
  padding: 0.05rem 0.45rem;
  background: var(--tt-control-hover);
  border-radius: 999px;
  color: var(--tt-text-muted);
  font-family: var(--tt-font-mono);
  font-size: var(--tt-text-xs);
  font-variant-numeric: tabular-nums;
}

.tab.on small {
  color: var(--tt-accent);
}

.tabs .hint {
  margin-left: 0.75rem;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
  gap: 1.25rem;
  align-items: start;
}

/* Wide: the picker fills the tab body; the list and the detail pane each scroll, the tab body does not. */
@media (min-width: 761px) {
  .picker {
    height: 100%;
    min-height: 0;
  }

  .split {
    flex: 1;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
    align-items: stretch;
  }

  .split > :deep(*) {
    min-height: 0;
    overflow: auto;
  }
}

@media (max-width: 760px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow: auto;
  /* room for the focus ring and the selected row's outline */
  padding: 3px;
  margin: -3px;
  scrollbar-width: thin;
}

@media (max-width: 760px) {
  .list {
    max-height: 18rem;
  }
}

.group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.group + .group {
  margin-top: 0.6rem;
}

.group h4 {
  position: sticky;
  top: -3px;
  z-index: 1;
  margin: 0;
  padding: 0.4rem 0.2rem;
  background: var(--tt-surface);
  color: var(--tt-text-faint);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.row-item {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.8rem 0.9rem;
  background: var(--tt-surface-raised);
  border: 1px solid var(--tt-hairline);
  border-radius: var(--tt-radius);
  cursor: pointer;
  transition:
    background 0.12s var(--tt-ease),
    border-color 0.12s var(--tt-ease);
}

.row-item:hover {
  background: var(--tt-surface-hover);
  border-color: var(--tt-border-strong);
}

.row-item:focus-visible {
  outline: none;
  box-shadow: var(--tt-ring);
}

.row-item.active {
  background: var(--tt-accent-soft);
  border-color: var(--tt-accent);
}

/* The radio mark: a ring, filled when chosen. */
.dot {
  flex: none;
  width: 1rem;
  height: 1rem;
  margin-top: 0.12rem;
  border: 1.5px solid var(--tt-border-strong);
  border-radius: 50%;
}

.row-item.active .dot {
  border: 0.3rem solid var(--tt-accent);
}

.row-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.row-name {
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.3;
}

.row-sum {
  color: var(--tt-text-muted);
  font-size: var(--tt-text-sm);
  line-height: 1.4;
}
</style>
