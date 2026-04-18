<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../store/gameStore'
import MoneyDisplay from './ui/MoneyDisplay.vue'
import TimeControls from './ui/TimeControls.vue'
import AudioControls from '@/components/AudioControls.vue'
import GodModeButton from '@/components/GodModeButton.vue'

const store = useGameStore()
const router = useRouter()
const showSandboxInfo = ref(false)
const sandboxInfoType = ref<'rs' | 'mhc' | 'vessel' | null>(null)

const SANDBOX_INFO: Record<'rs' | 'mhc' | 'vessel', { title: string; lines: string[] }> = {
  rs: {
    title: 'Add Reach Stacker',
    lines: [
      '● ON / ○ OFF — enable or disable the unit',
      'Landside — allow truck ↔ yard jobs',
      'Waterside — allow quay ↔ yard jobs',
      '🗑 Delete — remove from terminal',
    ],
  },
  mhc: {
    title: 'Add Mobile Harbor Crane',
    lines: [
      '● ON / ○ OFF — enable or disable the crane',
      '↓ Disch / ↕ Both / ↑ Load — set direction',
      'Vessels — toggle which vessels it can serve',
      'B1 B2 … — restrict to specific vessel bays',
      '🗑 Delete — remove from terminal',
    ],
  },
  vessel: {
    title: 'Add Vessel',
    lines: [
      'Vessel sails in and docks automatically',
      'Discharge jobs are created once it arrives',
      'Export trucks arrive to deliver containers',
      'Click the vessel to sail it away early',
    ],
  },
}

function spawnAndClose(type: 'rs' | 'mhc' | 'vessel'): void {
  if (type === 'rs') store.spawnReachStacker()
  else if (type === 'mhc') store.spawnMobileHarborCrane()
  else store.spawnVessel()
  showSandboxInfo.value = false
  sandboxInfoType.value = null
}

function openSandboxInfo(type: 'rs' | 'mhc' | 'vessel'): void {
  sandboxInfoType.value = type
  showSandboxInfo.value = true
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
          @click="openSandboxInfo('rs')"
        >
          <span class="spawn-icon">🚜</span>
          <span class="spawn-label">+ RS</span>
        </button>
        <button
          class="sandbox-spawn-btn"
          title="Add Mobile Harbor Crane"
          @click="openSandboxInfo('mhc')"
        >
          <span class="spawn-icon">🏗️</span>
          <span class="spawn-label">+ MHC</span>
        </button>
        <button
          class="sandbox-spawn-btn"
          title="Add Vessel"
          @click="openSandboxInfo('vessel')"
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
      v-if="showSandboxInfo && sandboxInfoType"
      class="sandbox-overlay"
      @click.self="showSandboxInfo = false"
    >
      <div class="sandbox-dialog">
        <h3 class="sandbox-dialog-title">
          {{ SANDBOX_INFO[sandboxInfoType].title }}
        </h3>
        <p class="sandbox-dialog-hint">
          Click on it after spawning to access these controls:
        </p>
        <ul class="sandbox-dialog-lines">
          <li
            v-for="line in SANDBOX_INFO[sandboxInfoType].lines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
        <div class="sandbox-dialog-actions">
          <button
            class="sandbox-dialog-confirm"
            @click="spawnAndClose(sandboxInfoType!)"
          >
            Spawn
          </button>
          <button
            class="sandbox-dialog-cancel"
            @click="showSandboxInfo = false"
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
  padding: 28px 32px;
  max-width: 380px;
  width: 90%;
}

.sandbox-dialog-title {
  font-family: var(--font-retro, monospace);
  font-size: 1rem;
  color: #5dade2;
  margin: 0 0 12px 0;
}

.sandbox-dialog-hint {
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.45);
  margin: 0 0 8px 0;
  font-style: italic;
}

.sandbox-dialog-lines {
  list-style: none;
  padding: 0;
  margin: 0 0 20px 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.sandbox-dialog-lines li {
  font-family: var(--font-retro, monospace);
  font-size: 0.74rem;
  color: rgba(255, 255, 255, 0.8);
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  border-left: 2px solid #3498db;
}

.sandbox-dialog-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
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
