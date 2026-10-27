<script setup lang="ts">
import { useTwinStore } from '../store/twinStore'
import type { OverlayState } from '../modules/sceneRenderer'

const store = useTwinStore()

const toggles: { key: keyof OverlayState; label: string; title: string }[] = [
  { key: 'laneGraph', label: 'Lane graph', title: 'Show the one-way SHC lane graph' },
  { key: 'reservations', label: 'Reservations', title: 'Highlight conflict zones reserved at the displayed time' },
]

function toggle(key: keyof OverlayState): void {
  store.setOverlays({ [key]: !store.overlays[key] })
}
</script>

<template>
  <div
    class="overlays"
    role="group"
    aria-label="3D overlays"
  >
    <span class="label">Overlays</span>
    <button
      v-for="t in toggles"
      :key="t.key"
      type="button"
      class="toggle"
      :class="{ on: store.overlays[t.key] }"
      :aria-pressed="store.overlays[t.key]"
      :title="t.title"
      @click="toggle(t.key)"
    >
      <span
        class="dot"
        aria-hidden="true"
      />
      {{ t.label }}
    </button>
  </div>
</template>

<style scoped>
.overlays {
  position: absolute;
  left: 1rem;
  bottom: 1rem;
  z-index: 6;
  display: flex;
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
