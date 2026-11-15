<script setup lang="ts">
import TtIcon from './ui/TtIcon.vue'
import ColourByMenu from './ColourByMenu.vue'
import { useTwinStore } from '../store/twinStore'
import { useHudStore } from '../store/hudStore'
import type { OverlayState } from '../modules/overlays'
import { t, type MessageKey } from '../i18n/messages'
import type { ViewPresetName } from '../modules/viewPresets'

const store = useTwinStore()
const hud = useHudStore()

const toggles: { key: keyof OverlayState; label: MessageKey; title: MessageKey }[] = [
  { key: 'laneGraph', label: 'overlays.laneGraph', title: 'overlays.laneGraphHint' },
  { key: 'reservations', label: 'overlays.reservations', title: 'overlays.reservationsHint' },
  { key: 'ascRail', label: 'overlays.ascRail', title: 'overlays.ascRailHint' },
  { key: 'occupancy', label: 'overlays.occupancy', title: 'overlays.occupancyHint' },
  { key: 'labels', label: 'overlays.labels', title: 'overlays.labelsHint' },
]

const views: { preset: ViewPresetName; label: MessageKey; title: MessageKey }[] = [
  { preset: 'quay', label: 'view.quay', title: 'view.quayHint' },
  { preset: 'yard', label: 'view.yard', title: 'view.yardHint' },
  { preset: 'gate', label: 'view.gate', title: 'view.gateHint' },
  { preset: 'overview', label: 'view.overview', title: 'view.overviewHint' },
]

function toggle(key: keyof OverlayState): void {
  store.setOverlays({ [key]: !store.overlays[key] })
}
</script>

<template>
  <button
    v-if="hud.collapsed.overlayBar"
    type="button"
    class="hud-pill overlays-pill"
    data-testid="tt-overlays-expand"
    :aria-label="t('overlays.group')"
    :aria-expanded="false"
    @click="hud.toggle('overlayBar')"
  >
    {{ t('overlays.label') }} <TtIcon name="up" />
  </button>
  <div
    v-else
    class="overlays"
    data-hud-region="overlayBar"
    role="group"
    :aria-label="t('overlays.group')"
  >
    <button
      type="button"
      class="hud-pill collapse"
      data-testid="tt-overlays-collapse"
      :title="t('hud.collapseOverlayBar')"
      :aria-label="t('hud.collapseOverlayBar')"
      :aria-expanded="true"
      @click="hud.toggle('overlayBar')"
    >
      <TtIcon name="down" />
    </button>
    <span class="label">{{ t('overlays.label') }}</span>
    <button
      v-for="item in toggles"
      :key="item.key"
      type="button"
      class="toggle"
      :class="{ on: store.overlays[item.key] }"
      :aria-pressed="store.overlays[item.key]"
      :title="t(item.title)"
      @click="toggle(item.key)"
    >
      <span
        class="dot"
        aria-hidden="true"
      />
      {{ t(item.label) }}
    </button>
    <span
      class="sep"
      aria-hidden="true"
    />
    <span class="label">{{ t('view.label') }}</span>
    <button
      v-for="item in views"
      :key="item.preset"
      type="button"
      class="toggle view"
      :data-testid="`tt-view-${item.preset}`"
      :title="t(item.title)"
      @click="store.setViewPreset(item.preset)"
    >
      {{ t(item.label) }}
    </button>
    <button
      type="button"
      class="toggle view"
      :class="{ on: store.followNextPending }"
      :aria-pressed="store.followNextPending"
      data-testid="tt-follow-next-truck"
      :title="t('followNext.hint')"
      @click="store.followNextTruck()"
    >
      <span
        class="dot"
        aria-hidden="true"
      />
      {{ t('followNext.label') }}
    </button>
    <span
      class="sep"
      aria-hidden="true"
    />
    <ColourByMenu />
  </div>
</template>

<style scoped>
.overlays-pill {
  grid-column: 2;
  grid-row: 3;
  justify-self: center;
  align-self: end;
  position: relative;
  z-index: 9;
  margin-bottom: 1rem;
}

.overlays .collapse {
  min-height: 1.9rem;
  border-color: transparent;
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.overlays {
  grid-column: 2;
  grid-row: 3;
  justify-self: center;
  align-self: end;
  position: relative;
  max-width: calc(100% - 1.6rem);
  margin-bottom: 1rem;
  /* above the popups (bay viewer 8): the Colour by panel opens upwards from this bar */
  z-index: 9;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--tt-border);
  border-radius: calc(var(--tt-radius) + 2px);
  background: var(--tt-panel);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  box-shadow: var(--tt-shadow);
  font-size: var(--tt-text-sm);
  color: var(--tt-text);
}

.label {
  color: var(--tt-text-faint);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0.3rem 0 0.2rem;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 1.9rem;
  padding: 0 0.65rem;
  border: 1px solid transparent;
  border-radius: var(--tt-radius-sm);
  background: transparent;
  color: var(--tt-text-muted);
  font-size: var(--tt-text-sm);
  font-weight: 500;
  transition:
    background 0.12s var(--tt-ease),
    color 0.12s var(--tt-ease);
}

.toggle:hover {
  background: var(--tt-control-hover);
  color: var(--tt-text);
}

.toggle.on {
  border-color: var(--tt-accent-line);
  background: var(--tt-accent-soft);
  color: var(--tt-text);
}

.sep {
  width: 1px;
  align-self: stretch;
  background: var(--tt-hairline);
  margin: 0.2rem 0.3rem;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  border: 1.5px solid var(--tt-text-faint);
}

.toggle.on .dot {
  background: var(--tt-accent);
  border-color: var(--tt-accent);
  box-shadow: 0 0 0 3px var(--tt-accent-soft);
}
</style>
