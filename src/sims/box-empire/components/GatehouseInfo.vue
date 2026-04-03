<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'

const store = useGameStore()

const gatehouse = computed(() => {
  if (store.selectedGatehouseId === 'gatehouse-ingate') {
    return {
      id: 'gatehouse-ingate',
      label: 'In-Gate',
      laneLabel: 'Export Lane',
      laneOpen: store.gatehouse.exportLaneOpen,
    }
  }
  if (store.selectedGatehouseId === 'gatehouse-outgate') {
    return {
      id: 'gatehouse-outgate',
      label: 'Out-Gate',
      laneLabel: 'Import Lane',
      laneOpen: store.gatehouse.importLaneOpen,
    }
  }
  return null
})

function handleToggle(): void {
  if (!gatehouse.value) return
  if (gatehouse.value.id === 'gatehouse-ingate') {
    if (gatehouse.value.laneOpen) store.closeExportGate()
    else store.openExportGate()
    return
  }
  if (gatehouse.value.id === 'gatehouse-outgate') {
    if (gatehouse.value.laneOpen) store.closeImportGate()
    else store.openImportGate()
  }
}
</script>

<template>
  <div
    v-if="gatehouse"
    class="gatehouse-info"
  >
    <div class="info-header">
      <span class="info-id">{{ gatehouse.label }}</span>
      <div class="header-controls">
        <button
          :class="['toggle-btn', gatehouse.laneOpen ? 'enabled' : 'disabled']"
          :title="gatehouse.laneOpen ? 'Click to close' : 'Click to open'"
          @click="handleToggle"
        >
          {{ gatehouse.laneOpen ? '● ON' : '○ OFF' }}
        </button>
        <button
          class="close-btn"
          @click="store.selectedGatehouseId = null"
        >
          ✕
        </button>
      </div>
    </div>

    <div class="info-rows">
      <div class="info-row">
        <span class="label">State</span>
        <span
          class="value state-pill"
          :class="gatehouse.laneOpen ? 'open' : 'closed'"
        >
          {{ gatehouse.laneOpen ? 'Open' : 'Closed' }}
        </span>
      </div>
      <div class="info-row">
        <span class="label">Lane</span>
        <span class="value">{{ gatehouse.laneLabel }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gatehouse-info {
  position: fixed;
  right: 12px;
  top: 560px;
  width: 240px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 10px;
  pointer-events: auto;
  z-index: 10;
}

.info-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.info-id {
  font-family: var(--font-retro, monospace);
  font-size: 0.78rem;
  color: #6cb7ff;
  font-weight: bold;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toggle-btn {
  font-family: var(--font-retro, monospace);
  font-size: 0.65rem;
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;
}

.toggle-btn.enabled {
  background: rgba(46, 204, 113, 0.2);
  border-color: #2ecc71;
  color: #2ecc71;
}

.toggle-btn.disabled {
  background: rgba(231, 76, 60, 0.2);
  border-color: #e74c3c;
  color: #e74c3c;
}

.toggle-btn:hover {
  opacity: 0.8;
  transform: scale(1.05);
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
}

.info-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.label {
  font-family: var(--font-retro, monospace);
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.55);
  text-transform: uppercase;
}

.value {
  font-family: var(--font-retro, monospace);
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.85);
}

.state-pill {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid;
}

.state-pill.open {
  color: #2ecc71;
  border-color: #2ecc71;
  background: rgba(46, 204, 113, 0.15);
}

.state-pill.closed {
  color: #e74c3c;
  border-color: #e74c3c;
  background: rgba(231, 76, 60, 0.15);
}
</style>
