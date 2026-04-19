<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'
import { useGlobalSettingsStore } from '@/stores/globalSettings'

const store = useGameStore()
const globalSettings = useGlobalSettingsStore()

const canDelete = computed(() => store.gamePhase === 'sandbox' || globalSettings.godModeEnabled)

const container = computed(() => {
  if (!store.selectedContainerId) return null
  return store.containers.find(c => c.id === store.selectedContainerId) ?? null
})

const activeJob = computed(() => {
  if (!container.value) return null
  return store.jobs.find(
    j => j.containerId === container.value!.id &&
      (j.status === 'pending' || j.status === 'assigned' || j.status === 'in_progress' || j.status === 'blocked'),
  ) ?? null
})

const dwellTime = computed(() => {
  if (!container.value || container.value.arrivedAt === 0) return null
  const elapsedS = store.simTime - container.value.arrivedAt
  if (elapsedS < 60) return `${Math.floor(elapsedS)}s`
  const m = Math.floor(elapsedS / 60)
  const s = Math.floor(elapsedS % 60)
  return `${m}m ${s}s`
})

function locationLabel(type: string, id: string): string {
  switch (type) {
    case 'yard_slot': {
      const parts = id.split('-')
      if (parts.length >= 5) {
        const bay = parseInt(parts[parts.length - 3])
        const row = parseInt(parts[parts.length - 2])
        const tier = parseInt(parts[parts.length - 1])
        const block = parts.slice(0, parts.length - 3).join('-')
        return `${block} Bay${bay} R${row} T${tier}`
      }
      return id
    }
    case 'vessel_slot': return id
    case 'quay_buffer': return id.includes('discharge') ? 'Quay (import)' : 'Quay (export)'
    case 'truck': return id.replace('truck-', 'Truck ')
    case 'gate_buffer': return 'Gate'
    case 'equipment': return id
    default: return id
  }
}

function lifecycleLabel(state: string): string {
  return state.replace(/_/g, ' ')
}

function jobRouteLabel(j: typeof activeJob.value): string {
  if (!j) return ''
  return `${locationLabel(j.pickupLocation.type, j.pickupLocation.id)} → ${locationLabel(j.dropoffLocation.type, j.dropoffLocation.id)}`
}
</script>

<template>
  <div
    v-if="container"
    class="container-info"
  >
    <div class="info-header">
      <div
        class="color-swatch"
        :style="{ background: container.ownerColor }"
      />
      <div class="header-text">
        <span class="info-id">{{ container.id.slice(-10) }}</span>
        <span class="shipping-line">{{ container.shippingLine }}</span>
      </div>
      <button
        class="close-btn"
        @click="store.selectedContainerId = null"
      >
        ✕
      </button>
    </div>

    <div class="info-rows">
      <div class="info-row">
        <span class="label">Direction</span>
        <span
          class="value"
          :style="{ color: container.visitType === 'import' ? '#3498db' : '#e67e22' }"
        >{{ container.visitType.toUpperCase() }}</span>
      </div>
      <div class="info-row">
        <span class="label">Status</span>
        <span class="value">{{ lifecycleLabel(container.lifecycleState) }}</span>
      </div>
      <div class="info-row">
        <span class="label">Size</span>
        <span class="value">{{ container.size }} · {{ container.weight.toLocaleString() }} kg</span>
      </div>
      <div class="info-row">
        <span class="label">Location</span>
        <span class="value small">{{ locationLabel(container.currentLocation.type, container.currentLocation.id) }}</span>
      </div>
      <div
        v-if="dwellTime"
        class="info-row"
      >
        <span class="label">Dwell</span>
        <span class="value">{{ dwellTime }}</span>
      </div>
      <div
        v-if="container.revenueEarned > 0"
        class="info-row"
      >
        <span class="label">Revenue</span>
        <span
          class="value"
          style="color: #2ecc71"
        >${{ container.revenueEarned }}</span>
      </div>

      <!-- Delete (sandbox) -->
      <div
        v-if="canDelete"
        class="delete-row"
      >
        <button
          class="delete-btn"
          @click="store.deleteContainer(container.id)"
        >
          🗑 Delete
        </button>
      </div>

      <!-- Active job -->
      <div
        v-if="activeJob"
        class="job-section"
      >
        <div class="section-title">
          Active Job
        </div>
        <div class="info-row">
          <span class="label">{{ activeJob.id }}</span>
          <span
            class="value"
            :style="{ color: activeJob.status === 'blocked' ? '#e74c3c' : '#f1c40f' }"
          >{{ activeJob.status }}</span>
        </div>
        <div class="info-row">
          <span class="label small">Route</span>
          <span class="value small">{{ jobRouteLabel(activeJob) }}</span>
        </div>
        <div
          v-if="activeJob.assignedEquipmentId"
          class="info-row"
        >
          <span class="label small">Equip</span>
          <span class="value small">{{ activeJob.assignedEquipmentId }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container-info {
  position: fixed;
  bottom: 12px;
  left: 344px;
  width: 280px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 10px;
  pointer-events: auto;
  z-index: 10;
}

.info-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.color-swatch {
  width: 14px;
  height: 28px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.header-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.info-id {
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: #fff;
}

.shipping-line {
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

.small {
  font-size: 0.58rem;
  word-break: break-all;
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

.job-section {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.section-title {
  font-family: var(--font-retro, monospace);
  font-size: 0.58rem;
  color: var(--color-primary, #f59e0b);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
}
</style>
