<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'
import { WEIGHT_COLORS } from '../modules/config'

const store = useGameStore()

const container = computed(() => store.currentContainer)

const weightColor = computed(() => {
  if (!container.value) return '#fff'
  return WEIGHT_COLORS[container.value.weightCategory]?.hex ?? '#fff'
})
</script>

<template>
  <div
    v-if="store.phase === 'selecting' && container"
    class="container-info panel"
  >
    <div class="panel-title">
      Current Container
    </div>
    <div class="info-row">
      <span class="label">ID:</span>
      <span class="value">{{ container.id }}</span>
    </div>
    <div class="info-row">
      <span class="label">Weight:</span>
      <span
        class="value"
        :style="{ color: weightColor }"
      >
        {{ container.weight.toFixed(1) }}t ({{ container.weightCategory }})
      </span>
    </div>
    <div class="info-row">
      <span class="label">Port:</span>
      <span class="value">
        <span
          class="port-dot"
          :style="{ backgroundColor: container.portHex }"
        />
        {{ container.port }}
      </span>
    </div>
    <div class="info-row">
      <span class="label">Type:</span>
      <span
        class="value"
        :class="{ hazmat: container.isHazmat }"
      >
        {{ container.isHazmat ? 'HAZMAT' : 'Standard' }}
      </span>
    </div>
    <div class="info-row">
      <span class="label">Discharge:</span>
      <span class="value">#{{ container.portOrder + 1 }}</span>
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
.container-info {
  top: 50px;
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
.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12px;
}
.label { color: #888; }
.value {
  color: #eee;
  display: flex;
  align-items: center;
  gap: 6px;
}
.port-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.hazmat { color: #ff6600; font-weight: bold; }
</style>
