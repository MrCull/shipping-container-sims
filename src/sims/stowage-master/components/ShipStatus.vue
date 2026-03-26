<script setup lang="ts">
import { useGameStore } from '../store/gameStore'
import MeterBar from './ui/MeterBar.vue'

const store = useGameStore()
</script>

<template>
  <div
    v-if="store.phase !== 'start'"
    class="ship-status panel"
  >
    <div class="panel-title">
      Ship Status
    </div>
    <MeterBar
      label="List (Port/Starboard)"
      :value="store.shipList"
      :max="15"
      :warning="8"
      :critical="12"
      unit="°"
    />
    <MeterBar
      label="Trim (Bow/Stern)"
      :value="store.shipTrim"
      :max="12"
      :warning="6"
      :critical="9"
      unit="°"
    />
    <MeterBar
      label="VCG (Stability)"
      :value="store.shipVCG"
      :max="10"
      :warning="6"
      :critical="8"
      :absolute="false"
    />
  </div>
</template>

<style scoped>
.panel {
  position: absolute;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 10px 14px;
  z-index: 10;
  pointer-events: none;
  backdrop-filter: blur(4px);
}
.ship-status {
  top: 50px;
  right: 12px;
  min-width: 220px;
}
.panel-title {
  font-size: 12px;
  font-weight: bold;
  color: #ffcc00;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
</style>
