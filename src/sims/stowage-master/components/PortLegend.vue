<script setup lang="ts">
import { useGameStore } from '../store/gameStore'
import { PORTS } from '../modules/config'

const store = useGameStore()
</script>

<template>
  <div
    v-if="store.phase === 'selecting'"
    class="port-legend panel"
  >
    <div class="panel-title">
      Ports of Discharge
    </div>
    <div
      v-for="port in PORTS"
      :key="port.name"
      class="legend-item"
    >
      <span
        class="port-dot"
        :style="{ backgroundColor: port.hex }"
      />
      <span class="port-order">#{{ port.order + 1 }}</span>
      <span class="port-name">{{ port.name }}</span>
      <span
        v-if="port.order === 0"
        class="hint"
      >Load TOP</span>
      <span
        v-if="port.order === 4"
        class="hint"
      >Load BOTTOM</span>
    </div>
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
.port-legend {
  top: 400px;
  left: 12px;
  min-width: 200px;
}
.panel-title {
  font-size: 12px;
  font-weight: bold;
  color: #ffcc00;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 2px 0;
  color: #ccc;
}
.port-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.port-order {
  color: #888;
  min-width: 18px;
}
.port-name { flex: 1; }
.hint {
  font-size: 9px;
  color: #ffcc00;
  font-weight: bold;
}
</style>
