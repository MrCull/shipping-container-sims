<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'
import { useGlobalSettingsStore } from '@/stores/globalSettings'

const store = useGameStore()
const globalSettings = useGlobalSettingsStore()

const truck = computed(() => {
  if (!store.selectedTruckId) return null
  return store.truckVisits.find(t => t.id === store.selectedTruckId) ?? null
})

const carriedContainer = computed(() => {
  if (!truck.value?.containerId) return null
  return store.containers.find(c => c.id === truck.value!.containerId) ?? null
})

const canDelete = computed(() => store.gamePhase === 'sandbox' || globalSettings.godModeEnabled)

function stateLabel(state: string): string {
  return state.replace(/_/g, ' ')
}
</script>

<template>
  <div
    v-if="truck"
    class="truck-info"
  >
    <div class="info-header">
      <div>
        <div class="info-id">{{ truck.id }}</div>
        <div class="truck-type">{{ truck.visitType === 'import_pickup' ? 'Import Pickup' : 'Export Delivery' }}</div>
      </div>
      <button
        class="close-btn"
        @click="store.selectedTruckId = null"
      >
        ✕
      </button>
    </div>

    <div class="info-rows">
      <div class="info-row">
        <span class="label">State</span>
        <span class="value">{{ stateLabel(truck.state) }}</span>
      </div>
      <div
        v-if="carriedContainer"
        class="info-row"
      >
        <span class="label">Container</span>
        <span
          class="value"
          style="cursor:pointer; text-decoration: underline"
          @click="store.selectedContainerId = carriedContainer.id; store.selectedTruckId = null"
        >{{ carriedContainer.id.slice(-10) }}</span>
      </div>
      <div
        v-else
        class="info-row"
      >
        <span class="label">Container</span>
        <span class="value">—</span>
      </div>

      <div
        v-if="canDelete"
        class="delete-row"
      >
        <button
          class="delete-btn"
          @click="store.deleteTruck(truck.id)"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.truck-info {
  position: fixed;
  bottom: 12px;
  left: 344px;
  width: 220px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 10px;
  pointer-events: auto;
  z-index: 10;
}

.info-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.info-id {
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: #fff;
}

.truck-type {
  font-family: var(--font-retro, monospace);
  font-size: 0.58rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 0.8rem;
}

.info-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
}

.label {
  font-family: var(--font-retro, monospace);
  font-size: 0.6rem;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  flex-shrink: 0;
}

.value {
  font-family: var(--font-retro, monospace);
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.9);
  text-align: right;
}

.delete-row {
  margin-top: 6px;
}

.delete-btn {
  width: 100%;
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid #e74c3c;
  background: rgba(231, 76, 60, 0.15);
  color: #e74c3c;
  font-family: var(--font-retro, monospace);
  font-size: 0.62rem;
  cursor: pointer;
}

.delete-btn:hover {
  background: rgba(231, 76, 60, 0.3);
}
</style>
