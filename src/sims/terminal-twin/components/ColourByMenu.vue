<script setup lang="ts">
/**
 * Colour by menu (#130, spec #116): a button in the overlay bar that opens a panel with the mode dropdown and the legend
 * of the mode. The mode colours the containers in 3D and the bay viewer. The remain-on-board boxes have their own
 * control (the ROB display in the top bar, #168). The panel closes when a mode is picked and on a pointer-down outside
 * it (#168). Colours and keys come from `modules/colourBy.ts`.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import TtIcon from './ui/TtIcon.vue'
import { useTwinStore } from '../store/twinStore'
import { t, type MessageKey } from '../i18n/messages'
import { COLOUR_BY_MODES, colourContextOf, legendOf, type ColourBy } from '../modules/colourBy'
import { colourKeyLabel } from '../modules/colourLabels'

const store = useTwinStore()
/** The open state lives in the store: the shared Esc handling (#169) closes the panel from anywhere. */
const open = computed(() => store.colourByOpen)
const root = ref<HTMLElement | null>(null)

const legend = computed(() => {
  const config = store.config
  return legendOf(store.colourBy, config ? colourContextOf(config) : { ports: [] })
})

function onSelect(e: Event): void {
  store.setColourBy((e.target as HTMLSelectElement).value as ColourBy)
  store.setColourByOpen(false)
}

/** A pointer-down anywhere outside the menu (its button and panel) closes the panel. Capture, so a canvas stopping the event still closes it. */
function onPointerDown(e: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) store.setColourByOpen(false)
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div
    ref="root"
    class="colour-by"
    data-tt-popup
  >
    <button
      type="button"
      class="toggle"
      :class="{ on: open || store.colourBy !== 'default' }"
      :aria-expanded="open"
      aria-haspopup="true"
      data-testid="tt-colour-by"
      :title="t('colourBy.hint')"
      @click="store.setColourByOpen(!open)"
    >
      <TtIcon name="layers" />
      {{ t('colourBy.label') }}
    </button>
    <div
      v-if="open"
      class="panel"
      role="group"
      :aria-label="t('colourBy.menu')"
      data-testid="tt-colour-by-panel"
    >
      <label class="row">
        <span class="label">{{ t('colourBy.label') }}</span>
        <select
          class="select"
          data-testid="tt-colour-by-select"
          :value="store.colourBy"
          @change="onSelect"
        >
          <option
            v-for="m in COLOUR_BY_MODES"
            :key="m"
            :value="m"
          >
            {{ t(`colourBy.mode.${m}` as MessageKey) }}
          </option>
        </select>
      </label>
      <h3 class="label">
        {{ t('colourBy.legend') }}
      </h3>
      <ul
        class="legend"
        data-testid="tt-colour-by-legend"
        :data-mode="store.colourBy"
      >
        <li
          v-for="e in legend"
          :key="e.key"
          :data-key="e.key"
        >
          <span
            class="swatch"
            :style="{ backgroundColor: e.hex }"
          />
          <span>{{ colourKeyLabel(store.colourBy, e.key) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.colour-by {
  position: relative;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  background: var(--tt-bg);
  color: var(--tt-text);
  font-size: 0.8rem;
}

.toggle:hover {
  border-color: var(--tt-accent);
}

.toggle.on {
  border-color: var(--tt-accent);
  background: var(--tt-accent-soft);
}

.panel {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  right: 0;
  z-index: 8;
  width: 16rem;
  max-height: min(26rem, 60vh);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--tt-border);
  border-radius: 8px;
  background: var(--tt-panel-strong);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  box-shadow: var(--tt-shadow);
  color: var(--tt-text);
  font-size: 0.8rem;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.label {
  color: var(--tt-text-muted);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.select {
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  background: var(--tt-surface);
  color: var(--tt-text);
  font-size: 0.8rem;
}

.legend {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.swatch {
  flex: none;
  width: 1rem;
  height: 0.7rem;
  border-radius: 2px;
  border: 1px solid var(--tt-border-strong);
}
</style>
