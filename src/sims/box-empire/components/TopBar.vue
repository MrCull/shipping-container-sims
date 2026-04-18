<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../store/gameStore'
import MoneyDisplay from './ui/MoneyDisplay.vue'
import TimeControls from './ui/TimeControls.vue'
import AudioControls from '@/components/AudioControls.vue'
import GodModeButton from '@/components/GodModeButton.vue'
import type { CraneMode } from '../types'

const store = useGameStore()
const router = useRouter()

const showSpawnDialog = ref(false)
const spawnType = ref<'rs' | 'mhc' | 'vessel' | null>(null)

// RS config
const rsLandside = ref(true)
const rsWaterside = ref(true)

// MHC config
const mhcMode = ref<CraneMode>('both')

// Vessel config
const vesselName = ref('')
const vesselImportCount = ref(24)
const vesselExportCount = ref(24)
const vesselDischargeEnabled = ref(true)
const vesselLoadEnabled = ref(true)

function openSpawnDialog(type: 'rs' | 'mhc' | 'vessel'): void {
  spawnType.value = type
  if (type === 'rs') {
    rsLandside.value = true
    rsWaterside.value = true
  } else if (type === 'mhc') {
    mhcMode.value = 'both'
  } else {
    vesselName.value = store.getNextVesselName()
    vesselImportCount.value = 24
    vesselExportCount.value = 24
    vesselDischargeEnabled.value = true
    vesselLoadEnabled.value = true
  }
  showSpawnDialog.value = true
}

function clampCount(val: number): number {
  return Math.max(0, Math.min(36, Math.floor(val)))
}

function onImportInput(e: Event): void {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(v)) vesselImportCount.value = clampCount(v)
}

function onExportInput(e: Event): void {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(v)) vesselExportCount.value = clampCount(v)
}

function confirmSpawn(): void {
  if (!spawnType.value) return
  if (spawnType.value === 'rs') {
    store.spawnReachStacker({ landsideEnabled: rsLandside.value, watersideEnabled: rsWaterside.value })
  } else if (spawnType.value === 'mhc') {
    store.spawnMobileHarborCrane({ craneMode: mhcMode.value })
  } else {
    store.spawnVessel({
      name: vesselName.value.trim() || store.getNextVesselName(),
      importCount: vesselImportCount.value,
      exportCount: vesselExportCount.value,
      dischargeEnabled: vesselDischargeEnabled.value,
      loadEnabled: vesselLoadEnabled.value,
    })
  }
  showSpawnDialog.value = false
  spawnType.value = null
}

function goToMenu(): void {
  store.resetToMenu()
  router.push('/')
}
</script>

<template>
  <div class="top-bar">
    <div class="top-bar-left">
      <button
        class="menu-btn"
        title="Back to main menu"
        @click="goToMenu"
      >
        ← Menu
      </button>
      <MoneyDisplay />
    </div>
    <div class="top-bar-center">
      <span class="sim-time">⏱ {{ Math.floor(store.simTime) }}s</span>
    </div>
    <div class="top-bar-right">
      <template v-if="store.gamePhase === 'sandbox'">
        <button
          class="sandbox-spawn-btn"
          title="Add Reach Stacker"
          @click="openSpawnDialog('rs')"
        >
          <span class="spawn-icon">🚜</span>
          <span class="spawn-label">+ RS</span>
        </button>
        <button
          class="sandbox-spawn-btn"
          title="Add Mobile Harbor Crane"
          @click="openSpawnDialog('mhc')"
        >
          <span class="spawn-icon">🏗️</span>
          <span class="spawn-label">+ MHC</span>
        </button>
        <button
          class="sandbox-spawn-btn"
          title="Add Vessel"
          @click="openSpawnDialog('vessel')"
        >
          <span class="spawn-icon">⛴️</span>
          <span class="spawn-label">+ Vessel</span>
        </button>
      </template>
      <TimeControls />
      <GodModeButton />
      <AudioControls placement="inline" />
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="showSpawnDialog && spawnType"
      class="sandbox-overlay"
      @click.self="showSpawnDialog = false"
    >
      <div class="sandbox-dialog">
        <!-- RS dialog -->
        <template v-if="spawnType === 'rs'">
          <h3 class="sandbox-dialog-title">
            Add Reach Stacker
          </h3>
          <div class="config-section">
            <div class="config-label">
              Service sides
            </div>
            <div class="mode-buttons">
              <button
                :class="['mode-btn', rsLandside ? 'active' : '']"
                title="Allow truck ↔ yard jobs"
                @click="rsLandside = !rsLandside"
              >
                Landside
              </button>
              <button
                :class="['mode-btn', rsWaterside ? 'active' : '']"
                title="Allow quay ↔ yard jobs"
                @click="rsWaterside = !rsWaterside"
              >
                Waterside
              </button>
            </div>
          </div>
        </template>

        <!-- MHC dialog -->
        <template v-else-if="spawnType === 'mhc'">
          <h3 class="sandbox-dialog-title">
            Add Mobile Harbor Crane
          </h3>
          <div class="config-section">
            <div class="config-label">
              Crane mode
            </div>
            <div class="mode-buttons">
              <button
                :class="['mode-btn', mhcMode === 'discharge' ? 'active' : '']"
                title="Discharge only (vessel → quay)"
                @click="mhcMode = 'discharge'"
              >
                ↓ Disch
              </button>
              <button
                :class="['mode-btn', mhcMode === 'both' ? 'active' : '']"
                title="Both directions"
                @click="mhcMode = 'both'"
              >
                ↕ Both
              </button>
              <button
                :class="['mode-btn', mhcMode === 'load' ? 'active' : '']"
                title="Load only (quay → vessel)"
                @click="mhcMode = 'load'"
              >
                ↑ Load
              </button>
            </div>
          </div>
        </template>

        <!-- Vessel dialog -->
        <template v-else-if="spawnType === 'vessel'">
          <h3 class="sandbox-dialog-title">
            Add Vessel
          </h3>

          <div class="config-section">
            <div class="config-label">
              Name
            </div>
            <input
              v-model="vesselName"
              class="text-input"
              type="text"
              placeholder="Vessel name"
            >
          </div>

          <div class="config-section">
            <div class="config-label">
              Operations
            </div>
            <div class="mode-buttons">
              <button
                :class="['mode-btn', vesselDischargeEnabled ? 'active' : '']"
                title="Create discharge jobs when vessel arrives"
                @click="vesselDischargeEnabled = !vesselDischargeEnabled"
              >
                ↓ Discharge
              </button>
              <button
                :class="['mode-btn', vesselLoadEnabled ? 'active' : '']"
                title="Create load jobs for this vessel"
                @click="vesselLoadEnabled = !vesselLoadEnabled"
              >
                ↑ Load
              </button>
            </div>
          </div>

          <div class="config-row">
            <div class="config-section count-section">
              <div class="config-label">
                Import containers
              </div>
              <input
                class="count-input"
                type="number"
                min="0"
                max="36"
                step="1"
                :value="vesselImportCount"
                @input="onImportInput"
              >
            </div>
            <div class="config-section count-section">
              <div class="config-label">
                Export containers
              </div>
              <input
                class="count-input"
                type="number"
                min="0"
                max="36"
                step="1"
                :value="vesselExportCount"
                @input="onExportInput"
              >
            </div>
          </div>
        </template>

        <div class="sandbox-dialog-actions">
          <button
            class="sandbox-dialog-confirm"
            @click="confirmSpawn"
          >
            Spawn
          </button>
          <button
            class="sandbox-dialog-cancel"
            @click="showSpawnDialog = false"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.top-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.3) 100%);
  z-index: 10;
  pointer-events: auto;
}

.top-bar-left,
.top-bar-center,
.top-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu-btn {
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.85);
  font-family: var(--font-retro, monospace);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}

.menu-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.6);
}

.sim-time {
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.8);
}

.sandbox-spawn-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid #3498db;
  border-radius: 6px;
  background: rgba(52, 152, 219, 0.15);
  color: #5dade2;
  font-family: var(--font-retro, monospace);
  cursor: pointer;
  transition: all 0.15s;
  gap: 1px;
}

.sandbox-spawn-btn:hover {
  background: rgba(52, 152, 219, 0.35);
  border-color: #5dade2;
  color: #fff;
}

.spawn-icon {
  font-size: 1.1rem;
  line-height: 1;
}

.spawn-label {
  font-size: 0.6rem;
  font-weight: bold;
  line-height: 1;
}

.sandbox-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
}

.sandbox-dialog {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border: 2px solid #3498db;
  border-radius: 12px;
  padding: 24px 28px;
  max-width: 400px;
  width: 90%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sandbox-dialog-title {
  font-family: var(--font-retro, monospace);
  font-size: 1rem;
  color: #5dade2;
  margin: 0;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-row {
  display: flex;
  gap: 12px;
}

.count-section {
  flex: 1;
}

.config-label {
  font-family: var(--font-retro, monospace);
  font-size: 0.62rem;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mode-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mode-btn {
  font-family: var(--font-retro, monospace);
  font-size: 0.68rem;
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: all 0.15s;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.mode-btn.active {
  background: rgba(245, 158, 11, 0.25);
  border-color: #f59e0b;
  color: #f59e0b;
  font-weight: bold;
}

.text-input {
  width: 100%;
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--font-retro, monospace);
  font-size: 0.74rem;
  box-sizing: border-box;
}

.text-input:focus {
  outline: none;
  border-color: #3498db;
}

.count-input {
  width: 100%;
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--font-retro, monospace);
  font-size: 0.82rem;
  box-sizing: border-box;
}

.count-input:focus {
  outline: none;
  border-color: #3498db;
}

.sandbox-dialog-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 4px;
}

.sandbox-dialog-confirm {
  padding: 7px 20px;
  border: 2px solid #3498db;
  border-radius: 6px;
  background: #3498db;
  color: #0a1628;
  font-family: var(--font-retro, monospace);
  font-size: 0.82rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.15s;
}

.sandbox-dialog-confirm:hover {
  background: #5dade2;
  border-color: #5dade2;
}

.sandbox-dialog-cancel {
  padding: 7px 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-family: var(--font-retro, monospace);
  font-size: 0.82rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.15s;
}

.sandbox-dialog-cancel:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.5);
}
</style>
