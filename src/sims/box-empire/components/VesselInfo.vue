<script setup lang="ts">
import { computed } from 'vue'
import { UNPROCESSED_IMPORT_FINE } from '../modules/config'
import { useGameStore } from '../store/gameStore'

const store = useGameStore()

const vessel = computed(() => {
  if (!store.selectedVesselId) return null
  return store.vesselVisits.find(candidate => candidate.id === store.selectedVesselId) ?? null
})

const activeMoveCount = computed(() => {
  if (!vessel.value) return 0
  return store.jobs.filter(job => {
    const active =
      job.status === 'pending' ||
      job.status === 'assigned' ||
      job.status === 'in_progress' ||
      job.status === 'blocked'
    if (!active) return false
    return (
      (job.pickupLocation.type === 'vessel_slot' && job.pickupLocation.id.startsWith(`${vessel.value!.id}-`)) ||
      (job.dropoffLocation.type === 'vessel_slot' && job.dropoffLocation.id.startsWith(`${vessel.value!.id}-`))
    )
  }).length
})

const remainingImports = computed(() => {
  if (!vessel.value) return 0
  return store.containers.filter(
    container =>
      container.visitType === 'import' &&
      container.vesselSlot?.vesselId === vessel.value!.id &&
      container.lifecycleState === 'on_vessel',
  ).length
})

const fineTotal = computed(() => remainingImports.value * UNPROCESSED_IMPORT_FINE)

function stateLabel(state: string): string {
  return state.replace(/_/g, ' ')
}

function handleSail(): void {
  if (!vessel.value) return
  store.sailVesselNow(vessel.value.id)
}

function handleDischargeToggle(): void {
  if (!vessel.value) return
  store.setVesselDischargeEnabled(vessel.value.id, !vessel.value.dischargeEnabled)
}

function handleLoadToggle(): void {
  if (!vessel.value) return
  store.setVesselLoadEnabled(vessel.value.id, !vessel.value.loadEnabled)
}
</script>

<template>
  <div
    v-if="vessel"
    class="vessel-info"
  >
    <div class="info-header">
      <div>
        <div class="info-id">
          {{ vessel.name }}
        </div>
        <div class="vessel-id">
          {{ vessel.id }}
        </div>
      </div>
      <button
        class="close-btn"
        @click="store.selectedVesselId = null"
      >
        x
      </button>
    </div>

    <div class="info-rows">
      <div class="info-row">
        <span class="label">State</span>
        <span class="value">{{ stateLabel(vessel.state) }}</span>
      </div>
      <div class="info-row">
        <span class="label">Moves</span>
        <span class="value">{{ activeMoveCount }}</span>
      </div>
      <div class="info-row">
        <span class="label">Imports</span>
        <span class="value">{{ remainingImports }}</span>
      </div>
      <div class="info-row">
        <span class="label">Sail Early Fine</span>
        <span
          class="value"
          :class="{ warning: fineTotal > 0 }"
        >
          ${{ fineTotal }}
        </span>
      </div>

      <div class="info-row ops-row">
        <span class="label">Ops</span>
        <div class="ops-buttons">
          <button
            :class="['ops-btn', vessel.dischargeEnabled ? 'active' : '']"
            title="Toggle discharge (vessel → quay)"
            @click="handleDischargeToggle"
          >
            ↓ Disch
          </button>
          <button
            :class="['ops-btn', vessel.loadEnabled ? 'active' : '']"
            title="Toggle loading (quay → vessel)"
            @click="handleLoadToggle"
          >
            ↑ Load
          </button>
        </div>
      </div>
    </div>

    <button
      class="sail-btn"
      :disabled="vessel.state === 'departing' || vessel.state === 'departed'"
      @click="handleSail"
    >
      Sail Now
    </button>
  </div>
</template>

<style scoped>
.vessel-info {
  position: fixed;
  bottom: 12px;
  left: 636px;
  width: 240px;
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
  font-size: 0.72rem;
  color: #6cb7ff;
  font-weight: bold;
}

.vessel-id {
  font-family: var(--font-retro, monospace);
  font-size: 0.58rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
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
  align-items: center;
  gap: 8px;
}

.label {
  font-family: var(--font-retro, monospace);
  font-size: 0.6rem;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
}

.value {
  font-family: var(--font-retro, monospace);
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.9);
  text-align: right;
}

.warning {
  color: #e74c3c;
}

.sail-btn {
  width: 100%;
  margin-top: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #6cb7ff;
  background: rgba(108, 183, 255, 0.16);
  color: #d9ecff;
  font-family: var(--font-retro, monospace);
  font-size: 0.66rem;
  font-weight: bold;
  cursor: pointer;
}

.sail-btn:hover:not(:disabled) {
  background: rgba(108, 183, 255, 0.26);
}

.sail-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ops-row {
  align-items: center;
}

.ops-buttons {
  display: flex;
  gap: 4px;
}

.ops-btn {
  font-family: var(--font-retro, monospace);
  font-size: 0.58rem;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: all 0.15s;
}

.ops-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.ops-btn.active {
  background: rgba(46, 204, 113, 0.2);
  border-color: #2ecc71;
  color: #2ecc71;
  font-weight: bold;
}
</style>
