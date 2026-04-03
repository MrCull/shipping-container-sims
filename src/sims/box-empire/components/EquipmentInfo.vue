<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'
import type { CraneMode } from '../types'

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

function stateLabel(state: string): string {
  return state.replace(/_/g, ' ')
}

function handleToggle(): void {
  if (equipment.value) store.toggleEquipment(equipment.value.id)
}

function handleCraneMode(mode: CraneMode): void {
  if (equipment.value) store.setCraneMode(equipment.value.id, mode)
}

function handleReachStackerService(side: 'landside' | 'waterside', enabled: boolean): void {
  if (equipment.value?.type !== 'reach_stacker') return
  store.setReachStackerServiceSide(equipment.value.id, side, enabled)
}

function jobStatusColor(status: string): string {
  switch (status) {
    case 'pending': return '#aaa'
    case 'assigned': return '#f1c40f'
    case 'in_progress': return '#2ecc71'
    case 'blocked': return '#e74c3c'
    default: return '#888'
  }
}
</script>

<template>
  <div
    v-if="equipment"
    class="equipment-info"
  >
    <div class="info-header">
      <span class="info-id">{{ typeLabel(equipment.type) }}</span>
      <div class="header-controls">
        <!-- Enabled / Disabled toggle -->
        <button
          :class="['toggle-btn', equipment.enabled ? 'enabled' : 'disabled']"
          :title="equipment.enabled ? 'Click to disable' : 'Click to enable'"
          @click="handleToggle"
        >
          {{ equipment.enabled ? '● ON' : '○ OFF' }}
        </button>
        <button
          class="close-btn"
          @click="store.selectedEquipmentId = null"
        >
          ✕
        </button>
      </div>
    </div>

    <div class="info-rows">
      <div class="info-row">
        <span class="label">State</span>
        <span class="value">{{ stateLabel(equipment.state) }}</span>
      </div>
      <div class="info-row">
        <span class="label">Carrying</span>
        <span class="value">{{ equipment.carriedContainerId ? equipment.carriedContainerId.slice(-8) : 'None' }}</span>
      </div>

      <!-- Crane mode — only for MHC -->
      <div
        v-if="equipment.type === 'mobile_harbor_crane'"
        class="info-row crane-mode-row"
      >
        <span class="label">Mode</span>
        <div class="mode-buttons">
          <button
            :class="['mode-btn', equipment.craneMode === 'discharge' ? 'active' : '']"
            title="Discharge only (vessel → quay)"
            @click="handleCraneMode('discharge')"
          >
            ↓ Disch
          </button>
          <button
            :class="['mode-btn', equipment.craneMode === 'both' ? 'active' : '']"
            title="Both directions"
            @click="handleCraneMode('both')"
          >
            ↕ Both
          </button>
          <button
            :class="['mode-btn', equipment.craneMode === 'load' ? 'active' : '']"
            title="Load only (quay → vessel)"
            @click="handleCraneMode('load')"
          >
            ↑ Load
          </button>
        </div>
      </div>

      <div
        v-if="equipment.type === 'reach_stacker'"
        class="info-row crane-mode-row"
      >
        <span class="label">Service</span>
        <div
          class="mode-buttons"
          :class="{ disabled: !equipment.enabled }"
        >
          <button
            :class="['mode-btn', equipment.canServeLandside ? 'active' : '']"
            title="Allow truck-to-yard and yard-to-truck jobs"
            @click="handleReachStackerService('landside', !equipment.canServeLandside)"
          >
            Landside
          </button>
          <button
            :class="['mode-btn', equipment.canServeWaterside ? 'active' : '']"
            title="Allow quay-to-yard and yard-to-quay jobs"
            @click="handleReachStackerService('waterside', !equipment.canServeWaterside)"
          >
            Waterside
          </button>
        </div>
      </div>

      <div
        v-if="currentJob"
        class="info-row"
      >
        <span class="label">Job</span>
        <span
          class="value job-status"
          :style="{ color: jobStatusColor(currentJob.status) }"
        >
          {{ currentJob.id }} · {{ currentJob.status }}
        </span>
      </div>

      <div
        v-if="currentJob"
        class="info-row"
      >
        <span class="label">Route</span>
        <span class="value">{{ currentJob.pickupLocation.type }} → {{ currentJob.dropoffLocation.type }}</span>
      </div>
    </div>
  </div>

  <!-- Equipment list panel (always visible during gameplay) -->
  <div
    v-if="store.gamePhase === 'tutorial' || store.gamePhase === 'playing'"
    class="equipment-list"
  >
    <div class="list-header">
      Equipment
    </div>
    <div
      v-for="eq in store.equipment"
      :key="eq.id"
      :class="['eq-row', store.selectedEquipmentId === eq.id ? 'selected' : '']"
      @click="store.selectedEquipmentId = store.selectedEquipmentId === eq.id ? null : eq.id"
    >
      <span class="eq-icon">{{ eq.type === 'reach_stacker' ? '🏗' : '🏛' }}</span>
      <span class="eq-name">{{ eq.type === 'reach_stacker' ? 'RS' : 'MHC' }} · {{ eq.id }}</span>
      <span class="eq-state">{{ stateLabel(eq.state) }}</span>
      <button
        :class="['mini-toggle', eq.enabled ? 'on' : 'off']"
        :title="eq.enabled ? 'Disable' : 'Enable'"
        @click.stop="store.toggleEquipment(eq.id)"
      >
        {{ eq.enabled ? '●' : '○' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.equipment-info {
  position: fixed;
  right: 12px;
  top: 560px;
  width: 280px;
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
  color: #e67e22;
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
  gap: 5px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.crane-mode-row {
  align-items: flex-start;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-family: var(--font-retro, monospace);
  font-size: 0.62rem;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  min-width: 55px;
}

.value {
  font-family: var(--font-retro, monospace);
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.9);
  text-align: right;
  flex: 1;
}

.job-status {
  font-size: 0.62rem;
}

.mode-buttons {
  display: flex;
  gap: 4px;
}

.mode-buttons.disabled {
  opacity: 0.55;
}

.mode-btn {
  font-family: var(--font-retro, monospace);
  font-size: 0.6rem;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.15s;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.mode-btn.active {
  background: rgba(245, 158, 11, 0.3);
  border-color: #f59e0b;
  color: #f59e0b;
  font-weight: bold;
}

/* Equipment list panel */
.equipment-list {
  position: fixed;
  right: 12px;
  top: 420px;
  width: 200px;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  font-family: var(--font-retro, monospace);
  font-size: 0.68rem;
  color: #ccc;
  z-index: 10;
  pointer-events: auto;
}

.list-header {
  padding: 6px 10px;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--color-primary, #f59e0b);
  font-weight: bold;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.eq-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s;
}

.eq-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

.eq-row.selected {
  background: rgba(245, 158, 11, 0.15);
  border-left: 2px solid #f59e0b;
}

.eq-icon {
  font-size: 0.9rem;
}

.eq-name {
  flex: 1;
  font-size: 0.62rem;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eq-state {
  font-size: 0.57rem;
  color: #888;
  max-width: 50px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0;
  line-height: 1;
  transition: transform 0.1s;
}

.mini-toggle.on {
  color: #2ecc71;
}

.mini-toggle.off {
  color: #e74c3c;
}

.mini-toggle:hover {
  transform: scale(1.3);
}
</style>

