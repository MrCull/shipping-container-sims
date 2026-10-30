<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../../i18n/messages'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { resolveScenario } from '../../store/twinStore'
import { fixtureRow, layoutSketch, presetCopy, scenarioStats, statChips } from '../../modules/scenarioPicker'

/**
 * Scenario picker (TT-R04): presets as hero cards (chips and a layout sketch derived from the config), the engine
 * test fixtures in a collapsed table. Choosing one sets `d.name`; the detail panel (in the dialog shell) shows it.
 */
const d = useSetupDraft()

const presetCards = computed(() =>
  d.catalogue
    .filter((c) => c.kind === 'preset')
    .map((c) => {
      const config = resolveScenario(c.name)
      const copy = presetCopy(c.name)
      return {
        name: c.name,
        tagline: copy ? t(copy.tagline) : '',
        description: copy ? t(copy.description) : c.description,
        chips: statChips(scenarioStats(config)).map((chip) => ({ id: chip.id, label: t(chip.key, { value: chip.value }) })),
        sketch: layoutSketch(config),
      }
    }),
)

const fixtureRows = computed(() => d.catalogue.filter((c) => c.kind === 'fixture').map((c) => fixtureRow(c.name, resolveScenario(c.name))))

const fixturesOpen = ref(false)
const select = (name: string): void => {
  d.name = name
}
</script>

<template>
  <div class="picker">
    <fieldset class="field">
      <legend>{{ t('setup.presets') }}</legend>
      <div
        class="cards"
        role="radiogroup"
        :aria-label="t('setup.presets')"
      >
        <div
          v-for="c in presetCards"
          :key="c.name"
          class="card"
          :class="{ active: c.name === d.name }"
          role="radio"
          tabindex="0"
          :aria-checked="c.name === d.name"
          data-testid="tt-preset-card"
          :data-scenario="c.name"
          @click="select(c.name)"
          @keydown.enter.prevent="select(c.name)"
          @keydown.space.prevent="select(c.name)"
        >
          <svg
            v-if="c.sketch"
            class="sketch"
            :viewBox="c.sketch.viewBox"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            :aria-label="t('setup.sketch')"
          >
            <rect
              class="sea"
              :x="c.sketch.sea.x"
              :y="c.sketch.sea.y"
              :width="c.sketch.sea.w"
              :height="c.sketch.sea.h"
            />
            <line
              class="quay"
              :x1="c.sketch.quay.x1"
              :x2="c.sketch.quay.x2"
              y1="0"
              y2="0"
            />
            <rect
              v-for="(x, i) in c.sketch.sts"
              :key="`s${i}`"
              class="sts"
              :x="x - 9"
              y="-6"
              width="18"
              height="12"
            />
            <rect
              v-for="(b, i) in c.sketch.blocks"
              :key="`b${i}`"
              class="block"
              :x="b.x"
              :y="b.y"
              :width="b.w"
              :height="b.h"
            />
            <rect
              v-if="c.sketch.gate"
              class="gate"
              :x="c.sketch.gate.x"
              :y="c.sketch.gate.y"
              :width="c.sketch.gate.w"
              :height="c.sketch.gate.h"
            />
          </svg>
          <span class="card-name">{{ c.name }}</span>
          <span class="card-tagline">{{ c.tagline }}</span>
          <ul class="chips">
            <li
              v-for="chip in c.chips"
              :key="chip.id"
              class="chip"
              :data-testid="`tt-chip-${chip.id}`"
            >
              {{ chip.label }}
            </li>
          </ul>
        </div>
      </div>
    </fieldset>

    <details
      :open="fixturesOpen"
      class="fixtures"
      data-testid="tt-fixtures"
      @toggle="fixturesOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary>{{ t('setup.fixtures.title') }}</summary>
      <p class="hint">
        {{ t('setup.fixtures.hint') }}
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">
              {{ t('setup.fixtures.name') }}
            </th>
            <th scope="col">
              {{ t('setup.fixtures.sts') }}
            </th>
            <th scope="col">
              {{ t('setup.fixtures.vessels') }}
            </th>
            <th scope="col">
              {{ t('setup.fixtures.blocks') }}
            </th>
            <th scope="col">
              {{ t('setup.fixtures.shcs') }}
            </th>
            <th scope="col">
              {{ t('setup.fixtures.landside') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in fixtureRows"
            :key="r.name"
            :class="{ active: r.name === d.name }"
            tabindex="0"
            :aria-selected="r.name === d.name"
            data-testid="tt-fixture-row"
            :data-scenario="r.name"
            @click="select(r.name)"
            @keydown.enter.prevent="select(r.name)"
          >
            <th scope="row">
              {{ r.name }}
            </th>
            <td>{{ r.sts }}</td>
            <td>{{ r.vessels }}</td>
            <td>{{ r.blocks }}</td>
            <td>{{ r.shcs }}</td>
            <td>{{ r.landside ? t('setup.fixtures.yes') : t('setup.fixtures.no') }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>

<style scoped src="./setupSection.css"></style>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 700px) {
  .cards {
    grid-template-columns: 1fr;
  }
}

.card {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  cursor: pointer;
}

.card:hover,
.card:focus-visible {
  border-color: var(--color-primary);
  outline: none;
}

.card.active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg));
  box-shadow: 0 0 0 1px var(--color-primary);
}

.sketch {
  width: 100%;
  height: 5.5rem;
  background: var(--color-bg-card);
  border-radius: 6px;
}

.sketch .sea {
  fill: color-mix(in srgb, var(--color-primary) 22%, transparent);
}

.sketch .quay {
  stroke: var(--color-text-muted);
  stroke-width: 4;
}

.sketch .sts {
  fill: var(--color-accent);
}

.sketch .block {
  fill: var(--color-text-muted);
  opacity: 0.7;
}

.sketch .gate {
  fill: var(--color-primary);
}

.card-name {
  font-weight: 700;
  font-size: 0.95rem;
}

.card-tagline {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  list-style: none;
  padding: 0;
  margin: 0;
}

.chip {
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.7rem;
  font-family: var(--tt-font-mono);
  color: var(--color-text-muted);
}

.fixtures summary {
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

table {
  width: 100%;
  margin-top: 0.5rem;
  border-collapse: collapse;
  font-size: 0.8rem;
}

th,
td {
  padding: 0.3rem 0.5rem;
  text-align: right;
  border-bottom: 1px solid var(--color-border);
  font-variant-numeric: tabular-nums;
}

th:first-child {
  text-align: left;
  font-family: var(--tt-font-mono);
  font-weight: 400;
}

thead th {
  color: var(--color-text-muted);
  font-weight: 600;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover,
tbody tr:focus-visible {
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  outline: none;
}

tbody tr.active {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
}
</style>
