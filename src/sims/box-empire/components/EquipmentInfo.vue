<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'

const store = useGameStore()

const equipment = computed(() => {
  if (!store.selectedEquipmentId) return null
  return store.equipment.find(e => e.id === store.selectedEquipmentId) ?? null
})

const currentJob = computed(() => {
  if (!equipment.value?.currentJobId) return null
  return store.jobs.find(j => j.id === equipment.value!.currentJobId) ?? null
})

function typeLabel(type: string): string {
  if (type === 'reach_stacker') return 'Reach Stacker'
  if (type === 'mobile_harbor_crane') return 'Mobile Harbor Crane'
  return type
}
</script>

<template>
  <div
    v-if="equipment"
    class="equipment-info"
  >
    <div class="info-header">
      <span class="info-id">{{ typeLabel(equipment.type) }}</span>
      <button
        class="close-btn"
        @click="store.selectedEquipmentId = null"
      >
        ✕
      </button>
    </div>
    <div class="info-rows">
      <div class="info-row">
        <span class="label">State</span>
        <span class="value">{{ equipment.state }}</span>
      </div>
      <div class="info-row">
        <span class="label">Carrying</span>
        <span class="value">{{ equipment.carriedContainerId ?? 'None' }}</span>
      </div>
      <div
        v-if="currentJob"
        class="info-row"
      >
        <span class="label">Job</span>
        <span class="value">{{ currentJob.id }} ({{ currentJob.status }})</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.equipment-info {
  position: fixed;
  bottom: 12px;
  right: 12px;
  width: 260px;
  background: rgba(0, 0, 0, 0.75);
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
  font-size: 0.8rem;
  color: #e67e22;
  font-weight: bold;
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
  gap: 4px;
}

.info-row {
  display: flex;
  justify-content: space-between;
}

.label {
  font-family: var(--font-retro, monospace);
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
}

.value {
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.9);
}
</style>
