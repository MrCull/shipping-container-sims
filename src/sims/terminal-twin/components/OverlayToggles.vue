<script setup lang="ts">
import { useTwinStore } from '../store/twinStore'
import type { OverlayState } from '../modules/overlays'
import { t, type MessageKey } from '../i18n/messages'

const store = useTwinStore()

const toggles: { key: keyof OverlayState; label: MessageKey; title: MessageKey }[] = [
  { key: 'laneGraph', label: 'overlays.laneGraph', title: 'overlays.laneGraphHint' },
  { key: 'reservations', label: 'overlays.reservations', title: 'overlays.reservationsHint' },
  { key: 'ascRail', label: 'overlays.ascRail', title: 'overlays.ascRailHint' },
  { key: 'occupancy', label: 'overlays.occupancy', title: 'overlays.occupancyHint' },
  { key: 'labels', label: 'overlays.labels', title: 'overlays.labelsHint' },
]

function toggle(key: keyof OverlayState): void {
  store.setOverlays({ [key]: !store.overlays[key] })
}
</script>

<template>
  <div
    class="overlays"
    data-hud-region="overlayBar"
    role="group"
    :aria-label="t('overlays.group')"
  >
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
  </div>
</template>

<style scoped>
.overlays {
  grid-column: 2;
  grid-row: 3;
  justify-self: center;
  align-self: end;
  position: relative;
  max-width: calc(100% - 1.6rem);
  margin-bottom: 1rem;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: rgba(17, 24, 39, 0.88);
  font-size: 0.8rem;
  color: var(--color-text);
}

.label {
  color: var(--color-text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-right: 0.2rem;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.8rem;
}

.toggle:hover {
  border-color: var(--color-primary);
}

.toggle.on {
  border-color: var(--color-accent);
  background: rgba(245, 158, 11, 0.12);
}

.dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  border: 1px solid var(--color-text-muted);
}

.toggle.on .dot {
  background: var(--color-accent);
  border-color: var(--color-accent);
}
</style>
