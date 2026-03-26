<script setup lang="ts">
import { useGameStore } from '../store/gameStore'
import { WEIGHT_COLORS } from '../modules/config'
import type { Container } from '../types'

const store = useGameStore()

function weightColor(c: Container): string {
  return WEIGHT_COLORS[c.weightCategory]?.hex ?? '#fff'
}
</script>

<template>
  <div
    v-if="store.phase === 'selecting' && store.queueContainers.length"
    class="load-list panel"
  >
    <div class="panel-title">
      Load List
    </div>
    <div
      v-for="c in store.queueContainers"
      :key="c.id"
      class="list-item"
    >
      <span
        class="port-dot"
        :style="{ backgroundColor: c.portHex }"
      />
      <span
        class="item-weight"
        :style="{ color: weightColor(c) }"
      >{{ c.weight.toFixed(0) }}t</span>
      <span class="item-port">{{ c.port }}</span>
      <span
        v-if="c.isHazmat"
        class="hazmat-tag"
      >HAZ</span>
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
.load-list {
  top: 210px;
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
.list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 2px 0;
  color: #ccc;
}
.port-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.item-weight {
  font-weight: bold;
  min-width: 35px;
}
.item-port { flex: 1; }
.hazmat-tag {
  color: #ff6600;
  font-weight: bold;
  font-size: 9px;
  padding: 1px 4px;
  border: 1px solid #ff6600;
  border-radius: 3px;
}
</style>
