<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'

const store = useGameStore()

const container = computed(() => {
  if (!store.selectedContainerId) return null
  return store.containers.find(c => c.id === store.selectedContainerId) ?? null
})
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
      <span class="info-id">{{ container.id }}</span>
      <button
        class="close-btn"
        @click="store.selectedContainerId = null"
      >
        ✕
      </button>
    </div>
    <div class="info-rows">
      <div class="info-row">
        <span class="label">Type</span>
        <span class="value">{{ container.visitType }}</span>
      </div>
      <div class="info-row">
        <span class="label">State</span>
        <span class="value">{{ container.lifecycleState }}</span>
      </div>
      <div class="info-row">
        <span class="label">Weight</span>
        <span class="value">{{ container.weight.toLocaleString() }} kg</span>
      </div>
      <div class="info-row">
        <span class="label">Size</span>
        <span class="value">{{ container.size }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container-info {
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
  gap: 8px;
  margin-bottom: 8px;
}

.color-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.info-id {
  font-family: var(--font-retro, monospace);
  font-size: 0.8rem;
  color: #fff;
  flex: 1;
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
